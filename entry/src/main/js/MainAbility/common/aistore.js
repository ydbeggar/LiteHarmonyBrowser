/**
 * AI 抓取正文的临时存储（v1.1.3 单文件版）。
 *
 * 目录：internal://app/ai/<key>.txt —— 正文单文件（一次 writeText 写全）。
 *
 * v1.1.3 崩溃修复：旧版 writeParts 对 16000 字要写 14 分片 + 终止片 + ensureDir
 * ≈17 次 @system.file 调用，远超真机 ≤6 次稳定阈值（saved.js 实测：11~13 次连发即崩）。
 * 改为单文件：写 1 次 writeText + 读 1 次 readArrayBuffer，总调用从 ~17 降到 2。
 * 内存：读取时整文件进 Uint8Array 再解码为字符串，峰值 ≈ 2×正文（受 maxText 限）。
 *
 * 只保存最近一次 AI 阅读的正文；key 由 URL 哈希得到，阅读页只接收 key。
 */
import Fs from './fsutil.js';
import file from '@system.file';

var DIR = 'internal://app/ai';
var BASE = DIR + '/';
var READ_CAP = 65536;

function keyOf(url) {
  var h = 5381;
  var s = String(url || '');
  for (var i = 0; i < s.length; i += 1) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return 'a' + h.toString(16);
}

function baseOf(key) {
  return BASE + String(key || '');
}

function ensureDir(done) {
  Fs.ensureDir(DIR, done);
}

/** UTF-8 解码（与 pagestore 同款）：起点落在续字节则回退到 lead byte。 */
function utf8Decode(buf, start, end) {
  var s = start;
  while (s > 0 && s < end && (buf[s] & 0xC0) === 0x80) {
    s -= 1;
  }
  var out = '';
  var i = s;
  while (i < end) {
    var c = buf[i];
    if (c < 0x80) {
      out += String.fromCharCode(c);
      i += 1;
    } else if ((c & 0xE0) === 0xC0 && i + 1 < end) {
      out += String.fromCharCode(((c & 0x1F) << 6) | (buf[i + 1] & 0x3F));
      i += 2;
    } else if ((c & 0xF0) === 0xE0 && i + 2 < end) {
      out += String.fromCharCode(((c & 0x0F) << 12) | ((buf[i + 1] & 0x3F) << 6) | (buf[i + 2] & 0x3F));
      i += 3;
    } else if ((c & 0xF8) === 0xF0 && i + 3 < end) {
      var cp = ((c & 0x07) << 18) | ((buf[i + 1] & 0x3F) << 12) | ((buf[i + 2] & 0x3F) << 6) | (buf[i + 3] & 0x3F);
      cp -= 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      i += 4;
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * 保存正文为单文件。cb(ok)。
 */
function save(url, text, cb) {
  var done = false;
  function finish(ok) {
    if (done) { return; }
    done = true;
    if (typeof cb === 'function') { cb(ok); }
  }
  var key = keyOf(url);
  var src = text === null || text === undefined ? '' : String(text);
  ensureDir(function () {
    Fs.writeSmall(baseOf(key) + '.txt', src, function (ok) {
      finish(ok);
    });
  });
}

/**
 * 读取正文（单文件）。cb(text)；找不到返回空串。
 * 走 readArrayBuffer 一次读全（避免 readText 4KB 分片的多次调用）。
 */
function load(url, cb) {
  var key = keyOf(url);
  var uri = baseOf(key) + '.txt';
  var end = typeof cb === 'function' ? cb : function () {};
  Fs.runOp(function (release) {
    var done = false;
    var guard = setTimeout(function () {
      if (!done) {
        done = true;
        release();
        end('');
      }
    }, 3000);
    function settle(text) {
      if (done) { return; }
      done = true;
      clearTimeout(guard);
      release();
      end(text);
    }
    try {
      if (typeof file.readArrayBuffer !== 'function') {
        settle('');
        return;
      }
      file.readArrayBuffer({
        uri: uri,
        length: READ_CAP,
        success: function (data) {
          var buf = data && data.buffer ? data.buffer : null;
          settle(buf ? utf8Decode(buf, 0, buf.length) : '');
        },
        fail: function () { settle(''); }
      });
    } catch (err) {
      settle('');
    }
  });
}

/**
 * 删除正文（可选清理）。cb(ok)。
 */
function clear(url, cb) {
  var key = keyOf(url);
  Fs.quietDelete(baseOf(key) + '.txt');
  if (typeof cb === 'function') { cb(true); }
}

export default {
  keyOf: keyOf,
  save: save,
  load: load,
  clear: clear
};
