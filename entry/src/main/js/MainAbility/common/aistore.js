/**
 * AI 抓取正文的临时分片存储（v1.1.2）。
 *
 * 目录：internal://app/ai/
 *   <key>.0..n  —— 正文分片（每片 ≤1200 字，复用 fsutil.writeParts）
 *
 * 只保存最近一次 AI 阅读的正文；key 由 URL 哈希得到，阅读页只接收 key，
 * 避免把大文本塞进路由参数或 @system.storage（128B 限制）。
 */
import Fs from './fsutil.js';

var DIR = 'internal://app/ai';
var BASE = DIR + '/';
var MAX_PARTS = 24;

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

/**
 * 保存正文。text 应已按设备上限截断；cb(ok)。
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
    Fs.writeParts(baseOf(key), src, MAX_PARTS, function (ok) {
      finish(ok);
    }, { terminate: true });
  });
}

/**
 * 读取正文。cb(text)；找不到返回空串。
 */
function load(url, cb) {
  var key = keyOf(url);
  Fs.readParts(baseOf(key), MAX_PARTS, function (text) {
    if (typeof cb === 'function') { cb(text || ''); }
  });
}

/**
 * 删除某 URL 的临时正文（可选清理）。cb(ok)。
 */
function clear(url, cb) {
  var key = keyOf(url);
  Fs.quietDeleteRange(baseOf(key), 0, MAX_PARTS, function () {
    if (typeof cb === 'function') { cb(true); }
  });
}

export default {
  keyOf: keyOf,
  save: save,
  load: load,
  clear: clear,
  MAX_PARTS: MAX_PARTS
};
