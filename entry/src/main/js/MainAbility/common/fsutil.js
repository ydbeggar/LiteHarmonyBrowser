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
/* 分片同时受字符数与 UTF-8 字节数双重约束：1200 个 4 字节字符也会超过
   readText 的 4000B 上限并报 302。3600B 给 UTF-8/BOM/设备实现留余量。 */
var PART_BYTES = 3600;
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
  return function () {
    if (called) {
      return;
    }
    called = true;
    if (fn) {
      fn.apply(null, arguments);
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

/**
 * 正文切成小片：每片同时 ≤cap 字符、≤PART_BYTES UTF-8 字节。
 * 这是 readText(length:4000) 不报 302 的关键；旧实现只按字符切，
 * 1200 个 emoji/生僻字（4B）会变成 4800B。
 */
function splitText(text, cap, maxParts) {
  var src = text === null || text === undefined ? '' : String(text);
  var out = [];
  var start = 0;
  var chars = 0;
  var bytes = 0;
  var limit = maxParts || 64;
  var i = 0;
  while (i < src.length && out.length < limit) {
    var c = src.charCodeAt(i);
    var step = 1;
    var b = 1;
    if (c < 0x80) {
      b = 1;
    } else if (c < 0x800) {
      b = 2;
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < src.length) {
      b = 4;
      step = 2;
    } else {
      b = 3;
    }
    if (chars > 0 && (chars + step > cap || bytes + b > PART_BYTES)) {
      out.push(src.substring(start, i));
      start = i;
      chars = 0;
      bytes = 0;
    }
    chars += step;
    bytes += b;
    i += step;
  }
  if (start < src.length && out.length < limit) {
    out.push(src.substring(start));
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
          ensuredDirs[dirUri] = false;
          end(false);
          release();
        }
      }, DELETE_GUARD_MS);
      function settleDir(ok) {
        if (!done2) {
          done2 = true;
          clearTimeout(guard);
          ensuredDirs[dirUri] = !!ok;
          end(!!ok);
          release();
        }
      }
      try {
        file.mkdir({
          uri: dirUri,
          recursive: true,
          success: function () { settleDir(true); },
          fail: function (data, code) {
            /* 多数实现把“目录已存在”也走 fail；只有明确的参数/IO 错误才
               标记目录不可用，避免一次瞬时失败后整会话都不再重试。 */
            var c = Number(code);
            if (code === undefined || c === 0) {
              settleDir(true);
            } else {
              settleDir(false);
            }
          }
        });
      } catch (err) {
        settleDir(false);
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
    function settle(found, code) {
      if (done3) {
        return;
      }
      done3 = true;
      clearTimeout(guard);
      release();
      if (found) {
        if (!settled) {
          settled = true;
          ensuredDirs[dirUri] = true;
          end(true);
        }
        return;
      }
      /* 301=目录不存在，才进入 mkdir；300 I/O 错误也按可重试处理；
         其他错误不再假装目录可用。 */
      var c = Number(code);
      if (code === undefined || c === 0 || c === 300 || c === 301) {
        toMkdir();
      } else if (!settled) {
        settled = true;
        ensuredDirs[dirUri] = false;
        end(false);
      }
    }
    try {
      file.access({
        uri: dirUri,
        success: function () { settle(true, 0); },
        fail: function (data, code) { settle(false, code); }
      });
    } catch (err2) {
      settle(false, 'exception');
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

/**
 * 单次读一个小文件（length≤4000，不用 position，3s 守卫）。
 * done(text, ok, code)：ok=false 表示读取失败/超时，调用方不得把空串
 * 当成“文件为空”，否则可能用空数据覆盖原有书签/历史。
 */
function readSmall(uri, done) {
  var end = once(done);
  runOp(function (release) {
    var guard = setTimeout(function () {
      end('', false, 'timeout');
      release();
    }, GUARD_MS);
    function settle(t, ok, code) {
      clearTimeout(guard);
      end(t, ok, code);
      release();
    }
    try {
      file.readText({
        uri: uri,
        encoding: 'UTF-8',
        length: READ_LEN,
        success: function (data) {
          settle(data && data.text ? String(data.text) : '', true, 0);
        },
        fail: function (data, code) {
          settle('', false, code);
        }
      });
    } catch (err) {
      settle('', false, 'exception');
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
function writeParts(base, text, maxParts, done, opts) {
  var end = once(done);
  var options = opts || {};
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
      /* v1.1.2：可选终止片。写入 base+n 的空串，readParts 读到空片即停；
         这样首次保存无需对 maxParts 个不存在的旧片发起删除洪峰
         （AI 正文首次保存曾因此多出 24 次 delete）。 */
      if (options.terminate && parts.length < limit) {
        writeSmall(base + parts.length, '', function (termOk) {
          end(termOk);
          unlock(base);
        });
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
      readSmall(base + i, function (piece, ok, code) {
        if (!ok || !piece) {
          /* 301=分片不存在，正常终止；其他错误也终止，但保留已读前缀，
             由调用方按正文阈值裁决，绝不无限重试。 */
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
  PART_BYTES: PART_BYTES,
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
