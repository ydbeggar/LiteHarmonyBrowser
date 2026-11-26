/**
 * Single-pass HTML -> readable text extractor. No regular expressions:
 * ArkUI.Lite rejects regex literals at module load time.
 */
import Config from './config.js';
import Url from './url.js';
import Navrule from './navrule.js';
import PageSink from './pagesink.js';

var BLOCK = {
  p: 1, div: 1, br: 1, li: 1, ul: 1, ol: 1, dl: 1, dt: 1, dd: 1,
  tr: 1, td: 1, th: 1, table: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
  section: 1, article: 1, blockquote: 1, pre: 1, hr: 1, figcaption: 1
};

var SKIP = {
  script: 1, style: 1, noscript: 1, template: 1, iframe: 1, svg: 1, canvas: 1,
  video: 1, audio: 1, nav: 1, header: 1, footer: 1, aside: 1, form: 1,
  select: 1, option: 1, textarea: 1, button: 1, object: 1, embed: 1
};

var ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', middot: '·', copy: '©', reg: '®', times: '×',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  laquo: '«', raquo: '»', bull: '•', deg: '°', plusmn: '±',
  euro: '€', pound: '£', yen: '¥', sect: '§', para: '¶'
};

function decodeOne(entity) {
  var e = entity.toLowerCase();
  if (!e) {
    return null;
  }
  if (e.charAt(0) === '#') {
    var code = e.charAt(1) === 'x' ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10);
    if (isNaN(code) || code <= 0 || code > 0x10ffff) {
      return '';
    }
    if (code > 0xffff) {
      var v = code - 0x10000;
      return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
    return String.fromCharCode(code);
  }
  return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : null;
}

function decode(input) {
  if (!input || input.indexOf('&') < 0) {
    return input || '';
  }
  var out = '';
  var i = 0;
  while (i < input.length) {
    var amp = input.indexOf('&', i);
    if (amp < 0) {
      out += input.substring(i);
      break;
    }
    out += input.substring(i, amp);
    var semi = input.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 12) {
      out += '&';
      i = amp + 1;
      continue;
    }
    var d = decodeOne(input.substring(amp + 1, semi));
    if (d === null) {
      out += '&';
      i = amp + 1;
    } else {
      out += d;
      i = semi + 1;
    }
  }
  return out;
}

function isName(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === ':';
}

