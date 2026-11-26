/**
 * 小说站导航规则（纯函数，html.js / links.js / reader.js 共用）。
 *
 * 电子书站的典型结构：书名页（简介 + 「开始阅读」+ 目录）→ 章节页。
 * 手表要能直接进入阅读，需要识别三类链接文本：
 *   1. 「开始阅读」类 → 直达第一章；
 *   2. 「第一章 / 第12章 xxx」类 → 目录章节；
 *   3. 「上一章 / 下一章」类 → 章节翻页（见 config.js 的 NEXT/PREV_WORDS）。
 * 无正则字面量（ArkUI.Lite 加载期拒绝），全部 indexOf/charAt。
 *
 * v3.3 章节识别修复（真机反馈「目录功能无法识别章节链接」）：
 * 旧判定 len≤20 且必须「第」开头——小说站长章节标题（>20 字）与
 * 「12. / 012、」纯数字编号目录条目全部漏判。新判定三类前缀：
 *   a. 「第x章/节/回/话/卷」（x = 阿拉伯/汉字数字，副标题不限长，整条 ≤60 字）；
 *   b. 纯数字编号（1~5 位）+ 量词或点号（"12.风起"、"012、龙王"、"3章"）；
 *   c. 卷首/卷尾语（楔子/序章/前言/引子/后记/番外/尾声/终章/大结局，整条 ≤40 字）。
 * 允许前导装饰括号（【第十二章】等）。上一章/下一章不会误判。
 *
 * v3.3 离线标题识别（offlineTitle）：从网页标题/正文首行识别「书名 + 第n章」，
 * 供保存离线时把列表标题显示为「书名 第n章」；识别不出返回空串由调用方回退
 * 原网页标题。书名取自《书名》括号、章节标记前缀段或分隔段（排除站点名）。
 */

var START_WORDS = '开始阅读|立即阅读|阅读本书|进入阅读|点此阅读|开始阅读本书|正文阅读|点击阅读|马上阅读'.split('|');

/* 章节量词字 */
var MARKERS = '章节回话卷';
/* 汉字数字（章节号用） */
var CN_NUMS = '零〇一二两三四五六七八九十百千万';
/* 卷首/卷尾语类目录条目 */
var SECTION_WORDS = '楔子|序章|前言|引子|后记|番外|尾声|终章|大结局'.split('|');
/* 前导装饰符（【第十二章】等） */
var DECOR = '【】〔〕「」『』()（）<>《》“”"\'·';
/* 书名分隔符（标题里 章节段-书名段-站点段 的分隔） */
var SEG_SPLIT = '-_－—|｜';
/* 站点名特征词（书名候选段排除用） */
var SITE_WORDS = '小说网|书屋|阅读|笔趣阁|顶点|起点|纵横|晋江|全本|完本|txt|官网|手机版|无弹窗|更新|最新|章节|目录|在线|网'.split('|');
/* 书名候选段尾部噪声（"龙族最新章节" → "龙族"） */
var TRIM_SUFFIX = '最新章节列表|最新章节|章节目录|全文阅读|全本|全集|完本'.split('|');

function trimEdges(value) {
  var s = String(value === null || value === undefined ? '' : value);
  var start = 0;
  var end = s.length;
  while (start < end) {
    var c = s.charCodeAt(start);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12 && c !== 12288) {
      break;
    }
    start += 1;
  }
  while (end > start) {
    var c2 = s.charCodeAt(end - 1);
    if (c2 !== 32 && c2 !== 9 && c2 !== 10 && c2 !== 13 && c2 !== 12 && c2 !== 12288) {
      break;
    }
    end -= 1;
  }
  return s.substring(start, end);
}

/** 跳过前导装饰括号/引号/间隔点。 */
function skipDecor(s, i) {
  var p = i;
  while (p < s.length && DECOR.indexOf(s.charAt(p)) >= 0) {
    p += 1;
  }
  return p;
}

function isDigit(c) {
  return c >= '0' && c <= '9';
}

function compact(s) {
  var out = '';
  for (var i = 0; i < s.length; i += 1) {
    var c = s.charAt(i);
    if (c !== ' ' && c !== '\u3000') {
      out += c;
    }
  }
  return out;
}

