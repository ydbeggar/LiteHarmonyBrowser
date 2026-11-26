/**
 * Persistence — v3.4：每数据集**单个小文件**（UTF-8 字节预算，单次 readText/writeText）。
 *
 * 崩溃根因（v3.1~v3.3 表现完全一致、v3.0 正常，逐 bundle 实证定案）：
 * Lite 每页独立 bundle、store 随页重建（模块级变量不跨页共享）——
 * v3.1 的大 JSON 分片格式让**每次翻章**都触发：
 *   - init 3 条 readParts 链（约 33 次 readText）；
 *   - addHistory 整表重写（15~17 次 writeText + 尾部删除洪峰）；
 *   - setCurrent 2 次文件写；
 * 合计约 65 次 @system.file 操作——持续浏览必然崩溃。v3.0 全程只有
 * storage kv + 单文件 append（约 3 次轻操作）故稳定。
 *
 * v3.4 把 I/O 压回 v3.0 等级（功能完整保留）：
 * - init 每页最多 3 次小读（bm.txt / hs.txt / pf.txt）；
 * - 每次变更恰好 1 次小写；同址重复访问纯内存刷新不落盘；
 * - 无任何删除洪峰（旧分片仅升级迁移时串行回收一次）；
 * - 数据完整性优于 v3.0：单文件整表无 storage 128B 静默丢失。
 *
 * 文件：internal://app/data/{bm,hs,pf}.txt —— JSON 单串。写入按 UTF-8
 * 字节预算（3900B < readText 4000B 上限）从新到旧取条目，装不下的旧条目
 * **整条**丢弃（URL 不截断，避免产生打不开的链接）。
 * 迁移（各一次）：v3.1~v3.3 分片（{name}.N）读回合并 → 写单文件 →串行
 * 删分片；v1 storage 键 → 写单文件 → 删旧键。单文件存在即用（幂等）。
 */
import storage from '@system.storage';
import Config from './config.js';
import Fs from './fsutil.js';

var bookmarks = [];
var historyList = [];
/* keepScreenOn（v3.7 屏幕常亮设定）默认开启：加载时息屏会把应用切后台被回收
   forceFull（v1.0.8 强开完整模式）默认关闭：受限设备手动开启后按 FIT5 档位运行 */
var prefs = { fontSize: 24, lineHeight: 1.55, keepScreenOn: true, forceFull: false };

var DATA_DIR = 'internal://app/data';
var DATA_BASE = DATA_DIR + '/';
var BYTE_BUDGET = 3900;
var LEGACY_MAX_PARTS = 20;

var ready = false;
var loading = false;
var callbacks = [];
var pending = [];
var onWriteError = null;
var pendingLoads = 0;
var timer = 0;

function clamp(value, max) {
  var s = value === null || value === undefined ? '' : String(value);
  return s.length > max ? s.substring(0, max) : s;
}

function normalizeEntry(item, timeField) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  var url = clamp(item.url, Config.MAX_URL_CHARS);
  if (!url) {
    return null;
  }
  var title = clamp(item.title, Config.MAX_TITLE_CHARS);
  if (!title) {
    title = clamp(url, Config.MAX_TITLE_CHARS);
  }
  var out = { url: url, title: title };
  var t = Number(item[timeField]);
  out[timeField] = isNaN(t) || t < 0 ? 0 : Math.floor(t);
  return out;
}

function parseList(raw, timeField) {
  var parsed = [];
  if (typeof raw === 'string' && raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = [];
    }
  }
  if (Object.prototype.toString.call(parsed) !== '[object Array]') {
    parsed = [];
  }
  var out = [];
  var seen = {};
  for (var i = 0; i < parsed.length && out.length < Config.MAX_STORE_ITEMS; i += 1) {
    var entry = normalizeEntry(parsed[i], timeField);
    if (entry && !Object.prototype.hasOwnProperty.call(seen, entry.url)) {
      seen[entry.url] = 1;
      out.push(entry);
    }
  }
  out.sort(function (a, b) {
    return b[timeField] - a[timeField];
  });
  return out;
}

