/**
 * 章文件分页存储（P3-a）：章文件 + 页表 + 页缓存。
 *
 * 文件格式（按设备能力自适应）：
 *   internal://app/read/<key>.txt   UTF-8 正文（writeText，36~90KB 级）
 *   internal://app/read/<key>.idx   页表：
 *     - 高端设备（writeArrayBuffer 可用）：二进制 magic+count+Int32 数组
 *     - 受限设备（FIT4/GT6 等，无 writeArrayBuffer）：文本 JSON "0,360,720,..."
 *
 * 读页策略（2026-11-08 三台设备实测确认）：
 *   1. readText(position=bs, length=bl)——position 为字节偏移（三台通用）；
 *      单次 length 上限精确 4096 字节（4097 报 302）；
 *   2. readArrayBuffer + 手写 UTF-8 解码——三台通用回退；
 *   3. 页缓存 LRU 2 页，翻页读 0~1 次文件调用。
 *
 * 语法：ES5（var/function），不依赖 Promise/globalThis/正则。
 */
import Fs from './fsutil.js';
import file from '@system.file';

var DIR = 'internal://app/read';
var BASE = DIR + '/';
var MKDIR_URI = DIR;

/* 页缓存：LRU 2 页 */
var pageCache = {};
var cacheOrder = [];

/* 本会话已加载的页表（每章一份，≤545 页 × 4B ≈ 2.2KB） */
var idxCache = {};

function keyOf(url) {
  var h = 5381;
  var s = String(url || '');
  for (var i = 0; i < s.length; i += 1) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return 'r' + h.toString(16);
}

function txtUri(key) {
  return BASE + key + '.txt';
}

function idxUri(key) {
  return BASE + key + '.idx';
}

/* ---------------- 页表编码/解码 ---------------- */

/** 页表编码：magic 'PGT1' + count(Uint16) + offsets(Uint32) */
function encodeIdx(offsets) {
  var count = offsets.length;
  var buf = new Uint8Array(6 + count * 4);
  buf[0] = 0x50; /* P */
  buf[1] = 0x47; /* G */
  buf[2] = 0x54; /* T */
  buf[3] = 0x31; /* 1 */
  buf[4] = count & 0xff;
  buf[5] = (count >> 8) & 0xff;
  for (var i = 0; i < count; i += 1) {
    var off = offsets[i];
    var base = 6 + i * 4;
    buf[base] = off & 0xff;
    buf[base + 1] = (off >> 8) & 0xff;
    buf[base + 2] = (off >> 16) & 0xff;
    buf[base + 3] = (off >> 24) & 0xff;
  }
  return buf;
}

/** 页表解码：返回 {offsets:number[], count} 或 null */
function decodeIdx(buffer) {
  if (!buffer || buffer.length < 6) {
    return null;
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x47 || buffer[2] !== 0x54 || buffer[3] !== 0x31) {
    return null;
  }
  var count = buffer[4] | (buffer[5] << 8);
  if (count < 1 || buffer.length < 6 + count * 4) {
    return null;
  }
  var offsets = [];
  for (var i = 0; i < count; i += 1) {
    var base = 6 + i * 4;
    offsets.push(
      (buffer[base] | (buffer[base + 1] << 8) | (buffer[base + 2] << 16) | (buffer[base + 3] << 24)) >>> 0
    );
  }
  return { offsets: offsets, count: count };
}

/* ---------------- UTF-8 解码（readArrayBuffer 回退） ---------------- */

/**
 * 从 Uint8Array 解码 UTF-8。起点若落在续字节，回退到该字符的 lead byte。
 * @param {Uint8Array} buf
 * @param {number} start 起始字节
 * @param {number} end 结束字节（不含）
 * @returns {string}
 */
