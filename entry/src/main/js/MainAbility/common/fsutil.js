/**
 * @system.file 小文件工具集（saved / store / route / space 共用）。
 *
 * 平台硬约束（SDK @system.file.d.ts + 技能 file-and-storage）：
 * - readText 的 position/length 均为字节，单读不得超过 4KB（超限报 302）；
 *   字节/字符语义未真机证实前**一律不用 position**，分片小文件天然免疫；
 * - mkdir 必须链式（回调后才能写文件）；URI ≤128 字符、ASCII 命名；
 * - 所有对外回调恰好一次，异常一律降级。
 *
 * v3.2 稳固化：按基名读写互斥（writeParts 持锁、读侧等锁）；writeSmall/
 * readSmall 带 3s 守卫；删除链逐步守卫（回调丢失不悬挂）。
 *
 * v3.7 核心加固（浏览崩溃贯穿 3.1~3.6 的真正公共面）：
 * - **全局文件操作串行**：真机史对账——v2.4~v3.0 文件调用全程回调串行（任一
 *   时刻至多 1 个在飞）→ 稳定；v3.1 起 store 多链 + 路由参数 + 离线读取形成
 *   3~6 个**并行** file 调用 → 崩溃贯穿每一版。v3.2 只按基名互斥，跨基名
 *   并发未堵。全局 FIFO 队列把**所有** @system.file 调用（writeText/readText/
 *   delete/access/mkdir/list）压回"同一时刻只在飞 1 个"。
 * - 每个原生调用都带守卫：回调丢失也按期释放队列，绝不悬挂。
 *
 * 分片约定：每片 ≤ PART_CHARS=1200 字符（纯汉字 ≈3600 字节 < 4000），
 * 单次 writeText 写、单次 readText(length:4000) 读全，两种偏移语义下都正确。
 * 文件命名为 base+序号（base 以 '.' 结尾，如 internal://app/data/bm.0），连续无空洞。
 */
import file from '@system.file';

var PART_CHARS = 1200;
var READ_LEN = 4000;
var GUARD_MS = 3000;
var DELETE_GUARD_MS = 600;

/* ---------------- 全局 FIFO：同一时刻至多 1 个 file 调用在飞 ---------------- */
var opQueue = [];
var opBusy = false;
/* thunk 同步执行深度：>0 表示当前仍在某个 thunk 调用栈内（嵌套 pump 时逐层累加，
   不能用一个布尔量——内层结束会提前复位外层状态）。 */
var thunkDepth = 0;
/* 文件调用之间插入一拍宏任务（真机默认开；冒烟关掉以保持同步回调链的确定性） */
var deferBetweenOps = true;

function setDeferBetweenOps(on) {
  deferBetweenOps = on !== false;
}

/**
 * 入队一个原生文件调用：thunk(release) 内做且只做一次 file.* 调用；
 * 回调/守卫/异常任一路都必须调用 release() 放行队列。
 */
function runOp(thunk) {
  opQueue.push(thunk);
  pumpOps();
}

function pumpOps() {
  if (opBusy || opQueue.length < 1) {
    return;
  }
  opBusy = true;
  var thunk = opQueue.shift();
  var released = false;
  function release() {
    if (released) {
      return;
    }
    released = true;
    opBusy = false;
    /* v1.0.2（离线保存完成即崩的修复）：真机上文件回调是**异步**的——若在原生
       回调栈内直接发下一次 file 调用，等于在文件服务的回调里重入文件服务
       （离线保存 11~13 次连续调用恰好在最后一步完成后把应用打死）。
       插入一拍宏任务再发下一个；同步 mock 调用链（冒烟/深度>0）走内联续跑。 */
    if (!deferBetweenOps || thunkDepth > 0) {
      pumpOps();
    } else {
      /* 16ms：给文件服务与 UI 线程留出收尾/呼吸时间（每次保存总代价约 100ms） */
      setTimeout(pumpOps, 16);
    }
  }
  thunkDepth += 1;
  try {
    thunk(release);
  } catch (err) {
    release();
  }
  thunkDepth -= 1;
}

function once(fn) {
  var called = false;
  return function (a, b) {
    if (called) {
      return;
    }
    called = true;
    if (fn) {
      fn(a, b);
    }
  };
}

/** UTF-8 字节长度（ASCII 1 / 2 字节 / BMP 3 / 代理对 4）。单文件预算用。 */
function utf8Len(s) {
  var str = s === null || s === undefined ? '' : String(s);
  var n = 0;
  for (var i = 0; i < str.length; i += 1) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800) {
      n += 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      n += 4;
      i += 1;
    } else {
      n += 3;
    }
  }
  return n;
}

/* ---------------- 互斥锁：同一基名的分片读写串行排队 ---------------- */
var lockQueues = {};