/* v2.0 字号/行距档位整体上移：旧值按档位序号迁移，保持用户选择的相对档位
   （L2 数据兼容：旧 prefs 必须能读，不得静默丢弃）。 */
var LEGACY_FONT_SIZES = [18, 20, 22, 24];
var LEGACY_LINE_HEIGHTS = [1.5, 1.7, 1.9];

function mapTier(value, current, legacy) {
  var n = Number(value);
  var idx = current.indexOf(n);
  if (idx >= 0) {
    return n;
  }
  idx = legacy.indexOf(n);
  return idx >= 0 ? current[idx < current.length ? idx : current.length - 1] : -1;
}

function normalizePrefs(value) {
  var out = {
    fontSize: Config.FONT_SIZES[Config.DEFAULT_FONT_LEVEL],
    lineHeight: Config.LINE_HEIGHTS[Config.DEFAULT_LINE_LEVEL],
    keepScreenOn: true,
    forceFull: false
  };
  if (!value || typeof value !== 'object') {
    return out;
  }
  var fs = mapTier(value.fontSize, Config.FONT_SIZES, LEGACY_FONT_SIZES);
  if (fs >= 0) {
    out.fontSize = fs;
  }
  var lh = mapTier(value.lineHeight, Config.LINE_HEIGHTS, LEGACY_LINE_HEIGHTS);
  if (lh >= 0) {
    out.lineHeight = lh;
  }
  /* 屏幕常亮：显式 false 才关闭；缺失（旧版 prefs）默认开启 */
  out.keepScreenOn = value.keepScreenOn !== false;
  /* 强开完整模式：显式 true 才开启；缺失默认关闭 */
  out.forceFull = value.forceFull === true;
  return out;
}

function parsePrefs(raw) {
  var value = null;
  if (typeof raw === 'string' && raw) {
    try {
      value = JSON.parse(raw);
    } catch (err) {
      value = null;
    }
  }
  return normalizePrefs(value);
}

function notifyError() {
  if (typeof onWriteError === 'function') {
    try {
      onWriteError();
    } catch (err) {
      /* ignore */
    }
  }
}

/* ---------------- 单小文件持久化（v3.4 核心） ---------------- */

/** 列表序列化：新→旧累计，超字节预算的旧条目整条丢弃（URL 不截断）。 */
function packList(list) {
  var parts = [];
  var used = 2;
  for (var i = 0; i < list.length; i += 1) {
    var piece = '';
    try {
      piece = JSON.stringify(list[i]);
    } catch (err) {
      continue;
    }
    var add = Fs.utf8Len(piece) + (parts.length > 0 ? 1 : 0);
    if (used + add > BYTE_BUDGET) {
      break;
    }
    parts.push(piece);
    used += add;
  }
  return '[' + parts.join(',') + ']';
}

/** 单文件覆盖写（一次 writeText，调用方不依赖结果）。 */
function persist(name, value) {
  var text = '';
  try {
    text = name === 'pf' ? JSON.stringify(value) : packList(value);
  } catch (err) {
    text = name === 'pf' ? '{}' : '[]';
  }
  try {
    Fs.ensureDir(DATA_DIR, function () {
      Fs.writeSmall(DATA_BASE + name + '.txt', text, function (ok) {
        if (!ok) {
          notifyError();
        }
      });
    });
  } catch (err2) {
    notifyError();
  }
}

function whenReady(fn) {
  if (ready) {
    fn();
  } else {
    pending.push(fn);
  }
}

function finish() {
  ready = true;
  loading = false;
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
  var queue = pending;
  pending = [];
  for (var i = 0; i < queue.length; i += 1) {
    try {
      queue[i]();
    } catch (err) {
      /* isolated */
    }
  }
  var list = callbacks;
  callbacks = [];
  for (var k = 0; k < list.length; k += 1) {
    try {
      list[k]();
    } catch (err) {
      /* isolated */
    }
  }
}

