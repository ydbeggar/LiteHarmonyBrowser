/**
 * 离线网页保存（@system.file，v2 分片文件格式）。
 *
 * 目录：internal://app/saved/
 *   list.txt        —— 清单 JSON：[{key,url,title,ts,parts}]，最多 MAX 条，单次读回
 *   <key>.<n>       —— 正文第 n 片（0 起），每片 ≤ PART_CHARS 字符，单写单读
 *
 * v2 格式依据（SDK @system.file.d.ts + 技能 file-and-storage 规则，2026-11 核对）：
 * - readText 的 position/length 均为「字节」，且一次读取不得超过 4KB（超限报 302）。
 *   v1 的「同一文件字符/字节偏移分片推进」依赖 cache.js 的运行时探测，未探测时按
 *   字符推进，中文正文（每字 3 字节）必然错位拼接出乱码；只要正文超过一个分片
 *   （约 833 个汉字）读回即坏——这是「离线打开不可用」的根因之一。
 *   v2 改为**每片一个独立小文件**：写入单次 writeText、读取单次 readText
 *   （length=4000，不用 position），对字节/字符两种 position 语义天然免疫。
 * - 每片 ≤1200 字符（纯汉字约 ≤3600 字节 < 4000），单次读取必然读全，不触发 302。
 * - 目录创建必须**链式**：mkdir 回调后再写文件（mkdir 与 writeText 并行是竞态，
 *   技能明确禁止）；mkdir 的 fail 按「目录已存在」放行，真正的结果以 writeText
 *   回调为准。mkdir 使用不带尾斜杠的 URI（对齐 shalu2 音频方案 internal://app/music）。
 * - 清单受容量与字段上限约束（MAX 条 × 轮换字段 ≤约 3.5KB < 4KB，v3.3 标题 28 字），单次读回；
 *   JSON 解析失败按空清单处理（下一次保存重建，自愈）。
 * - 所有对外回调恰好一次；任何 file.* 异常都降级，绝不拖垮阅读主链路。
 * - save() 带 onProgress(written, total) 进度回调，供操作页「网页下载进度显示」。
 */
import Fs from './fsutil.js';

var DIR = 'internal://app/saved/';
var MKDIR_URI = 'internal://app/saved';
var LIST_URI = DIR + 'list.txt';
var PART_CHARS = 1200;
var MAX = 12;
var MAX_PARTS = 26;
/* v1.0.3（离线保存"0% 卡死→崩溃"修复）：真机文件服务对**连续调用次数**敏感——
   浏览每页 3~6 次调用长期稳定，离线保存 11~13 次连发即卡死崩溃（且写盘其实
   都已成功，崩溃发生在收尾）。把离线正文按 SAVE_CAP 封顶 → 最多 4 片，
   一次保存总调用 = 清单读 1 + 片写 ≤4 + 清单写 1 = ≤6 次，回到与浏览同级的稳定区。
   超长章节附截断提示，不静默丢内容。
   v1.0.4 曾试 5,800 字（5 片 / ≤7 次）：**真机仍崩** → v1.0.5 回退到 4,600。
   亦即真机稳定阈值在 6 次调用以内，5 片（7 次）超出。 */
var SAVE_CAP = 4600;
var TRUNC_MARK = '\n（离线内容已截断，完整内容请联网阅读）';
/* v3.3 标题上限 22→28：「书名 第n章」识别标题与回退原标题都少被截断；
   清单预算 12×(28 字标题 + 100 字 URL) ≈ 2.8KB 仍远低于单读 4KB。 */
var TITLE_CAP = 28;
var URL_CAP = 100;

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

function keyOf(url, ts) {
  var h = 5381;
  var s = String(url || '') + '|' + String(ts || '');
  for (var i = 0; i < s.length; i += 1) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return 'o' + h.toString(16) + String(ts || '').slice(-5);
}

function contentUri(key, index) {
  return DIR + String(key) + '.' + String(index);
}

function clampParts(value) {
  var n = Math.floor(Number(value));
  if (isNaN(n) || n < 1) {
    return 0;
  }
  if (n > MAX_PARTS) {
    return MAX_PARTS;
  }
  return n;
}

function capText(value, max) {
  var s = value === null || value === undefined ? '' : String(value);
  return s.length > max ? s.substring(0, max) : s;
}

/** 链式建目录：回调后才能写文件。fail 按「已存在」放行，写入结果才是真判据。
    v3.7：原语委托 fsutil——与 store/route 走同一全局串行队列（任一时刻
    至多 1 个 file 调用在飞，浏览崩溃贯穿 3.1~3.6 的并发放量根治）。 */
function ensureDir(done) {
  Fs.ensureDir(MKDIR_URI, done);
}

/** 单次覆盖写一个小文件。done(ok)。 */
function writeSmall(uri, text, done) {
  Fs.writeSmall(uri, text, done);
}

/** 单次读一个小文件（length≤4000，不用 position）。done(text)。 */
function readSmall(uri, done) {
  Fs.readSmall(uri, done);
}

/** 尽力删除一批文件，不等待、不回调对外结果。 */
function deleteQuietly(uri) {
  Fs.quietDelete(uri);
}

function deleteEntryFiles(entry) {
  var parts = clampParts(entry && entry.parts);
  for (var i = 0; i < parts; i += 1) {
    deleteQuietly(contentUri(entry.key, i));
  }
}