/**
 * 章节标记定位：返回 {start, end, label}（label 已去内部空格）或 null。
 * a. 「第x章/节/回/话/卷」x = 数字/汉字数字（可含空格，号段 ≤12 字符）；
 * b. 纯数字编号（1~5 位）+ 量词（保留量词字）或点号（. ． 、，补「章」），
 *    点号后必须紧跟非数字（防 "3.14" 误判）。
 */
function findChapterToken(value) {
  var s = String(value === null || value === undefined ? '' : value);
  /* 形态 a：第 + 号段 + 量词（号段内允许空格，如「第 12 章」） */
  var p = s.indexOf('第');
  while (p >= 0) {
    var j = p + 1;
    var count = 0;
    while (j < s.length && j - p <= 13) {
      var c = s.charAt(j);
      if (isDigit(c) || CN_NUMS.indexOf(c) >= 0) {
        count += 1;
        j += 1;
      } else if (c === ' ' || c.charCodeAt(0) === 12288) {
        j += 1;
      } else {
        break;
      }
    }
    if (count > 0 && j < s.length && MARKERS.indexOf(s.charAt(j)) >= 0) {
      var label = compact(s.substring(p, j + 1));
      if (label.length >= 3 && label.length <= 14) {
        return { start: p, end: j + 1, label: label };
      }
    }
    p = s.indexOf('第', p + 1);
  }
  /* 形态 b：纯数字编号 + 量词/点号 */
  var k = 0;
  while (k < s.length) {
    if (!isDigit(s.charAt(k))) {
      k += 1;
      continue;
    }
    var nstart = k;
    while (k < s.length && isDigit(s.charAt(k)) && k - nstart < 5) {
      k += 1;
    }
    if (k >= s.length) {
      break;
    }
    var m = s.charAt(k);
    var mk = MARKERS.indexOf(m) >= 0;
    var dot = m === '.' || m === '\uff0e' || m === '\u3001';
    if (!mk && !dot) {
      k = nstart + 1;
      continue;
    }
    if (dot) {
      var after = k + 1;
      while (after < s.length && (s.charAt(after) === ' ' || s.charCodeAt(after) === 12288)) {
        after += 1;
      }
      if (after >= s.length || isDigit(s.charAt(after))) {
        k = nstart + 1;
        continue;
      }
    }
    var num = parseInt(s.substring(nstart, k), 10);
    if (isNaN(num) || num < 0) {
      k = nstart + 1;
      continue;
    }
    return {
      start: nstart,
      end: mk ? k + 1 : k,
      label: '第' + String(num) + (mk ? m : '章')
    };
  }
  return null;
}

/** 「第x章/节/回/话/卷」类章节标题（长副标题不限制，整条 ≤60 字；见文件头）。 */
function isChapterText(text) {
  var s = trimEdges(text);
  if (s.length < 2 || s.length > 60) {
    return false;
  }
  var p = skipDecor(s, 0);
  var rest = s.substring(p);
  if (rest.length < 2) {
    return false;
  }
  var t = findChapterToken(rest);
  if (t && t.start === 0) {
    return true;
  }
  for (var i = 0; i < SECTION_WORDS.length; i += 1) {
    if (rest.indexOf(SECTION_WORDS[i]) === 0 && rest.length <= 40) {
      return true;
    }
  }
  return false;
}

/** 「开始阅读」类文本判定。 */
function isStartText(text) {
  var s = String(text === null || text === undefined ? '' : text);
  var compacted = '';
  for (var i = 0; i < s.length && compacted.length <= 16; i += 1) {
    var c = s.charAt(i);
    if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') {
      compacted += c;
    }
  }
  if (!compacted || compacted.length > 12) {
    return false;
  }
  for (var k = 0; k < START_WORDS.length; k += 1) {
    if (compacted.indexOf(START_WORDS[k]) >= 0) {
      return true;
    }
  }
  return false;
}

/* ---------------- 离线标题识别：书名 + 第n章 ---------------- */

/** 正文首行（章标题常在首行），上限 40 字符。 */
function headLine(body) {
  var s = String(body === null || body === undefined ? '' : body);
  var nl = s.indexOf('\n');
  var line = nl >= 0 ? s.substring(0, nl) : s;
  return line.length > 40 ? line.substring(0, 40) : line;
}