/**
 * 载入一个数据集（单文件优先）：
 * 1) {name}.txt 单文件（v3.4 格式）——命中即用；
 * 2) v3.1~v3.3 分片（{name}.N）——读回合并 → 写单文件 → 串行删分片（一次性）；
 * 3) v1 storage 键——写单文件 → 删旧键（一次性）；
 * 全空时写入空表标记，后续页面首读即命中，不再走迁移分支。
 */
function loadDataset(name, storageKey, apply) {
  pendingLoads += 1;
  var emptyMark = name === 'pf' ? '{}' : '[]';
  function settle(raw) {
    apply(raw);
    pendingLoads -= 1;
    if (pendingLoads <= 0) {
      finish();
    }
  }
  Fs.readSmall(DATA_BASE + name + '.txt', function (raw, readOk, readCode) {
    /* 301=文件不存在，才允许进入迁移/初始化；300/302/超时等读错误
       必须保留内存空值，绝不能写空表覆盖原有数据。 */
    if (!readOk && String(readCode) !== '301') {
      settle('');
      return;
    }
    if (raw) {
      settle(raw);
      return;
    }
    Fs.readParts(DATA_BASE + name + '.', LEGACY_MAX_PARTS, function (parts) {
      if (parts) {
        settle(parts);
        Fs.ensureDir(DATA_DIR, function () {
          /* 只有迁移写成功后才删旧分片，避免“新文件没写成、旧数据已删”。 */
          Fs.writeSmall(DATA_BASE + name + '.txt', parts, function (ok) {
            if (ok) {
              Fs.quietDeleteRange(DATA_BASE + name + '.', 0, LEGACY_MAX_PARTS);
            }
          });
        });
        return;
      }
      try {
        storage.get({
          key: storageKey,
          default: '',
          success: function (legacy) {
            var v = typeof legacy === 'string' ? legacy : '';
            if (v) {
              Fs.ensureDir(DATA_DIR, function () {
                Fs.writeSmall(DATA_BASE + name + '.txt', v, function (ok) {
                  /* 单文件写成功后才删 legacy storage，失败时保留旧值重试。 */
                  if (ok) {
                    try {
                      storage.delete({ key: storageKey });
                    } catch (err) {
                      /* ignore */
                    }
                  }
                });
              });
              settle(v);
              return;
            }
            Fs.ensureDir(DATA_DIR, function () {
              Fs.writeSmall(DATA_BASE + name + '.txt', emptyMark, function () {});
            });
            settle('');
          },
          fail: function () {
            settle('');
          }
        });
      } catch (err2) {
        settle('');
      }
    });
  });
}

function init(callback) {
  if (ready) {
    if (typeof callback === 'function') {
      callback();
    }
    return;
  }
  if (typeof callback === 'function') {
    callbacks.push(callback);
  }
  if (loading) {
    return;
  }
  loading = true;
  pendingLoads = 0;
  timer = setTimeout(function () {
    if (!ready) {
      finish();
    }
  }, 1200);
  loadDataset('bm', Config.KEY_BOOKMARKS, function (raw) {
    bookmarks = parseList(raw, 'savedAt');
  });
  loadDataset('hs', Config.KEY_HISTORY, function (raw) {
    historyList = parseList(raw, 'visitedAt');
  });
  loadDataset('pf', Config.KEY_PREFS, function (raw) {
    prefs = parsePrefs(raw);
  });
}

function addTop(list, entry, timeField) {
  var next = [entry];
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].url !== entry.url) {
      next.push(list[i]);
    }
  }
  if (next.length > Config.MAX_STORE_ITEMS) {
    next.length = Config.MAX_STORE_ITEMS;
  }
  return next;
}

function removeByUrl(list, url) {
  var next = [];
  for (var i = 0; i < list.length; i += 1) {
    if (list[i].url !== url) {
      next.push(list[i]);
    }
  }
  return next;
}