function withLock(base, fn) {
  var q = lockQueues[base];
  if (q) {
    q.push(fn);
    return;
  }
  lockQueues[base] = [];
  fn();
}

function unlock(base) {
  var q = lockQueues[base];
  if (!q) {
    return;
  }
  if (q.length > 0) {
    q.shift()();
    return;
  }
  delete lockQueues[base];
}

/** 正文切成 ≤cap 字符的小片（上界由 maxParts 兜底）。 */
function splitText(text, cap, maxParts) {
  var src = text === null || text === undefined ? '' : String(text);
  var out = [];
  var pos = 0;
  var limit = maxParts || 64;
  while (pos < src.length && out.length < limit) {
    out.push(src.substr(pos, cap));
    pos += cap;
  }
  return out;
}

/* 每会话已确保存在的目录（mkdir 至多一次/目录） */
var ensuredDirs = {};

/**
 * 确保目录存在后回调：access 探测——存在即跳过 mkdir（避免对已存在目录 mkdir），
 * 缺失才 mkdir（fail 按已存在放行）；每会话每目录至多实际操作一次。
 * dirUri 不带尾斜杠。done() 在目录可用时触发（成功/已存在/异常均视为可用，
 * 真正的写入结果由 writeText 回调裁决）。access/mkdir 各自入队串行。
 */
function ensureDir(dirUri, done) {
  var end = once(done);
  if (ensuredDirs[dirUri]) {
    end(true);
    return;
  }
  ensuredDirs[dirUri] = true;
  var settled = false;

  function toMkdir() {
    if (settled) {
      return;
    }
    settled = true;
    runOp(function (release) {
      var done2 = false;
      var guard = setTimeout(function () {
        if (!done2) {
          done2 = true;
          end(true);
          release();
        }
      }, DELETE_GUARD_MS);
      function settle() {
        if (!done2) {
          done2 = true;
          clearTimeout(guard);
          end(true);
          release();
        }
      }
      try {
        file.mkdir({ uri: dirUri, recursive: true, success: settle, fail: settle });
      } catch (err) {
        settle();
      }
    });
  }

  runOp(function (release) {
    var done3 = false;
    var guard = setTimeout(function () {
      if (!done3) {
        done3 = true;
        release();
        toMkdir();
      }
    }, DELETE_GUARD_MS);
    function settle(found) {
      if (done3) {
        return;
      }
      done3 = true;
      clearTimeout(guard);
      release();
      if (found && !settled) {
        settled = true;
        end(true);
      } else {
        toMkdir();
      }
    }
    try {
      file.access({
        uri: dirUri,
        success: function () { settle(true); },
        fail: function () { settle(false); }
      });
    } catch (err2) {
      settle(false);
    }
  });

  /* access 回调丢失兜底（600ms 后按缺失处理）；正常路径下 settled 已真，无副作用 */
  setTimeout(function () {
    if (!settled) {
      toMkdir();
    }
  }, 600);
}

/** 单次覆盖写一个小文件（3s 守卫：回调丢失也放行，队列不悬挂）。done(ok)。 */
function writeSmall(uri, text, done) {
  var end = once(done);
  runOp(function (release) {
    var guard = setTimeout(function () {
      end(false);
      release();
    }, GUARD_MS);
    function settle(ok) {
      clearTimeout(guard);
      end(ok);
      release();
    }
    try {
      file.writeText({
        uri: uri,
        text: text === null || text === undefined ? '' : String(text),
        encoding: 'UTF-8',
        append: false,
        success: function () { settle(true); },
        fail: function () { settle(false); }
      });
    } catch (err) {
      settle(false);
    }
  });
}

/** 单次读一个小文件（length≤4000，不用 position，3s 守卫）。done(text)。 */
function readSmall(uri, done) {
  var end = once(done);
  runOp(function (release) {
    var guard = setTimeout(function () {
      end('');
      release();
    }, GUARD_MS);
    function settle(t) {
      clearTimeout(guard);
      end(t);
      release();
    }
    try {
      file.readText({
        uri: uri,
        encoding: 'UTF-8',
        length: READ_LEN,
        success: function (data) {
          settle(data && data.text ? String(data.text) : '');
        },
        fail: function () { settle(''); }
      });
    } catch (err) {
      settle('');
    }
  });
}

/** 列目录普通文件（入队串行）。cb([{uri,length}])，必回调。 */
function listDir(dirUri, cb) {
  var end = once(cb);
  runOp(function (release) {
    var done = false;
    var guard = setTimeout(function () {
      if (!done) {
        done = true;
        end([]);
        release();
      }
    }, DELETE_GUARD_MS);
    function settle(entries) {
      if (!done) {
        done = true;
        clearTimeout(guard);
        end(entries);
        release();
      }
    }
    try {
      file.list({
        uri: dirUri,
        success: function (data) {
          var list = data && data.fileList ? data.fileList : [];
          var out = [];
          for (var i = 0; i < list.length; i += 1) {
            if (list[i] && list[i].type !== 'dir' && list[i].uri) {
              out.push({ uri: String(list[i].uri), length: Number(list[i].length) || 0 });
            }
          }
          settle(out);
        },
        fail: function () { settle([]); }
      });
    } catch (err) {
      settle([]);
    }
  });
}

