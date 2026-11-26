/**
 * 流式分页 sink（P2 核心，纯函数模块，无 @system.* 依赖）。
 *
 * 目标：把"解析 → 全文 chunks → join → stripNoise → paginate 再扫一遍"
 * 压缩成"解析边喂 → 边分行/边分页"，正文级副本从 3~4 份降到 1 份。
 *
 * 输入：html.js 的 emitRun 片段（已做空白/换行归一化；含 '\n' 表示换行）。
 * 输出：
 *   { starts:number[], pages:[{cs,ce,text?}], pageCount, text, truncated }
 *   - keepText=true：text 是过滤噪声后的全文（供内存模式 pageText 切片）
 *   - keepText=false：pages[i].text 是当前页字符串（供落盘/直接渲染）
 *
 * 字节口径：cs/ce 是 UTF-16 码元偏移；落盘时由调用方按页 utf8Len 计算字节偏移。
 * 语法：ES5（var/function），不依赖 Promise/globalThis/正则。
 */
import Config from './config.js';
import Paginate from './paginate.js';
import Url from './url.js';

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
 * @param {object} layout Paginate.normalizeLayout 兼容的布局
 * @param {object} opts {maxText, keepText, keepPages, onPage}
 */
function create(layout, opts) {
  var l = Paginate.normalizeLayout(layout);
  var maxLines = Math.floor(l.height / l.lineHeight);
  if (maxLines < 1) {
    maxLines = 1;
  }
  var usable = l.width - 2;
  if (usable < 20) {
    usable = 20;
  }
  var options = opts || {};
  var maxText = options.maxText ? Math.floor(options.maxText) : Config.MAX_TEXT_CHARS;
  var keepText = options.keepText !== false;
  var keepPages = options.keepPages === true;
  var onPage = typeof options.onPage === 'function' ? options.onPage : null;

  var starts = [];
  var pages = [];
  var pageParts = [];
  var fullParts = keepText ? [] : [];
  var pageStart = 0;
  var pos = 0;
  var line = 0;
  var lineWidth = 0;
  var truncated = false;
  var hasContent = false;

  /* 当前行的噪声缓冲：只缓存 ≤ NOISE_MAX_CHARS 的行；超长行立即放行 */
  var lineBuf = [];
  var lineLen = 0;
  var lineLong = false;

  function pushPageText(text) {
    if (keepText) {
      fullParts.push(text);
    }
    if (keepPages || onPage) {
      pageParts.push(text);
    }
  }

  function closePage() {
    if (pos <= pageStart && pageParts.length < 1 && pages.length > 0) {
      return;
    }
    var text = '';
    if (keepPages || onPage) {
      text = pageParts.join('');
    }
    var page = { cs: pageStart, ce: pos };
    if (keepPages) {
      page.text = text;
    }
    pages.push(page);
    starts.push(pageStart);
    if (onPage) {
      try {
        onPage(page, text);
      } catch (err) {
        /* 落盘回调异常不影响分页 */
      }
    }
    pageParts = [];
    pageStart = pos;
  }

  /** 追加一段不含 '\n' 的文本，按字宽折行/换页。 */
  function appendText(text) {
    if (!text) {
      return;
    }
    hasContent = true;
    var remain = maxText - pos;
    if (remain <= 0) {
      truncated = true;
      return;
    }
    var s = text;
    if (s.length > remain) {
      s = s.substring(0, remain);
      truncated = true;
    }
    var k = 0;
    var segStart = 0;
    while (k < s.length) {
      var code = s.charCodeAt(k);
      var w = Paginate.widthOf(code) * l.fontSize;
      if (lineWidth > 0 && lineWidth + w > usable) {
        if (k > segStart) {
          pushPageText(s.substring(segStart, k));
          pos += k - segStart;
        }
        line += 1;
        lineWidth = 0;
        if (line >= maxLines) {
          closePage();
          line = 0;
        }
        segStart = k;
      }
      lineWidth += w;
      k += 1;
    }
    if (k > segStart) {
      pushPageText(s.substring(segStart, k));
      pos += k - segStart;
    }
  }

  function newline() {
    /* 开头连续空行丢弃（与旧 stripNoise 的“首个非空行之前不保留空行”一致） */
    if (!hasContent && pages.length < 1 && pageStart === pos) {
      return;
    }
    pushPageText('\n');
    pos += 1;
    line += 1;
    lineWidth = 0;
    if (line >= maxLines) {
      closePage();
      line = 0;
    }
  }

  function flushLine() {
    if (lineLen < 1) {
      return;
    }
    var text = lineBuf.join('');
    lineBuf = [];
    lineLen = 0;
    if (!lineLong && isNoiseLine(text)) {
      return;
    }
    appendText(text);
  }

  function addLineText(text) {
    if (!text) {
      return;
    }
    if (lineLong) {
      appendText(text);
      return;
    }
    if (lineLen + text.length <= Config.NOISE_MAX_CHARS) {
      lineBuf.push(text);
      lineLen += text.length;
      return;
    }
    /* 超过 30 字符一定不是噪声行：先 flush 已缓冲部分，再直通 */
    var head = lineBuf.join('');
    lineBuf = [];
    lineLen = 0;
    lineLong = true;
    appendText(head);
    appendText(text);
  }

  function write(run) {
    if (!run) {
      return;
    }
    var s = String(run);
    var start = 0;
    var i = 0;
    while (i < s.length) {
      if (s.charCodeAt(i) === 10) {
        if (i > start) {
          addLineText(s.substring(start, i));
        }
        flushLine();
        newline();
        lineLong = false;
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    if (i > start) {
      addLineText(s.substring(start, i));
    }
  }

  function finish() {
    flushLine();
    if (pos > pageStart || pages.length < 1) {
      closePage();
    }
    var text = keepText ? fullParts.join('') : '';
    return {
      starts: starts,
      pages: pages,
      pageCount: pages.length,
      text: text,
      truncated: truncated
    };
  }

  function textLength() {
    return pos;
  }

  function pageCount() {
    return pages.length;
  }

  return {
    write: write,
    finish: finish,
    textLength: textLength,
    pageCount: pageCount
  };
}

export default {
  create: create,
  isNoiseLine: isNoiseLine
};