/** 去首尾空白 + 装饰符 + 分隔符。 */
function trimDecorSep(value) {
  var s = trimEdges(value);
  var start = skipDecor(s, 0);
  var end = s.length;
  while (end > start) {
    var c = s.charAt(end - 1);
    if (DECOR.indexOf(c) >= 0 || SEG_SPLIT.indexOf(c) >= 0 || c === ' ' || c.charCodeAt(0) === 12288) {
      end -= 1;
    } else {
      break;
    }
  }
  while (start < end) {
    var c2 = s.charAt(start);
    if (DECOR.indexOf(c2) >= 0 || SEG_SPLIT.indexOf(c2) >= 0 || c2 === ' ' || c2.charCodeAt(0) === 12288) {
      start += 1;
    } else {
      break;
    }
  }
  return s.substring(start, end);
}

function splitSegs(s) {
  var out = [];
  var start = 0;
  for (var i = 0; i < s.length; i += 1) {
    if (SEG_SPLIT.indexOf(s.charAt(i)) >= 0) {
      out.push(s.substring(start, i));
      start = i + 1;
    }
  }
  out.push(s.substring(start));
  return out;
}

function hasSiteWord(v) {
  var lower = v.toLowerCase();
  for (var i = 0; i < SITE_WORDS.length; i += 1) {
    if (lower.indexOf(SITE_WORDS[i].toLowerCase()) >= 0) {
      return true;
    }
  }
  return false;
}

/** 书名候选：《书名》→ 章节标记前缀段 → 分隔段（排除章节段与站点名段）。 */
function bookOf(s, t) {
  var b1 = s.indexOf('\u300a');
  var b2 = s.indexOf('\u300b', b1 + 1);
  if (b1 >= 0 && b2 > b1 + 1 && b2 - b1 - 1 <= 24) {
    var inner = trimEdges(s.substring(b1 + 1, b2));
    if (inner.length >= 1 && inner.length <= 24) {
      return inner;
    }
  }
  if (t && t.start > 0) {
    var before = trimDecorSep(s.substring(0, t.start));
    if (before.length >= 2 && before.length <= 20 && !hasSiteWord(before)) {
      return before;
    }
  }
  var segs = splitSegs(s);
  for (var i = 0; i < segs.length; i += 1) {
    if (findChapterToken(segs[i])) {
      continue;
    }
    var v = trimDecorSep(segs[i]);
    for (var k = 0; k < TRIM_SUFFIX.length; k += 1) {
      var suf = TRIM_SUFFIX[k];
      if (v.length > suf.length && v.indexOf(suf) === v.length - suf.length) {
        v = trimDecorSep(v.substring(0, v.length - suf.length));
      }
    }
    if (v.length < 2 || v.length > 20) {
      continue;
    }
    if (hasSiteWord(v)) {
      continue;
    }
    return v;
  }
  return '';
}

/**
 * 保存离线时的标题识别：「书名 第n章」（章号保留站点原形态，如 第十二章/第12章）。
 * 书名或章号任一识别不出 → 返回空串，调用方回退原网页标题。
 */
function offlineTitle(title, body) {
  var s = trimEdges(title);
  var chapter = '';
  var book = '';
  var t = findChapterToken(s);
  if (t) {
    chapter = t.label;
    book = bookOf(s, t);
  } else {
    var th = findChapterToken(headLine(body));
    if (th) {
      chapter = th.label;
      book = bookOf(s, null);
    }
  }
  if (!chapter || !book) {
    return '';
  }
  return book + ' ' + chapter;
}

/* 站点「返回目录/目录」类导航文本（v3.10）：链接表里这类条目只通向整本
   目录页（数百 KB 巨型页面，整包序列化必崩）——合并目录列表时直接剔除。 */
function isTocNavText(text) {
  var s = text ? String(text) : '';
  if (!s || s.length > 12) {
    return false;
  }
  var compact = '';
  for (var i = 0; i < s.length; i += 1) {
    var c = s.charAt(i);
    if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') {
      compact += c;
    }
  }
  if (compact.indexOf('目录') >= 0) {
    return true;
  }
  var words = ['全部章节', '章节列表', '返回书页', '目录页'];
  for (var k = 0; k < words.length; k += 1) {
    if (compact.indexOf(words[k]) >= 0) {
      return true;
    }
  }
  return false;
}

export default {
  isChapterText: isChapterText,
  isStartText: isStartText,
  isTocNavText: isTocNavText,
  findChapterToken: findChapterToken,
  offlineTitle: offlineTitle
};