function tagEnd(s, from) {
  var quote = '';
  for (var i = from; i < s.length; i += 1) {
    var c = s.charAt(i);
    if (quote) {
      if (c === quote) {
        quote = '';
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return -1;
}

function findClose(s, from, tag) {
  var i = from;
  while (i < s.length) {
    var p = s.indexOf('</', i);
    if (p < 0) {
      return -1;
    }
    var ok = true;
    for (var k = 0; k < tag.length; k += 1) {
      if (s.charAt(p + 2 + k).toLowerCase() !== tag.charAt(k)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      var gt = s.indexOf('>', p + 2 + tag.length);
      return gt < 0 ? -1 : gt + 1;
    }
    i = p + 2;
  }
  return -1;
}

/** Extracts the value of any attribute from a raw tag body. */
function attrOf(raw, name) {
  var lower = raw.toLowerCase();
  var needle = name.toLowerCase();
  var i = lower.indexOf(needle);
  while (i >= 0) {
    var before = i === 0 ? ' ' : raw.charAt(i - 1);
    var after = i + needle.length < raw.length ? raw.charAt(i + needle.length) : ' ';
    if ((before === ' ' || before === '\n' || before === '\t' || before === '\r') && after === '=') {
      var j = i + needle.length + 1;
      while (j < raw.length && (raw.charAt(j) === ' ' || raw.charAt(j) === '\n' || raw.charAt(j) === '\t' || raw.charAt(j) === '\r')) {
        j += 1;
      }
      var q = raw.charAt(j);
      if (q === '"' || q === "'") {
        var end = raw.indexOf(q, j + 1);
        return end < 0 ? raw.substring(j + 1) : raw.substring(j + 1, end);
      }
      var stop = j;
      while (stop < raw.length && raw.charAt(stop) !== ' ' && raw.charAt(stop) !== '>') {
        stop += 1;
      }
      return raw.substring(j, stop);
    }
    i = lower.indexOf(needle, i + needle.length);
  }
  return '';
}

/** Extracts the value of an href attribute from a raw tag body. */
function hrefOf(raw) {
  return attrOf(raw, 'href');
}

function truncate(s, max) {
  return s && s.length > max ? s.substring(0, max) : (s || '');
}

/**
 * 移动站正文里常混入整行的推广 / 翻页提示（"本章未完，请点击下一页继续"）。
 * 只删「整行较短且命中词表」的行，宁可漏删也不误伤正文。
 */
function isNoiseLine(line) {
  var t = Url.trim(line);
  if (!t || t.length > Config.NOISE_MAX_CHARS) {
    return false;
  }
  for (var i = 0; i < Config.NOISE_WORDS.length; i += 1) {
    if (t.indexOf(Config.NOISE_WORDS[i]) >= 0) {
      return true;
    }
  }
  return false;
}

/**
 * 清洗 raw HTML 残留：解析器遇到畸形标签时可能把 HTML 属性/标签当文本输出。
 * 只删真正的 HTML 标签（<后跟字母或/），保留文本中的合法 < >（实体解码产物）。
 */
function stripHtmlFragments(s) {
  if (!s) {
    return s;
  }
  var out = '';
  var i = 0;
  while (i < s.length) {
    var lt = s.indexOf('<', i);
    if (lt < 0) {
      out += s.substring(i);
      break;
    }
    /* 检查 < 后面是否跟字母（HTML 标签）或 /（闭合标签） */
    var next = lt + 1 < s.length ? s.charAt(lt + 1) : '';
    var isHtmlTag = (next >= 'a' && next <= 'z') || (next >= 'A' && next <= 'Z') || next === '/';
    if (!isHtmlTag) {
      /* < 后跟空格/数字/符号 = 文本内容，保留 < 及之前的文本 */
      out += s.substring(i, lt + 1);
      i = lt + 1;
      continue;
    }
    /* 找到 > 作为标签终点；找不到就丢弃到末尾 */
    var gt = s.indexOf('>', lt + 1);
    if (gt < 0) {
      out += s.substring(i, lt);
      break;
    }
    out += s.substring(i, lt);
    i = gt + 1;
  }
  return cleanAttrFragments(out);
}

/** 清理 attr="value" 残片（标签被截断后可能残留） */
function cleanAttrFragments(s) {
  if (!s || s.indexOf('="') < 0) {
    return s;
  }
  var out = '';
  var i = 0;
  while (i < s.length) {
    var eq = s.indexOf('="', i);
    if (eq < 0) {
      out += s.substring(i);
      break;
    }
    /* 向前找到属性名起点（空格/引号/行首） */
    var nameStart = eq;
    while (nameStart > i) {
      var c = s.charAt(nameStart - 1);
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '"' || c === '\'' || c === '<') {
        break;
      }
      nameStart -= 1;
    }
    /* 向后找到结束引号 */
    var q = s.charAt(eq + 2);
    var endQ = s.indexOf(q, eq + 3);
    if (endQ < 0) {
      out += s.substring(i, eq);
      i = eq + 2;
      continue;
    }
    out += s.substring(i, nameStart);
    i = endQ + 1;
  }
  return out;
}

function stripNoise(input) {
  var s = input || '';
  if (s.indexOf('\n') < 0) {
    return isNoiseLine(s) ? '' : s;
  }
  var parts = [];
  var start = 0;
  while (start <= s.length) {
    var nl = s.indexOf('\n', start);
    var end = nl < 0 ? s.length : nl;
    var line = s.substring(start, end);
    if (!isNoiseLine(line)) {
      /* v3.10：数组收集 + 一次 join——旧实现逐行 out += line 在数千行时是
         O(行数×文本长度) 的整串复制（兆字节级垃圾）。首行空行语义与旧版一致。 */
      if (line.length > 0 || parts.length > 0) {
        parts.push(line);
      }
    }
    if (nl < 0) {
      break;
    }
    start = nl + 1;
  }
  return parts.join('\n');
}

function detectKind(raw) {
  var s = Url.trim(raw);
  if (!s) {
    return 'empty';
  }
  var c = s.charAt(0);
  if (c === '<') {
    return 'html';
  }
  if (c === '{' || c === '[') {
    return 'unsupported';
  }
  var limit = s.length < 1000 ? s.length : 1000;
  for (var i = 0; i < limit; i += 1) {
    if (s.charCodeAt(i) === 0) {
      return 'unsupported';
    }
  }
  return 'text';
}

/**
 * 检测 PUA（私用区）加密文本。番茄小说等站用 PUA 码位（U+E000~U+F8FF）
 * 替换真实字符做反爬，raw HTML 里的正文是密文，JS 侧无法在表端解密。
 * 返回 true 表示正文可能被字体加密，用户需换站点或用 App。
 */
function isPuaEncrypted(raw) {
  if (!raw) {
    return false;
  }
  var puaCount = 0;
  var checkLen = raw.length < 3000 ? raw.length : 3000;
  for (var i = 0; i < checkLen; i += 1) {
    var code = raw.charCodeAt(i);
    if (code >= 0xE000 && code <= 0xF8FF) {
      puaCount += 1;
    }
  }
  return puaCount > 10;
}

function collapsePlain(input) {
  var out = '';
  var space = false;
  var line = false;
  var started = false;
  for (var i = 0; i < input.length; i += 1) {
    var code = input.charCodeAt(i);
    if (code === 10 || code === 13) {
      line = true;
      space = true;
    } else if (code === 32 || code === 9 || code === 160 || code === 12288) {
      if (!line) {
        space = true;
      }
    } else {
      if (line) {
        if (started) {
          out += '\n';
        }
        line = false;
        space = false;
      } else if (space) {
        if (started) {
          out += ' ';
        }
        space = false;
      }
      out += input.charAt(i);
      started = true;
    }
  }
  return out;
}

function parse(rawHtml, pageUrl, options) {
  var raw = rawHtml === null || rawHtml === undefined ? '' : String(rawHtml);
  var opts = options || {};
  var sink = opts.sink || null;
  var kind = detectKind(raw);
  var truncated = raw.length > Config.MAX_HTML_CHARS;
  var src = truncated ? raw.substring(0, Config.MAX_HTML_CHARS) : raw;

  if (kind !== 'html') {
    var plain = kind === 'text' ? collapsePlain(src) : '';
    if (plain.length > Config.MAX_TEXT_CHARS) {
      plain = plain.substring(0, Config.MAX_TEXT_CHARS);
      truncated = true;
    }
    var t = Url.hostOf(pageUrl) || Url.displayOf(pageUrl);
    return { title: truncate(t, Config.MAX_TITLE_CHARS), text: plain, links: [], nextHref: '', prevHref: '', startHref: '', chapters: [], truncated: truncated, kind: kind };
  }

  var chunks = [];
  var cur = '';
  var space = false;
  var line = false;
  var started = false;
  var textLen = 0;

  /* v3.9 性能（加载卡死真因）：旧实现逐字符 `cur += ch`——JerryScript 每次
     += 都整串复制，64K 源约 6MB 复制 + 数万次小串分配，主线程冻结数秒（加载
     动画/进度条"卡住"的真因），分配洪峰还把堆挤到崩溃边缘。
     新实现按**整段**追加（每段一次 substring + 一次拼接）、扫描用 charCodeAt
     零分配，同等内容分配量降约 50 倍。 */
  function emitRun(run) {
    if (!run || run.length < 1) {
      return;
    }
    if (textLen >= Config.MAX_TEXT_CHARS) {
      truncated = true;
      return;
    }
    var part = run;
    /* v1.1.1：片段级清洗（在分页前做，保证 pagesink 的页偏移仍然正确）。
       只对疑似 HTML 残片的 run 执行，避免影响普通正文性能。 */
    if (part.indexOf('<') >= 0 || part.indexOf('="') >= 0) {
      part = stripHtmlFragments(part);
      if (!part) {
        return;
      }
    }
    var remain = Config.MAX_TEXT_CHARS - textLen;
    if (part.length > remain) {
      part = part.substring(0, remain);
      truncated = true;
    }
    if (line) {
      if (started) {
        if (sink) {
          sink.write('\n');
        } else {
          cur += '\n';
        }
      }
      line = false;
      space = false;
    } else if (space) {
      if (started) {
        if (sink) {
          sink.write(' ');
        } else {
          cur += ' ';
        }
      }
      space = false;
    }
    if (sink) {
      sink.write(part);
    } else {
      cur += part;
    }
    textLen += part.length;
    started = true;
    if (!sink) {
      while (cur.length >= 1024) {
        chunks.push(cur.substring(0, 1024));
        cur = cur.substring(1024);
      }
    }
  }

  function flush() {
    if (sink) {
      return;
    }
    if (cur.length > 0) {
      chunks.push(cur);
      cur = '';
    }
  }

  var title = '';
  var titleBuf = '';
  var inTitle = false;
  var h1 = '';
  var h1Buf = '';
  var inH1 = false;
  var skip = '';
  var links = [];
  var seen = {};
  var anchor = null;
  var nextHref = '';
  var prevHref = '';
  var startHref = '';
  var chapters = [];

  /* 判定翻页控件：锚文本很短且命中关键词表。纯 indexOf 实现，避免正则字面量。 */
  function navKind(text) {
    var raw = text ? String(text) : '';
    var compact = '';
    for (var i = 0; i < raw.length && compact.length <= 16; i += 1) {
      var c = raw.charAt(i);
      if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') {
        compact += c;
      }
    }
    if (!compact || compact.length > 12) {
      return '';
    }
    var lower = compact.toLowerCase();
    var k;
    for (k = 0; k < Config.NEXT_WORDS.length; k += 1) {
      if (lower.indexOf(Config.NEXT_WORDS[k]) >= 0) {
        return 'next';
      }
    }
    for (k = 0; k < Config.PREV_WORDS.length; k += 1) {
      if (lower.indexOf(Config.PREV_WORDS[k]) >= 0) {
        return 'prev';
      }
    }
    return '';
  }

  function closeAnchor() {
    if (!anchor) {
      return;
    }
    var href = anchor.href;
    var text = anchor.text;
    var hint = anchor.hint;
    anchor = null;
    if (!href) {
      return;
    }
    var kind = navKind(text);
    if (!kind && hint) {
      kind = navKind(hint);
    }
    if (kind === 'next' && !nextHref) {
      nextHref = href;
    } else if (kind === 'prev' && !prevHref) {
      prevHref = href;
    }
    /* 电子书站：「开始阅读」直达正文；「第x章」类收进目录（书名页专用控件） */
    if (!startHref && Navrule.isStartText(text)) {
      startHref = href;
    }
    if (chapters.length < 40 && Navrule.isChapterText(text)) {
      chapters.push({ text: truncate(text, Config.MAX_LINK_TEXT_CHARS), href: truncate(href, Config.MAX_LINK_HREF_CHARS) });
    }
    if (Object.prototype.hasOwnProperty.call(seen, href) || links.length >= Config.MAX_LINKS) {
      return;
    }
    seen[href] = 1;
    links.push({ text: truncate(text, Config.MAX_LINK_TEXT_CHARS), href: truncate(href, Config.MAX_LINK_HREF_CHARS) });
  }

  function piece(p) {
    if (p === ' ') {
      if (started) {
        space = true;
      }
      return;
    }
    emitRun(p);
    if (inH1 && h1Buf.length < 120) {
      h1Buf += p.substring(0, 120 - h1Buf.length);
    }
    if (anchor && anchor.text.length < 200) {
      anchor.text += p.substring(0, 200 - anchor.text.length);
    }
  }

  /* 段扫描：普通文本按整段收集（runStart..k），遇空白/实体才 flush——
     语义与逐字符版一致（分隔符惰性前缀、实体解码、标题/跳过分支）。 */
  function emitText(s, from, to) {
    var k = from;
    var runStart = -1;
    function flushRun(end) {
      if (runStart >= 0 && end > runStart) {
        piece(s.substring(runStart, end));
      }
      runStart = -1;
    }
    while (k < to) {
      if (inTitle) {
        flushRun(k);
        if (titleBuf.length < 256) {
          titleBuf += s.charAt(k);
        }
        k += 1;
        continue;
      }
      if (skip) {
        flushRun(k);
        k += 1;
        continue;
      }
      var code = s.charCodeAt(k);
      if (code === 10 || code === 32 || code === 9 || code === 13 || code === 160 || code === 12288 || code === 38) {
        flushRun(k);
        if (code === 38) {
          var semi = s.indexOf(';', k + 1);
          if (semi > k && semi - k <= 12 && semi < to) {
            var d = decodeOne(s.substring(k + 1, semi));
            if (d !== null) {
              if (d) {
                piece(d);
              }
              k = semi + 1;
              continue;
            }
          }
          piece('&');
          k += 1;
          continue;
        }
        if (code === 10) {
          line = true;
          space = true;
        } else if (!line) {
          space = true;
        }
        k += 1;
        continue;
      }
      if (runStart < 0) {
        runStart = k;
      }
      k += 1;
    }
    flushRun(to);
  }


  var i = 0;
  while (i < src.length) {
    var lt = src.indexOf('<', i);
    if (lt < 0) {
      /* v1.1.1：skip（script/style）内的文本绝不能当正文输出 */
      if (!skip) {
        emitText(src, i, src.length);
      }
      break;
    }
    if (lt > i) {
      /* v1.1.1：同上，skip 内不 emit，避免脚本字符串里的 HTML 片段泄漏成正文 */
      if (!skip) {
        emitText(src, i, lt);
      }
    }
    if (src.substring(lt, lt + 4) === '<!--') {
      var ce = src.indexOf('-->', lt + 4);
      i = ce < 0 ? src.length : ce + 3;
      continue;
    }
    if (src.charAt(lt + 1) === '!' || src.charAt(lt + 1) === '?') {
      var de = src.indexOf('>', lt + 2);
      i = de < 0 ? src.length : de + 1;
      continue;
    }
    var j = lt + 1;
    var closing = false;
    if (src.charAt(j) === '/') {
      closing = true;
      j += 1;
    }
    var ns = j;
    while (j < src.length && isName(src.charAt(j))) {
      j += 1;
    }
    var tag = src.substring(ns, j).toLowerCase();
    var gt = tagEnd(src, j);
    if (gt < 0) {
      emitText(src, lt, src.length);
      break;
    }
    var body = src.substring(j, gt);
    i = gt + 1;
    if (!tag) {
      continue;
    }
    if (skip) {
      if (closing && tag === skip) {
        skip = '';
        line = true;
      }
      continue;
    }
    if (closing) {
      if (tag === 'title') {
        inTitle = false;
        title = decode(titleBuf).trim();
      } else if (tag === 'a') {
        closeAnchor();
      } else if (tag === 'h1') {
        inH1 = false;
        if (!h1) {
          h1 = decode(h1Buf).trim();
        }
      } else if (BLOCK[tag]) {
        line = true;
      }
      continue;
    }
    if (tag === 'title') {
      inTitle = true;
      titleBuf = '';
    } else if (tag === 'h1') {
      inH1 = true;
      h1Buf = '';
      line = true;
    } else if (tag === 'a') {
      /* 很多站点把翻页语义放在 title / aria-label 上，锚文本只有一个 › 符号 */
      anchor = {
        href: Url.resolve(pageUrl, hrefOf(body)),
        text: '',
        hint: attrOf(body, 'title') || attrOf(body, 'aria-label')
      };
    } else if (SKIP[tag]) {
      var selfClosed = body.length > 0 && body.charAt(body.length - 1) === '/';
      if (!selfClosed) {
        var closePos = findClose(src, i, tag);
        line = true;
        if (closePos < 0) {
          i = src.length;
        } else {
          i = closePos;
        }
      }
    } else if (BLOCK[tag]) {
      line = true;
    }
  }

  if (anchor) {
    closeAnchor();
  }
  flush();

  var text = '';
  var starts = null;
  var pages = null;
  var pageCount = 0;
  if (sink) {
    /* P2：解析边喂 sink，sink 已完成噪声过滤/截断/分页；不再 chunks→join→stripNoise */
    var result = sink.finish();
    text = result.text || '';
    starts = result.starts;
    pages = result.pages;
    pageCount = result.pageCount;
    if (result.truncated) {
      truncated = true;
    }
  } else {
    text = chunks.join('');
    if (text.charAt(text.length - 1) === '\n') {
      text = text.substring(0, text.length - 1);
    }
    text = stripNoise(text);
    text = stripHtmlFragments(text);
    if (text.length > Config.MAX_TEXT_CHARS) {
      text = text.substring(0, Config.MAX_TEXT_CHARS);
      truncated = true;
    }
  }

  var finalTitle = title || h1 || Url.hostOf(pageUrl) || Url.displayOf(pageUrl);
  return {
    title: truncate(decode(finalTitle), Config.MAX_TITLE_CHARS),
    text: text,
    starts: starts,
    pages: pages,
    pageCount: pageCount,
    links: links,
    nextHref: nextHref ? truncate(nextHref, Config.MAX_LINK_HREF_CHARS) : '',
    prevHref: prevHref ? truncate(prevHref, Config.MAX_LINK_HREF_CHARS) : '',
    startHref: startHref ? truncate(startHref, Config.MAX_LINK_HREF_CHARS) : '',
    chapters: chapters,
    truncated: truncated,
    puaEncrypted: isPuaEncrypted(raw),
    kind: 'html'
  };
}

export default {
  parse: parse,
  isPuaEncrypted: isPuaEncrypted
};
