/**
 * 必应中国 RSS 网页搜索解析（纯函数模块，无 @system 依赖，tools/smoke.js 可覆盖）。
 *
 * 引擎选型（2026-11 本机抓包实测，同一关键词）：
 *   cn.bing.com RSS    约 6~7 KB   10 条结果、链接为直连 URL   ← 采用
 *   m.sogou.com        约 240 KB   结果区偏移在 17KB~136KB 间波动
 *   m.baidu.com        约 1.9 MB   结果区在 1.28 MB 处
 *   so.toutiao.com     约 1.8 MB
 *   m.so.com           约 340 KB   结果区在 230 KB 处
 *
 * RSS 结构：<channel> 下 N 个 <item><title/><link/><description/><pubDate/></item>。
 * 摘要纯文本、链接直连无需跳转解析。无正则字面量（ArkUI.Lite 加载期拒绝）。
 */
import SearchCfg from './searchcfg.js';
import Url from './url.js';

var ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', middot: '·', copy: '©', reg: '®', times: '×'
};

/** 已知实体返回替换串，未知返回 null（原文保留）。 */
function decodeEntity(name) {
  if (!name) {
    return null;
  }
  if (name.charAt(0) === '#') {
    var code = name.charAt(1) === 'x' || name.charAt(1) === 'X'
      ? parseInt(name.substring(2), 16)
      : parseInt(name.substring(1), 10);
    if (isNaN(code) || code <= 0 || code > 0x10ffff) {
      return null;
    }
    return String.fromCharCode(code);
  }
  return Object.prototype.hasOwnProperty.call(ENT, name) ? ENT[name] : null;
}

/** 压缩空白：连续空白合成一个空格（不能用正则字面量）。 */
function squeeze(s) {
  var out = '';
  var space = false;
  for (var i = 0; i < s.length; i += 1) {
    var code = s.charCodeAt(i);
    var isSpace = code === 32 || code === 9 || code === 10 || code === 13 || code === 160 || code === 12288;
    if (isSpace) {
      space = true;
      continue;
    }
    if (space && out.length > 0) {
      out += ' ';
    }
    space = false;
    out += s.charAt(i);
  }
  return out;
}

/** 取一段 XML/HTML 的纯文本：去标签 + 解码实体 + 压空白。 */
function textOf(s, from, to) {
  var out = '';
  var i = from;
  while (i < to) {
    var c = s.charAt(i);
    if (c === '<') {
      var gt = s.indexOf('>', i + 1);
      if (gt < 0 || gt >= to) {
        break;
      }
      i = gt + 1;
      continue;
    }
    if (c === '&') {
      var semi = s.indexOf(';', i + 1);
      if (semi > i && semi - i <= 12 && semi < to) {
        var d = decodeEntity(s.substring(i + 1, semi));
        if (d !== null) {
          out += d;
          i = semi + 1;
          continue;
        }
      }
      out += '&';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return squeeze(out);
}

function truncate(s, max) {
  return s && s.length > max ? s.substring(0, max) : (s || '');
}

/** 查询词百分号编码（内建不可用时手写 UTF-8 编码兜底）。 */
function percentEncode(s) {
  var src = s === null || s === undefined ? '' : String(s);
  if (typeof encodeURIComponent === 'function') {
    try {
      return encodeURIComponent(src);
    } catch (err) {
      /* 落到手写实现 */
    }
  }
  var safe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~';
  var out = '';
  for (var i = 0; i < src.length; i += 1) {
    var code = src.charCodeAt(i);
    var bytes;
    if (code < 0x80) {
      bytes = [code];
    } else if (code < 0x800) {
      bytes = [0xc0 | (code >> 6), 0x80 | (code & 0x3f)];
    } else {
      bytes = [0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)];
    }
    for (var k = 0; k < bytes.length; k += 1) {
      var ch = String.fromCharCode(bytes[k]);
      out += safe.indexOf(ch) >= 0 ? ch : '%' + (bytes[k] < 16 ? '0' : '') + bytes[k].toString(16);
    }
  }
  return out;
}

/** 构造搜索请求地址。 */
function buildUrl(query) {
  var q = Url.trim(String(query === null || query === undefined ? '' : query));
  if (!q) {
    return '';
  }
  return SearchCfg.URL_BASE + percentEncode(q);
}

/** 取 <tag> 与 </tag> 之间的纯文本（支持 <tag attr> 写法）。 */
function tagText(block, tag) {
  var needle = '<' + tag;
  var i = block.indexOf(needle);
  while (i >= 0) {
    var after = block.charAt(i + needle.length);
    if (after === '>' || after === ' ' || after === '/') {
      var gt = block.indexOf('>', i + needle.length);
      if (gt < 0) {
        return '';
      }
      var end = block.indexOf('</' + tag + '>', gt);
      if (end < 0) {
        return '';
      }
      return textOf(block, gt + 1, end);
    }
    i = block.indexOf(needle, i + needle.length);
  }
  return '';
}

/**
 * 解析 RSS 搜索响应。
 * @returns {{kind:'ok'|'empty'|'error',items:Array}}
 *   items[i] = {title, summary, url, host}
 */
function parse(rawXml) {
  var raw = rawXml === null || rawXml === undefined ? '' : String(rawXml);

  /* 非 XML（错误页/被拦截页）单独归类，页面给「解析失败」而不是「无结果」 */
  if (raw.indexOf('<rss') < 0 && raw.indexOf('<feed') < 0) {
    return { kind: 'error', items: [] };
  }

  var items = [];
  var pos = 0;
  while (items.length < SearchCfg.MAX_RESULTS) {
    var open = raw.indexOf('<item>', pos);
    if (open < 0) {
      break;
    }
    var close = raw.indexOf('</item>', open);
    if (close < 0) {
      break;
    }
    pos = close + 7;

    var block = raw.substring(open + 6, close);
    var title = tagText(block, 'title');
    var link = tagText(block, 'link');
    var summary = tagText(block, 'description');
    if (!title || !link) {
      continue;
    }

    items.push({
      title: truncate(title, SearchCfg.TITLE_CHARS),
      /* 副标题 = 摘要截断（结果控件用）；summary 保留完整摘要（详情页用） */
      sub: truncate(summary, SearchCfg.SUBTITLE_CHARS),
      summary: truncate(summary, SearchCfg.SUMMARY_FULL_CHARS),
      url: link,
      host: Url.hostOf(link) || Url.displayOf(link)
    });
  }

  return { kind: items.length > 0 ? 'ok' : 'empty', items: items };
}

export default {
  buildUrl: buildUrl,
  parse: parse,
  percentEncode: percentEncode,
  textOf: textOf
};
