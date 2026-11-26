/**
 * 存储占用统计与清理（信息页用，v3.3）。
 *
 * 口径（v3.3 网页缓存功能已整体删除）：
 * - **本地文件** = internal://app/saved/（离线网页正文，清除即删除全部离线内容，
 *   属用户内容 → 信息页侧做二次确认）；
 * - 书签/历史/设置（internal://app/data/）**不计入、不提供清除**——用户数据；
 * - internal://app/c/（旧版网页缓存遗留）由 purgeLegacyCache 一次性回收，
 *   不再计入任何统计。
 *
 * 统计走 file.list（fileList 每项含 length 字节值）；清理走 Fs.deleteList
 * **串行**删除（v3.2 崩溃教训：绝不并行删除洪峰）。全部回调恰好一次、异常降级。
 */
import Fs from './fsutil.js';

var SAVED_DIR = 'internal://app/saved';
var LEGACY_CACHE_DIR = 'internal://app/c';

/** 单目录占用统计（经全局串行队列，v3.7）。cb(bytes, count)，必回调。 */
function dirUsage(dirUri, cb) {
  var end = Fs.once(cb);
  Fs.listDir(dirUri, function (entries) {
    var bytes = 0;
    var count = 0;
    for (var i = 0; i < entries.length; i += 1) {
      bytes += Number(entries[i].length) || 0;
      count += 1;
    }
    end(bytes, count);
  });
}

/** 总览。cb({savedBytes, savedCount})，必回调。 */
function usage(cb) {
  var end = Fs.once(cb);
  dirUsage(SAVED_DIR, function (bytes, count) {
    end({ savedBytes: bytes, savedCount: count });
  });
}

/** 列出目录下普通文件 URI；cb(uris)，必回调。 */
function listFiles(dirUri, cb) {
  var end = Fs.once(cb);
  Fs.listDir(dirUri, function (entries) {
    var uris = [];
    for (var i = 0; i < entries.length; i += 1) {
      uris.push(String(entries[i].uri));
    }
    end(uris);
  });
}

/** 清除本地文件（saved/ 全部文件 = 全部离线网页）。cb(ok)，必回调。 */
function clearSaved(cb) {
  var end = Fs.once(cb);
  listFiles(SAVED_DIR, function (uris) {
    Fs.deleteList(uris, function () {
      end(true);
    });
  });
}

/**
 * 旧版网页缓存遗留回收（v3.3 功能删除，internal://app/c/ 一次性清空）。
 * 应用启动时尽力执行，不等待、不影响任何主链路；cb 可省略。
 */
function purgeLegacyCache(cb) {
  var end = Fs.once(cb);
  listFiles(LEGACY_CACHE_DIR, function (uris) {
    if (uris.length < 1) {
      end(true);
      return;
    }
    Fs.deleteList(uris, function () {
      end(true);
    });
  });
}

/** 字节数显示格式化：'128 KB' / '1.2 MB'。 */
function formatBytes(bytes) {
  var n = Number(bytes) || 0;
  if (n < 1024) {
    return n + ' B';
  }
  if (n < 1024 * 1024) {
    var kb = n / 1024;
    return (kb < 10 ? kb.toFixed(1) : Math.round(kb)) + ' KB';
  }
  var mb = n / (1024 * 1024);
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
}

export default {
  usage: usage,
  clearSaved: clearSaved,
  purgeLegacyCache: purgeLegacyCache,
  formatBytes: formatBytes
};