/**
 * 带守卫的单步删除：success/fail/回调丢失/异常四路都会推进 step()
 * （删除回调丢失绝不允许悬挂删除链与互斥锁）。入队串行。
 */
function deleteStep(uri, step) {
  runOp(function (release) {
    var done = false;
    var guard = setTimeout(function () {
      if (!done) {
        done = true;
        release();
        step();
      }
    }, DELETE_GUARD_MS);
    function settle() {
      if (!done) {
        done = true;
        clearTimeout(guard);
        release();
        step();
      }
    }
    try {
      file.delete({ uri: uri, success: settle, fail: settle });
    } catch (err) {
      settle();
    }
  });
}

/** 尽力删除单个文件，不等待不对外回调。 */
function quietDelete(uri) {
  runOp(function (release) {
    var done = false;
    var guard = setTimeout(function () {
      if (!done) {
        done = true;
        release();
      }
    }, DELETE_GUARD_MS);
    function settle() {
      if (!done) {
        done = true;
        clearTimeout(guard);
        release();
      }
    }
    try {
      file.delete({ uri: uri, success: settle, fail: settle });
    } catch (err) {
      settle();
    }
  });
}

/**
 * 串行删除 base+from .. base+to-1（逐个回调链推进，**绝不并行洪峰**）。
 * 不存在的片按 fail 放行继续；单步回调丢失由守卫推进。done() 可省略。
 */
function quietDeleteRange(base, from, to, done) {
  var end = once(done);
  var i = from;
  function step() {
    if (i >= to) {
      end(true);
      return;
    }
    var uri = base + i;
    i += 1;
    deleteStep(uri, step);
  }
  step();
}

/** 串行删除一批独立 URI（信息页清理等），单步带守卫。done() 可省略。 */
function deleteList(uris, done) {
  var end = once(done);
  var i = 0;
  function step() {
    if (i >= uris.length) {
      end(true);
      return;
    }
    var uri = uris[i];
    i += 1;
    deleteStep(uri, step);
  }
  step();
}

/* 每基名上次写入的片数（增量清理用；跨会话首次写按满量清理残留） */
var lastCounts = {};

/**
 * 分片写整串（互斥持锁）：base+序号 逐片单写，写完**串行增量清理尾部旧片**
 * ——只删 [n..last) 绝对下标区间（稳态 last==n 即零删除）。done(ok)。
 */
function writeParts(base, text, maxParts, done) {
  var end = once(done);
  withLock(base, function () {
    var limit = maxParts || 64;
    var parts = splitText(text, PART_CHARS, limit);
    if (parts.length < 1) {
      parts = [''];
    }
    var i = 0;
    function finish(ok) {
      if (!ok) {
        end(false);
        unlock(base);
        return;
      }
      var last = lastCounts[base];
      if (typeof last !== 'number') {
        last = limit; /* 本会话首次写：按满量清理跨会话残留尾巴 */
      }
      lastCounts[base] = parts.length;
      if (last > parts.length) {
        quietDeleteRange(base, parts.length, last, function () {
          end(true);
          unlock(base);
        });
        return;
      }
      end(true);
      unlock(base);
    }
    function step() {
      if (i >= parts.length) {
        finish(true);
        return;
      }
      writeSmall(base + i, parts[i], function (ok) {
        if (!ok) {
          finish(false);
          return;
        }
        i += 1;
        step();
      });
    }
    step();
  });
}

/**
 * 分片读整串（互斥等锁）：从 0 片起读到失败/空片为止并拼接。done(text)。
 */
function readParts(base, maxParts, done) {
  var end = once(done);
  withLock(base, function () {
    var limit = maxParts || 64;
    var out = '';
    var i = 0;
    function step() {
      if (i >= limit) {
        end(out);
        unlock(base);
        return;
      }
      readSmall(base + i, function (piece) {
        if (!piece) {
          end(out);
          unlock(base);
          return;
        }
        out += piece;
        i += 1;
        step();
      });
    }
    step();
  });
}

export default {
  PART_CHARS: PART_CHARS,
  once: once,
  utf8Len: utf8Len,
  splitText: splitText,
  runOp: runOp,
  setDeferBetweenOps: setDeferBetweenOps,
  ensureDir: ensureDir,
  writeSmall: writeSmall,
  readSmall: readSmall,
  listDir: listDir,
  quietDelete: quietDelete,
  quietDeleteRange: quietDeleteRange,
  deleteList: deleteList,
  writeParts: writeParts,
  readParts: readParts
};
