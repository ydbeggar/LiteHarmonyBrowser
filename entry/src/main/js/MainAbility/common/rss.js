/**
 * RSS 2.0 / Atom 解析器（纯函数，无 @system.* 依赖）。
 *
 * 手表端限制：
 * - 不用正则字面量（ArkUI.Lite 加载期拒绝）；
 * - 只用 indexOf / substring / charAt 与索引循环；
 * - 单条正文截断，避免长 feed 把 JS 堆拉满。
 *
 * 返回：
 *   { title, items:[{title,link,summary,content,date,author}], error }
 */
var MAX_ITEMS = 20;
var MAX_TITLE = 80;
var MAX_SUMMARY = 240;
var MAX_CONTENT = 4000;

var ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', middot: '·', copy: '©', reg: '®',
  times: '×', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  harr: '↔', laquo: '«', raquo: '»', bull: '•', deg: '°'
};

var MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function cap(s, max) {
  var v = s === null || s === undefined ? '' : String(s);
  return v.length > max ? v.substring(0, max) : v;
}

function decodeOne(name) {
  var key = String(name || '').toLowerCase();
  if (ENTITIES[key]) {
    return ENTITIES[key];
  }
  if (key.length > 1 && key.charAt(0) === '#') {
    var code = 0;
    var i = 1;
    if (key.charAt(1) === 'x' || key.charAt(1) === 'X') {
      i = 2;
      while (i < key.length) {
        var h = key.charAt(i).toLowerCase();
        var hv = h >= '0' && h <= '9' ? h.charCodeAt(0) - 48 :
          h >= 'a' && h <= 'f' ? h.charCodeAt(0) - 87 : -1;
        if (hv < 0) { break; }
        code = code * 16 + hv;
        i += 1;
      }
    } else {
      while (i < key.length) {
        var d = key.charAt(i);
        if (d < '0' || d > '9') { break; }
        code = code * 10 + (d.charCodeAt(0) - 48);
        i += 1;
      }
    }
    if (code > 0 && code <= 1114111) {
      try {
        return String.fromCharCode(code);
      } catch (err) {
        return '';
      }
    }
  }
  return '&' + name + ';';
}

function decode(input) {
  var s = input === null || input === undefined ? '' : String(input);
  if (s.indexOf('&') < 0) {
    return s;
  }
  var out = '';
  var i = 0;
  while (i < s.length) {
    var amp = s.indexOf('&', i);
    if (amp < 0) {
      out += s.substring(i);
      break;
    }
    out += s.substring(i, amp);
    var semi = s.indexOf(';', amp + 1);
    if (semi < 0) {
      out += s.substring(amp);
      break;
    }
    out += decodeOne(s.substring(amp + 1, semi));
    i = semi + 1;
  }
  return out;
}

function stripTags(input) {
  var s = input === null || input === undefined ? '' : String(input);
  var out = '';
  var i = 0;
  while (i < s.length) {
    var lt = s.indexOf('<', i);
    if (lt < 0) {
      out += s.substring(i);
      break;
    }
    out += s.substring(i, lt);
    var gt = s.indexOf('>', lt + 1);
    if (gt < 0) {
      break;
    }
    var tag = s.substring(lt + 1, gt).toLowerCase();
    if (tag === 'p' || tag === 'br' || tag === 'div' || tag === 'li' ||
        tag === 'tr' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
      out += '\n';
    }
    i = gt + 1;
  }
  return decode(out);
}

function cdata(input) {
  var s = input === null || input === undefined ? '' : String(input).trim();
  var start = '<![CDATA[';
  var end = ']]>';
  if (s.indexOf(start) === 0) {
    var e = s.indexOf(end, start.length);
    if (e >= 0) {
      return s.substring(start.length, e);
    }
  }
  return s;
}

function tagRaw(block, tag) {
  var open = '<' + tag;
  var start = block.indexOf(open);
  if (start < 0) {
    return '';
  }
  var gt = block.indexOf('>', start + open.length);
  if (gt < 0) {
    return '';
  }
  var close = '</' + tag + '>';
  var end = block.indexOf(close, gt + 1);
  if (end < 0) {
    return '';
  }
  return block.substring(gt + 1, end);
}

function tagText(block, tag) {
  /* 先解码 &lt;p&gt; 再剥标签：RSS 的 description 常见两次转义 HTML */
  return stripTags(decode(cdata(tagRaw(block, tag)))).trim();
}