function saveBookmarkNow(data) {
  var entry = normalizeEntry(data, 'savedAt');
  if (!entry) {
    return;
  }
  if (!entry.savedAt) {
    entry.savedAt = Date.now();
  }
  bookmarks = addTop(bookmarks, entry, 'savedAt');
  persist('bm', bookmarks);
}

function saveBookmark(bookmark) {
  if (!bookmark || !bookmark.url) {
    return false;
  }
  var copy = { url: bookmark.url, title: bookmark.title, savedAt: bookmark.savedAt };
  whenReady(function () {
    saveBookmarkNow(copy);
  });
  return true;
}

function isBookmarked(url) {
  for (var i = 0; i < bookmarks.length; i += 1) {
    if (bookmarks[i].url === url) {
      return true;
    }
  }
  return false;
}

function removeBookmark(url) {
  whenReady(function () {
    bookmarks = removeByUrl(bookmarks, url);
    persist('bm', bookmarks);
  });
  return true;
}

function toggleBookmark(bookmark) {
  if (!bookmark || !bookmark.url) {
    return false;
  }
  var saved = !isBookmarked(bookmark.url);
  var copy = { url: bookmark.url, title: bookmark.title, savedAt: bookmark.savedAt };
  whenReady(function () {
    if (saved) {
      saveBookmarkNow(copy);
    } else {
      bookmarks = removeByUrl(bookmarks, copy.url);
      persist('bm', bookmarks);
    }
  });
  return saved;
}

function addHistoryNow(data) {
  var entry = normalizeEntry(data, 'visitedAt');
  if (!entry) {
    return;
  }
  if (!entry.visitedAt) {
    entry.visitedAt = Date.now();
  }
  /* 同址置顶刷新纯内存：重复访问（同页重渲染）不落盘——浏览期写入最小化 */
  if (historyList.length > 0 && historyList[0].url === entry.url) {
    historyList[0] = entry;
    return;
  }
  historyList = addTop(historyList, entry, 'visitedAt');
  persist('hs', historyList);
}

function addHistory(entry) {
  if (!entry || !entry.url) {
    return false;
  }
  var copy = { url: entry.url, title: entry.title, visitedAt: entry.visitedAt };
  whenReady(function () {
    addHistoryNow(copy);
  });
  return true;
}

function removeHistory(url) {
  whenReady(function () {
    historyList = removeByUrl(historyList, url);
    persist('hs', historyList);
  });
  return true;
}

function clearHistory() {
  whenReady(function () {
    historyList = [];
    persist('hs', historyList);
  });
  return true;
}

function savePrefs(next) {
  var copy = { fontSize: next.fontSize, lineHeight: next.lineHeight, keepScreenOn: next.keepScreenOn !== false, forceFull: next.forceFull === true };
  whenReady(function () {
    prefs = normalizePrefs(copy);
    persist('pf', prefs);
  });
  return true;
}

function resetState() {
  bookmarks = [];
  historyList = [];
  prefs = {
    fontSize: Config.FONT_SIZES[Config.DEFAULT_FONT_LEVEL],
    lineHeight: Config.LINE_HEIGHTS[Config.DEFAULT_LINE_LEVEL],
    keepScreenOn: true
  };
  ready = false;
  loading = false;
  callbacks = [];
  pending = [];
  pendingLoads = 0;
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
}

export default {
  init: init,
  setWriteErrorHandler: function (handler) {
    onWriteError = handler;
  },
  loadBookmarks: function () {
    return bookmarks;
  },
  isBookmarked: isBookmarked,
  saveBookmark: saveBookmark,
  removeBookmark: removeBookmark,
  toggleBookmark: toggleBookmark,
  loadHistory: function () {
    return historyList;
  },
  addHistory: addHistory,
  removeHistory: removeHistory,
  clearHistory: clearHistory,
  loadPrefs: function () {
    return { fontSize: prefs.fontSize, lineHeight: prefs.lineHeight, keepScreenOn: prefs.keepScreenOn !== false, forceFull: prefs.forceFull === true };
  },
  savePrefs: savePrefs,
  resetState: resetState
};