function utf8Decode(buf, start, end) {
  var s = start;
  /* 回退到 lead byte（非续字节 0x80-0xBF） */
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

/* ---------------- 落盘 ---------------- */

/**
 * 保存章文件 + 页表。text = 全文；starts = 页起始字符偏移。
 * cb(ok)。按设备能力自动选二进制/文本页表格式。
 */
function save(url, text, starts, cb) {
  var done = Fs.once(cb);
  if (!url || !text || !starts || starts.length < 1) {
    done(false);
    return;
  }
  var key = keyOf(url);
  Fs.ensureDir(MKDIR_URI, function () {
    Fs.writeSmall(txtUri(key), text, function (ok) {
      if (!ok) {
        done(false);
        return;
      }
      /* 计算字节偏移 */
      var offsets = [];
      var bytePos = 0;
      for (var i = 0; i < starts.length; i += 1) {
        offsets.push(bytePos);
        var seg = i + 1 < starts.length ? text.substring(starts[i], starts[i + 1]) : text.substring(starts[i]);
        bytePos += Fs.utf8Len(seg);
      }
      /* 按设备能力选页表格式 */
      if (typeof file.writeArrayBuffer === 'function') {
        writeIdxBinary(key, offsets, done);
      } else {
        writeIdxText(key, offsets, done);
      }
    });
  });
}

/** 二进制页表（高端设备）：magic 'PGT1' + count(Uint16) + offsets(Uint32) */
function writeIdxBinary(key, offsets, done) {
  var idxBuf = encodeIdx(offsets);
  Fs.runOp(function (release) {
    var guard = setTimeout(function () {
      release();
      done(false);
    }, 3000);
    try {
      file.writeArrayBuffer({
        uri: idxUri(key),
        buffer: idxBuf,
        append: false,
        success: function () {
          clearTimeout(guard);
          release();
          done(true);
        },
        fail: function () {
          clearTimeout(guard);
          release();
          done(false);
        }
      });
    } catch (err) {
      clearTimeout(guard);
      release();
      done(false);
    }
  });
}

/** 文本页表（受限设备，无 writeArrayBuffer）：逗号分隔字节偏移 */
function writeIdxText(key, offsets, done) {
  Fs.writeSmall(idxUri(key), offsets.join(','), function (ok) {
    done(ok);
  });
}

/* ---------------- 读页 ---------------- */

/**
 * 读取第 pageIndex 页。cb(text)。
 * 页缓存命中则 0 次文件调用；未命中 1 次 readText + 可选 readArrayBuffer 回退。
 */
function loadPage(key, pageIndex, cb) {
  var done = Fs.once(cb);
  var cacheKey = key + ':' + String(pageIndex);
  if (pageCache[cacheKey] !== undefined) {
    /* LRU 触达 */
    var idx = cacheOrder.indexOf(cacheKey);
    if (idx >= 0) {
      cacheOrder.splice(idx, 1);
    }
    cacheOrder.push(cacheKey);
    done(pageCache[cacheKey]);
    return;
  }
  var info = idxCache[key];
  if (!info) {
    /* 页表未加载：先读页表 */
    loadIdx(key, function (loaded) {
      if (!loaded) {
        done('');
        return;
      }
      loadPage(key, pageIndex, done);
    });
    return;
  }
  if (pageIndex < 0 || pageIndex >= info.count) {
    done('');
    return;
  }
  var bs = info.offsets[pageIndex];
  var be = pageIndex + 1 < info.count ? info.offsets[pageIndex + 1] : -1;
  var len = be > 0 ? be - bs : 4000;

  /* 探针实测：readText position=字节偏移，单读上限精确 4096B。
     一页 ≈360B，正常场景 len 远低于 4096；超限时走 readArrayBuffer 回退。 */
  if (len <= 4096) {
    Fs.runOp(function (release) {
      var guard = setTimeout(function () {
        release();
        done('');
      }, 3000);
      try {
        file.readText({
          uri: txtUri(key),
          encoding: 'UTF-8',
          position: bs,
          length: len,
          success: function (data) {
            clearTimeout(guard);
            release();
            var text = data && data.text ? String(data.text) : '';
            putCache(cacheKey, text);
            done(text);
          },
          fail: function () {
            clearTimeout(guard);
            release();
            /* readText 失败（如 position 语义在该机型不符），回退 readArrayBuffer */
            readViaBuffer(key, bs, len, cacheKey, done);
          }
        });
      } catch (err) {
        clearTimeout(guard);
        release();
        readViaBuffer(key, bs, len, cacheKey, done);
      }
    });
  } else {
    readViaBuffer(key, bs, len, cacheKey, done);
  }
}

/** readArrayBuffer + 手写 UTF-8 解码（len > 4096 时的回退路径）。 */
function readViaBuffer(key, bs, len, cacheKey, done) {
  Fs.runOp(function (release) {
    var guard = setTimeout(function () {
      release();
      done('');
    }, 3000);
    try {
      if (typeof file.readArrayBuffer === 'function') {
        file.readArrayBuffer({
          uri: txtUri(key),
          position: bs,
          length: len,
          success: function (data) {
            clearTimeout(guard);
            release();
            var buf = data && data.buffer ? data.buffer : null;
            var text = buf ? utf8Decode(buf, 0, buf.length) : '';
            putCache(cacheKey, text);
            done(text);
          },
          fail: function () {
            clearTimeout(guard);
            release();
            done('');
          }
        });
      } else {
        clearTimeout(guard);
        release();
        done('');
      }
    } catch (err) {
      clearTimeout(guard);
      release();
      done('');
    }
  });
}

function loadIdx(key, cb) {
  var done = Fs.once(cb);
  if (idxCache[key]) {
    done(idxCache[key]);
    return;
  }
  /* 先尝试二进制页表（高端设备），失败后尝试文本页表（受限设备） */
  loadIdxBinary(key, function (decoded) {
    if (decoded) {
      done(decoded);
      return;
    }
    loadIdxText(key, done);
  });
}

/** 二进制页表读取（readArrayBuffer，FIT5 Pro 等高端设备）。 */
function loadIdxBinary(key, cb) {
  var done = Fs.once(cb);
  Fs.runOp(function (release) {
    var guard = setTimeout(function () {
      release();
      done(null);
    }, 3000);
    try {
      if (typeof file.readArrayBuffer === 'function') {
        file.readArrayBuffer({
          uri: idxUri(key),
          position: 0,
          length: 4096,
          success: function (data) {
            clearTimeout(guard);
            release();
            var buf = data && data.buffer ? data.buffer : null;
            var decoded = buf ? decodeIdx(buf) : null;
            if (decoded) {
              idxCache[key] = decoded;
            }
            done(decoded);
          },
          fail: function () {
            clearTimeout(guard);
            release();
            done(null);
          }
        });
      } else {
        clearTimeout(guard);
        release();
        done(null);
      }
    } catch (err) {
      clearTimeout(guard);
      release();
      done(null);
    }
  });
}

/** 文本页表读取（readText，FIT4/GT6 等受限设备）。格式："0,360,720,..." */
function loadIdxText(key, cb) {
  var done = Fs.once(cb);
  Fs.readSmall(idxUri(key), function (raw) {
    if (!raw) {
      done(null);
      return;
    }
    var parts = raw.split(',');
    var offsets = [];
    for (var i = 0; i < parts.length; i += 1) {
      var n = parseInt(parts[i], 10);
      if (!isNaN(n) && n >= 0) {
        offsets.push(n);
      }
    }
    if (offsets.length < 1) {
      done(null);
      return;
    }
    var decoded = { offsets: offsets, count: offsets.length };
    idxCache[key] = decoded;
    done(decoded);
  });
}

function putCache(cacheKey, text) {
  pageCache[cacheKey] = text;
  cacheOrder.push(cacheKey);
  /* LRU 2 页 */
  while (cacheOrder.length > 2) {
    var evict = cacheOrder.shift();
    delete pageCache[evict];
  }
}

/**
 * 检查某章是否已落盘。cb(exists)。
 */
function exists(url, cb) {
  var done = Fs.once(cb);
  var key = keyOf(url);
  Fs.runOp(function (release) {
    var guard = setTimeout(function () {
      release();
      done(false);
    }, 600);
    try {
      if (typeof file.access === 'function') {
        file.access({
          uri: txtUri(key),
          success: function () {
            clearTimeout(guard);
            release();
            done(true);
          },
          fail: function () {
            clearTimeout(guard);
            release();
            done(false);
          }
        });
      } else {
        clearTimeout(guard);
        release();
        done(false);
      }
    } catch (err) {
      clearTimeout(guard);
      release();
      done(false);
    }
  });
}

/** 清除某章的缓存与页表（不删文件）。 */
function evict(url) {
  var key = keyOf(url);
  delete idxCache[key];
  var prefix = key + ':';
  var toDelete = [];
  for (var i = 0; i < cacheOrder.length; i += 1) {
    if (cacheOrder[i].indexOf(prefix) === 0) {
      toDelete.push(cacheOrder[i]);
    }
  }
  for (var j = 0; j < toDelete.length; j += 1) {
    delete pageCache[toDelete[j]];
    var idx = cacheOrder.indexOf(toDelete[j]);
    if (idx >= 0) {
      cacheOrder.splice(idx, 1);
    }
  }
}

export default {
  keyOf: keyOf,
  save: save,
  loadPage: loadPage,
  loadIdx: loadIdx,
  exists: exists,
  evict: evict,
  encodeIdx: encodeIdx,
  decodeIdx: decodeIdx,
  utf8Decode: utf8Decode
};