function attrText(block, tag, attr) {
  var raw = tagRaw(block, tag);
  if (raw) {
    return stripTags(cdata(raw));
  }
  /* Atom <link href="..."/> 是自闭合标签，tagRaw 取不到内容 */
  var open = '<' + tag;
  var start = block.indexOf(open);
  if (start < 0) {
    return '';
  }
  var gt = block.indexOf('>', start + open.length);
  if (gt < 0) {
    return '';
  }
  var head = block.substring(start, gt + 1);
  var key = attr + '=';
  var p = head.indexOf(key);
  if (p < 0) {
    return '';
  }
  var q = head.charAt(p + key.length);
  if (q !== '"' && q !== "'") {
    q = '';
  }
  var from = p + key.length + (q ? 1 : 0);
  var to = q ? head.indexOf(q, from) : head.indexOf(' ', from);
  if (to < 0) {
    to = head.length;
  }
  return decode(head.substring(from, to));
}

function formatDate(raw) {
  var s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (!s) {
    return '';
  }
  /* ISO: 2026-11-26T15:00:00... */
  if (s.length >= 10 && s.charAt(4) === '-' && s.charAt(7) === '-') {
    return s.substring(0, 10) + (s.length >= 16 ? ' ' + s.substring(11, 16) : '');
  }
  /* RFC822: Thu, 26 Nov 2026 15:00:00 +0800 */
  var comma = s.indexOf(',');
  var rest = comma >= 0 ? s.substring(comma + 1) : s;
  var parts = rest.trim().split(' ');
  if (parts.length >= 3) {
    var day = parts[0];
    var mon = MONTHS[String(parts[1]).toLowerCase()] || '';
    var year = parts[2];
    var time = parts.length >= 4 ? parts[3] : '';
    if (mon && day && year) {
      return mon + '-' + (day.length < 2 ? '0' + day : day) + ' ' +
        (time.length >= 5 ? time.substring(0, 5) : '');
    }
  }
  return cap(s, 24);
}

function itemFrom(block, atom) {
  var title = tagText(block, 'title');
  var link = atom ? attrText(block, 'link', 'href') : tagText(block, 'link');
  var summaryRaw = tagText(block, atom ? 'summary' : 'description');
  var contentRaw = tagText(block, atom ? 'content' : 'content:encoded');
  if (!contentRaw) {
    contentRaw = summaryRaw;
  }
  var date = formatDate(tagText(block, atom ? 'published' : 'pubDate'));
  if (!date && atom) {
    date = formatDate(tagText(block, 'updated'));
  }
  var author = tagText(block, atom ? 'name' : 'author');
  return {
    title: cap(title || link, MAX_TITLE),
    link: cap(link, 500),
    summary: cap(summaryRaw, MAX_SUMMARY),
    content: cap(contentRaw, MAX_CONTENT),
    date: date,
    author: cap(author, 40)
  };
}

function parse(xml, source) {
  var raw = xml === null || xml === undefined ? '' : String(xml);
  var out = { title: source ? String(source) : '', items: [], error: '' };
  if (!raw) {
    out.error = 'empty';
    return out;
  }
  var channelTitle = tagText(raw, 'title');
  if (channelTitle) {
    out.title = channelTitle;
  }
  var atom = raw.indexOf('<entry') >= 0 && raw.indexOf('<item') < 0;
  var open = atom ? '<entry' : '<item';
  var close = atom ? '</entry>' : '</item>';
  var pos = 0;
  while (out.items.length < MAX_ITEMS) {
    var start = raw.indexOf(open, pos);
    if (start < 0) {
      break;
    }
    var gt = raw.indexOf('>', start + open.length);
    if (gt < 0) {
      break;
    }
    var end = raw.indexOf(close, gt + 1);
    if (end < 0) {
      break;
    }
    var block = raw.substring(gt + 1, end);
    var item = itemFrom(block, atom);
    if (item.title && item.link) {
      out.items.push(item);
    }
    pos = end + close.length;
  }
  if (out.items.length === 0) {
    out.error = 'no-items';
  }
  return out;
}

export default {
  parse: parse,
  decode: decode,
  stripTags: stripTags,
  formatDate: formatDate,
  MAX_ITEMS: MAX_ITEMS
};
