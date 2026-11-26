/**
 * DeepSeek Search / Fetch API 客户端（v1.1.2）。
 *
 * 官方接口（2026-11 全家桶应用 API）：
 *   POST https://api.deepseek.com/v1/tools/search
 *   POST https://api.deepseek.com/v1/tools/fetch
 * 鉴权：Authorization: Bearer <API Key>
 *
 * 只做网络与 JSON 解析；Key 的读取/保存由 aicfg.js 负责。
 * 纯 ES5，无正则字面量。
 */
import Net from './net.js';

var BASE = 'https://api.deepseek.com';
var MAX_RESULTS = 8;

function apiError(reason) {
  var r = String(reason || '');
  if (r === 'offline') { return '网络不可用'; }
  if (r === 'timeout') { return '请求超时'; }
  if (r === 'unsupported') { return '设备不支持网络'; }
  if (r === 'http-401') { return 'API Key 无效，请重新填写'; }
  if (r === 'http-402') { return 'DeepSeek 余额不足'; }
  if (r === 'http-403') { return '请求被安全策略拒绝'; }
  if (r === 'http-404') { return '网页无法读取'; }
  if (r === 'http-429') { return '请求过于频繁，请稍后重试'; }
  if (r.indexOf('http-5') === 0) { return 'DeepSeek 服务暂时不可用'; }
  if (r === 'unreachable') { return '无法连接 DeepSeek'; }
  return '请求失败';
}

function post(path, body, key, cb, opts) {
  var options = opts || {};
  var header = {
    'Authorization': 'Bearer ' + String(key || ''),
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  Net.request(BASE + path, {
    onSuccess: function (text) {
      var data = null;
      try {
        data = JSON.parse(text);
      } catch (err) {
        if (typeof cb === 'function') {
          cb('解析失败', null);
        }
        return;
      }
      if (data && data.error) {
        var msg = data.error.message ? String(data.error.message) : '服务返回错误';
        if (typeof cb === 'function') {
          cb(msg, null);
        }
        return;
      }
      if (typeof cb === 'function') {
        cb('', data);
      }
    },
    onFail: function (reason) {
      if (typeof cb === 'function') {
        cb(apiError(reason), null);
      }
    }
  }, {
    method: 'POST',
    header: header,
    data: JSON.stringify(body || {}),
    responseType: 'text',
    timeoutMs: options.timeoutMs || 30000,
    maxChars: 240000
  });
}

/**
 * 搜索。cb(err, results)
 * result: {title,url,snippet,summary,siteName,date,authority}
 */
function search(query, key, cb, opts) {
  var q = String(query || '').trim();
  if (!q) {
    if (typeof cb === 'function') { cb('请输入搜索词', null); }
    return;
  }
  if (q.length > 128) {
    q = q.substring(0, 128);
  }
  post('/v1/tools/search', {
    query: q,
    count: MAX_RESULTS,
    need_content: false
  }, key, function (err, data) {
    if (err) {
      if (typeof cb === 'function') { cb(err, null); }
      return;
    }
    var list = [];
    var raw = data && data.results ? data.results : [];
    for (var i = 0; i < raw.length && list.length < MAX_RESULTS; i += 1) {
      var item = raw[i] || {};
      var url = String(item.url || '');
      if (!url) { continue; }
      list.push({
        title: String(item.title || url),
        url: url,
        snippet: String(item.snippet || ''),
        summary: String(item.summary || ''),
        siteName: item.site_name ? String(item.site_name) : '',
        date: item.date ? String(item.date) : '',
        authority: Number(item.authority) || 0
      });
    }
    if (typeof cb === 'function') { cb('', list); }
  }, opts);
}

/**
 * 抓取网页。cb(err, {title, content})
 * content 是 Markdown 文本，由 md.js 转纯文本。
 */
function fetchPage(url, key, cb, opts) {
  var u = String(url || '').trim();
  if (u.indexOf('http://') !== 0 && u.indexOf('https://') !== 0) {
    if (typeof cb === 'function') { cb('请输入 http(s) 网页地址', null); }
    return;
  }
  post('/v1/tools/fetch', { url: u }, key, function (err, data) {
    if (err) {
      if (typeof cb === 'function') { cb(err, null); }
      return;
    }
    var content = data && data.content ? String(data.content) : '';
    if (!content) {
      if (typeof cb === 'function') { cb('网页没有可读正文', null); }
      return;
    }
    if (typeof cb === 'function') {
      cb('', {
        title: data && data.title ? String(data.title) : u,
        content: content
      });
    }
  }, opts);
}

export default {
  search: search,
  fetchPage: fetchPage,
  MAX_RESULTS: MAX_RESULTS
};
