/**
 * URL helpers. No regular-expression literals: ArkUI.Lite fails to load a
 * module that contains one, so every scan uses indexOf / charAt / split.
 */
import Config from './config.js';

var SLASH = '/';

function trim(value) {
  if (value === null || value === undefined) {
    return '';
  }
  var s = String(value);
  var a = 0;
  var b = s.length;
  function blank(code) {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 160 || code === 12288;
  }
  while (a < b && blank(s.charCodeAt(a))) {
    a += 1;
  }
  while (b > a && blank(s.charCodeAt(b - 1))) {
    b -= 1;
  }
  return s.substring(a, b);
}

function hasSpace(s) {
  for (var i = 0; i < s.length; i += 1) {
    var c = s.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      return true;
    }
  }
  return false;
}

function digits(s) {
  if (!s) {
    return false;
  }
  for (var i = 0; i < s.length; i += 1) {
    var c = s.charAt(i);
    if (c < '0' || c > '9') {
      return false;
    }
  }
  return true;
}

function hostOk(host) {
  if (!host || host.charAt(0) === '.' || host.charAt(0) === '-') {
    return false;
  }
  var last = host.charAt(host.length - 1);
  if (last === '.' || last === '-') {
    return false;
  }
  for (var i = 0; i < host.length; i += 1) {
    var c = host.charAt(i);
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '-') {
      continue;
    }
    if (c.charCodeAt(0) < 128) {
      return false;
    }
  }
  return host === 'localhost' || host.indexOf('.') >= 0;
}

function cleanPath(path) {
  var parts = path.split(SLASH);
  var stack = [];
  for (var i = 0; i < parts.length; i += 1) {
    if (parts[i] === '..') {
      if (stack.length > 0) {
        stack.length -= 1;
      }
    } else if (parts[i] && parts[i] !== '.') {
      stack.push(parts[i]);
    }
  }
  var out = '';
  for (var k = 0; k < stack.length; k += 1) {
    out += SLASH + stack[k];
  }
  if (path.charAt(path.length - 1) === SLASH) {
    out += SLASH;
  }
  return out || SLASH;
}

/** Absolute http(s) URL, or '' when the input must not be requested. */
function normalize(input) {
  var s = trim(input);
  if (!s || hasSpace(s)) {
    return '';
  }
  if (s.indexOf('://') < 0) {
    s = s.indexOf('//') === 0 ? 'https:' + s : 'https://' + s;
  }
  var sep = s.indexOf('://');
  if (sep <= 0) {
    return '';
  }
  var scheme = s.substring(0, sep).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return '';
  }
  var rest = s.substring(sep + 3);
  var hash = rest.indexOf('#');
  if (hash >= 0) {
    rest = rest.substring(0, hash);
  }
  if (!rest) {
    return '';
  }
  var cut = rest.length;
  var slash = rest.indexOf(SLASH);
  var question = rest.indexOf('?');
  if (slash >= 0 && slash < cut) {
    cut = slash;
  }
  if (question >= 0 && question < cut) {
    cut = question;
  }
  var authority = rest.substring(0, cut);
  var tail = rest.substring(cut);
  var at = authority.lastIndexOf('@');
  if (at >= 0) {
    authority = authority.substring(at + 1);
  }
  var host = authority;
  var port = '';
  var colon = authority.indexOf(':');
  if (colon >= 0) {
    host = authority.substring(0, colon);
    port = authority.substring(colon + 1);
  }
  if (!hostOk(host) || (port && (!digits(port) || port.length > 5))) {
    return '';
  }
  var path = tail;
  var query = '';
  var q = tail.indexOf('?');
  if (q >= 0) {
    path = tail.substring(0, q);
    query = tail.substring(q);
  }
  var out = scheme + '://' + host + (port ? ':' + port : '') + cleanPath(path);
  return out + query;
}

