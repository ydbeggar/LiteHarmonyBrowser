/**
 * Markdown → 纯文本（v1.1.2，DeepSeek Fetch 返回 Markdown）。
 *
 * 目标不是完整 Markdown 渲染，而是给阅读页提供干净的正文：
 * - 标题/列表/引用符号去掉；
 * - [文字](链接) 保留文字，![图片](链接) 删除；
 * - 代码围栏去掉，行内反引号去掉；
 * - HTML 标签与实体清理；
 * - 连续空行合并，保留段落分隔。
 *
 * 纯 ES5，无正则字面量。
 */
import Rss from './rss.js';

function stripTags(s) {
  var text = s === null || s === undefined ? '' : String(s);
  var out = '';
  var i = 0;
  while (i < text.length) {
    var lt = text.indexOf('<', i);
    if (lt < 0) {
      out += text.substring(i);
      break;
    }
    out += text.substring(i, lt);
    var gt = text.indexOf('>', lt + 1);
    if (gt < 0) {
      break;
    }
    i = gt + 1;
  }
  return out;
}

function stripLinks(s) {
  var out = '';
  var i = 0;
  var text = String(s || '');
  while (i < text.length) {
    var open = text.indexOf('[', i);
    if (open < 0) {
      out += text.substring(i);
      break;
    }
    out += text.substring(i, open);
    var close = text.indexOf(']', open + 1);
    if (close < 0) {
      out += text.substring(open);
      break;
    }
    var paren = close + 1 < text.length && text.charAt(close + 1) === '(';
    if (!paren) {
      out += text.substring(open, close + 1);
      i = close + 1;
      continue;
    }
    var end = text.indexOf(')', close + 2);
    if (end < 0) {
      out += text.substring(open, close + 1);
      i = close + 1;
      continue;
    }
    out += text.substring(open + 1, close);
    i = end + 1;
  }
  return out;
}

function stripImages(s) {
  var out = '';
  var i = 0;
  var text = String(s || '');
  while (i < text.length) {
    var bang = text.indexOf('![', i);
    if (bang < 0) {
      out += text.substring(i);
      break;
    }
    out += text.substring(i, bang);
    var close = text.indexOf(']', bang + 2);
    if (close < 0) {
      out += text.substring(bang);
      break;
    }
    if (close + 1 < text.length && text.charAt(close + 1) === '(') {
      var end = text.indexOf(')', close + 2);
      if (end >= 0) {
        i = end + 1;
        continue;
      }
    }
    out += text.substring(bang, close + 1);
    i = close + 1;
  }
  return out;
}

function stripMarkers(line) {
  var s = String(line || '');
  var i = 0;
  while (i < s.length && (s.charAt(i) === ' ' || s.charAt(i) === '\t')) {
    i += 1;
  }
  s = s.substring(i);
  /* 标题 # ## ### */
  var h = 0;
  while (h < s.length && s.charAt(h) === '#') {
    h += 1;
  }
  if (h > 0 && h <= 6 && (s.length === h || s.charAt(h) === ' ')) {
    s = s.substring(h);
  }
  /* 引用 > */
  while (s.length > 0 && s.charAt(0) === '>') {
    s = s.substring(1);
    if (s.charAt(0) === ' ') {
      s = s.substring(1);
    }
  }
  /* 列表 - * + / 1. */
  if (s.length >= 2 && (s.charAt(0) === '-' || s.charAt(0) === '*' || s.charAt(0) === '+') && s.charAt(1) === ' ') {
    s = s.substring(2);
  } else {
    var n = 0;
    while (n < s.length && s.charAt(n) >= '0' && s.charAt(n) <= '9') {
      n += 1;
    }
    if (n > 0 && n + 1 < s.length && s.charAt(n) === '.' && s.charAt(n + 1) === ' ') {
      s = s.substring(n + 2);
    }
  }
  return s;
}

function stripInline(s) {
  var text = String(s || '');
  text = stripImages(text);
  text = stripLinks(text);
  text = stripTags(text);
  /* 行内代码 / 强调符号：逐字符去掉 */
  var out = '';
  var i = 0;
  while (i < text.length) {
    var ch = text.charAt(i);
    if (ch === '`' || ch === '*' || ch === '_' || ch === '~') {
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return Rss.decode(out);
}

function toText(markdown) {
  var raw = markdown === null || markdown === undefined ? '' : String(markdown);
  var lines = raw.split('\n');
  var out = [];
  var inCode = false;
  var blank = false;
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var trimmed = String(line || '').trim();
    if (trimmed.indexOf('```') === 0) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(String(line || '').split('\t').join('  '));
      continue;
    }
    if (!trimmed) {
      if (!blank) {
        out.push('');
        blank = true;
      }
      continue;
    }
    var cleaned = stripInline(stripMarkers(trimmed)).trim();
    if (cleaned) {
      out.push(cleaned);
      blank = false;
    }
  }
  /* 去首尾空行 */
  while (out.length > 0 && out[0] === '') {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return out.join('\n');
}

export default {
  toText: toText,
  stripInline: stripInline
};