function parseList(raw) {
  var out = [];
  if (!raw) {
    return out;
  }
  var data = null;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return out;
  }
  if (Object.prototype.toString.call(data) !== '[object Array]') {
    return out;
  }
  for (var i = 0; i < data.length && out.length < MAX; i += 1) {
    var it = data[i];
    var parts = it ? clampParts(it.parts) : 0;
    if (it && it.key && it.url && parts > 0) {
      out.push({
        key: String(it.key),
        url: String(it.url),
        title: String(it.title || it.url),
        ts: Number(it.ts) || 0,
        parts: parts
      });
    }
  }
  return out;
}

/** 读取清单。cb(items)，必回调。 */
function list(cb) {
  readSmall(LIST_URI, function (raw) {
    cb(parseList(raw));
  });
}

function writeList(items, done) {
  var text = '';
  try {
    text = JSON.stringify(items || []);
  } catch (err) {
    text = '[]';
  }
  writeSmall(LIST_URI, text, done);
}

/**
 * 保存网页正文为离线内容。entry = {url,title,ts}；text = 正文纯文本。
 * onProgress(written, total) 可选，逐片回调（total 含清单一步）；cb(ok)。
 * 同 URL 覆盖：写完新内容后把旧条目移出清单并删其分片。
 *
 * v1.0.1 崩溃修复：旧实现先 `splitText(text)` 把整篇正文切成**分片数组**
 * （12000 汉字 ≈ 10 片 ≈ 36KB 副本），在"点保存瞬间"叠加到已加载的阅读文档上
 * （正文 36KB + 链接表 16KB + 响应余量），真机在最长章（933334/3）点保存即崩。
 * 现改为**逐片现场切片**：每次只 `substr` 出一片（≤1200 字 ≈ 3.6KB）写完再切下一片，
 * 任一时刻仅存活 1 片；整条链路包 try/catch，任何异常都降级为 done(false)。
 */
function save(entry, text, onProgress, cb) {
  var done = once(cb);
  var src = text === null || text === undefined ? '' : String(text);
  if (src.length > SAVE_CAP) {
    src = src.substring(0, SAVE_CAP) + TRUNC_MARK;
  }
  var partCount = Math.ceil(src.length / PART_CHARS);
  if (!(partCount >= 1)) {
    /* 空正文也写一个空片，保证 load 能区分「存在但为空」与「缺失」 */
    partCount = 1;
  }
  if (partCount > MAX_PARTS) {
    partCount = MAX_PARTS;
  }
  if (!entry || !entry.url) {
    done(false);
    return;
  }
  try {
    var ts = entry.ts || Date.now();
    var key = keyOf(entry.url, ts);
    var meta = {
      key: key,
      url: capText(entry.url, URL_CAP),
      title: capText(entry.title || entry.url, TITLE_CAP),
      ts: ts,
      parts: partCount
    };
    var total = partCount + 1;
    ensureDir(runSave);
  } catch (err) {
    done(false);
  }

  function report(written) {
    if (!onProgress) {
      return;
    }
    try {
      onProgress(written, total);
    } catch (err1) {
      /* 进度回调异常绝不影响保存 */
    }
  }

  function runSave() {
    try {
      list(function (items) {
        try {
          var next = [meta];
          var dropped = [];
          for (var i = 0; i < items.length; i += 1) {
            if (items[i].url === meta.url) {
              dropped.push(items[i]);
            } else if (next.length < MAX) {
              next.push(items[i]);
            } else {
              dropped.push(items[i]);
            }
          }
          writePart(0);
        } catch (err2) {
          done(false);
        }

        function writePart(index) {
          if (index >= partCount) {
            finishSave();
            return;
          }
          var piece = '';
          try {
            piece = src.substr(index * PART_CHARS, PART_CHARS);
          } catch (err3) {
            done(false);
            return;
          }
          writeSmall(contentUri(key, index), piece, function (ok) {
            if (!ok) {
              done(false);
              return;
            }
            report(index + 1);
            writePart(index + 1);
          });
        }

        function finishSave() {
          writeList(next, function (ok) {
            if (!ok) {
              done(false);
              return;
            }
            report(partCount + 1);
            /* 被覆盖/被挤出的旧分片：尽力回收，不阻塞结果。
               同 key（同 URL 同毫秒）时旧条目与新条目共用分片文件，绝不能删。 */
            try {
              for (var d = 0; d < dropped.length; d += 1) {
                if (dropped[d].key !== key) {
                  deleteEntryFiles(dropped[d]);
                }
              }
            } catch (err4) {
              /* 回收失败不影响保存结果 */
            }
            done(true);
          });
        }
      });
    } catch (err5) {
      done(false);
    }
  }
}

/**
 * 读取正文。key + parts（清单条目里的分片数）。cb(text)，必回调；
 * 中途缺片时返回已拼出的部分（调用方按最短正文阈值裁决）。
 */
function load(key, parts, cb) {
  var done = once(cb);
  var count = clampParts(parts);
  if (!key || count < 1) {
    done('');
    return;
  }
  var out = '';
  readPart(0);

  function readPart(index) {
    if (index >= count) {
      done(out);
      return;
    }
    readSmall(contentUri(key, index), function (piece) {
      if (!piece) {
        done(out);
        return;
      }
      out += piece;
      readPart(index + 1);
    });
  }
}

/** 删除一条（含全部分片）。cb(ok)。 */
function remove(key, parts, cb) {
  var done = once(cb);
  var count = clampParts(parts);
  for (var i = 0; i < count; i += 1) {
    deleteQuietly(contentUri(key, i));
  }
  list(function (items) {
    var next = [];
    for (var j = 0; j < items.length; j += 1) {
      if (items[j].key !== String(key)) {
        next.push(items[j]);
      }
    }
    writeList(next, function (ok) { done(ok); });
  });
}

export default {
  list: list,
  save: save,
  load: load,
  remove: remove,
  keyOf: keyOf
};