/** Resolves href against a base URL; '' for anchors and non-web schemes. */
function resolve(base, href) {
  var h = trim(href);
  if (!h) {
    return '';
  }
  var colon = h.indexOf(':');
  if (colon > 0) {
    var scheme = h.substring(0, colon).toLowerCase();
    return scheme === 'http' || scheme === 'https' ? normalize(h) : '';
  }
  var b = normalize(base);
  if (!b) {
    return '';
  }
  if (h.indexOf('//') === 0) {
    return normalize(b.substring(0, b.indexOf('://') + 1) + h);
  }
  if (h.charAt(0) === '#') {
    return '';
  }
  var schemeEnd = b.indexOf('://');
  var pathStart = b.indexOf(SLASH, schemeEnd + 3);
  var origin = pathStart < 0 ? b : b.substring(0, pathStart);
  var pathQuery = pathStart < 0 ? SLASH : b.substring(pathStart);
  var q = pathQuery.indexOf('?');
  var basePath = q < 0 ? pathQuery : pathQuery.substring(0, q);
  if (h.charAt(0) === '?') {
    return normalize(origin + basePath + h);
  }
  if (h.charAt(0) === SLASH) {
    return normalize(origin + h);
  }
  var slash = basePath.lastIndexOf(SLASH);
  return normalize(origin + (slash >= 0 ? basePath.substring(0, slash + 1) : SLASH) + h);
}

function hostOf(url) {
  if (!url) {
    return '';
  }
  var s = trim(url);
  var sep = s.indexOf('://');
  var rest = sep < 0 ? s : s.substring(sep + 3);
  var cut = rest.length;
  var marks = [rest.indexOf(SLASH), rest.indexOf('?'), rest.indexOf('#')];
  for (var i = 0; i < marks.length; i += 1) {
    if (marks[i] >= 0 && marks[i] < cut) {
      cut = marks[i];
    }
  }
  rest = rest.substring(0, cut);
  var at = rest.lastIndexOf('@');
  if (at >= 0) {
    rest = rest.substring(at + 1);
  }
  var colon = rest.lastIndexOf(':');
  if (colon > 0) {
    rest = rest.substring(0, colon);
  }
  if (rest.indexOf('www.') === 0) {
    rest = rest.substring(4);
  }
  return rest.length > 40 ? rest.substring(0, 40) : rest;
}

function displayOf(url) {
  if (!url) {
    return '';
  }
  var s = trim(url);
  var sep = s.indexOf('://');
  var out = sep >= 0 ? s.substring(sep + 3) : s;
  var hash = out.indexOf('#');
  if (hash >= 0) {
    out = out.substring(0, hash);
  }
  var max = Config.DISPLAY_URL_CHARS;
  return out.length > max ? out.substring(0, max - 1) + '…' : out;
}

/**
 * 浏览器地址栏习惯的输入判定：含点/冒号/斜杠且无空格 → 按网址处理，
 * 否则按搜索关键词。搜索框整合地址栏功能后由 search.js 调用。
 */
function looksLikeUrl(input) {
  var t = trim(input);
  if (!t) {
    return false;
  }
  return (t.indexOf('.') >= 0 || t.indexOf(':') >= 0 || t.indexOf('/') >= 0) && t.indexOf(' ') < 0;
}

/** 疑似「整本目录页」：路径恰两段、第二段纯数字、首段为目录类词
 *  （/chapter/933334、/list/123、/toc/456 …）。
 *  v3.10 真机根因：创世目录页 419KB / 853 链接，@system.fetch 无视 Range、
 *  HEAD 预检被该站 500 拒绝——响应整包序列化进 698KB 堆必崩，JS 侧无法
 *  提前截断。典型章节页是 /read/<书号>/<章号> 三段，不会命中。 */
function looksLikeToc(u) {
  var s = trim(u);
  if (!s) {
    return false;
  }
  var sep = s.indexOf('://');
  var rest = sep >= 0 ? s.substring(sep + 3) : s;
  var slash = rest.indexOf('/');
  if (slash < 0) {
    return false;
  }
  var path = rest.substring(slash);
  var cut = path.indexOf('?');
  if (cut >= 0) {
    path = path.substring(0, cut);
  }
  cut = path.indexOf('#');
  if (cut >= 0) {
    path = path.substring(0, cut);
  }
  var segs = path.split(SLASH);
  var parts = [];
  for (var i = 0; i < segs.length; i += 1) {
    if (segs[i]) {
      parts.push(segs[i]);
    }
  }
  if (parts.length !== 2 || !digits(parts[1])) {
    return false;
  }
  var head = parts[0].toLowerCase();
  return head === 'chapter' || head === 'chapters' || head === 'list' ||
    head === 'toc' || head === 'catalog' || head === 'catalogue' || head === 'directory';
}

export default {
  normalize: normalize,
  resolve: resolve,
  hostOf: hostOf,
  displayOf: displayOf,
  looksLikeUrl: looksLikeUrl,
  looksLikeToc: looksLikeToc,
  trim: trim
};
