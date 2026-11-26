/**
 * Character-width estimator + offset based pagination.
 *
 * The result NEVER contains page strings: it is an array of character
 * offsets into the single body string. A 50k-character article therefore
 * costs ~6KB instead of duplicating the whole text.
 */
import Config from './config.js';

var NEWLINE_CODE = 10;

function isCjk(code) {
  if (code >= 0x1100 && code <= 0x115f) {
    return true;
  }
  if (code >= 0x2e80 && code <= 0xa4cf) {
    return true;
  }
  if (code >= 0xac00 && code <= 0xd7a3) {
    return true;
  }
  if (code >= 0xf900 && code <= 0xfaff) {
    return true;
  }
  if (code >= 0xfe30 && code <= 0xfe4f) {
    return true;
  }
  if (code >= 0xff00 && code <= 0xff60) {
    return true;
  }
  if (code >= 0xffe0 && code <= 0xffe6) {
    return true;
  }
  return false;
}

/**
 * Relative advance width in em（直接接收字符码，零字符串分配——
 * v3.6：逐字符 charAt 会给 12K 字文本制造 1.2 万次小串churn）。
 * CJK / full width = 1.0, ASCII = 0.55, spaces and punctuation are narrower.
 * Values are deliberately generous so the estimated line never renders
 * wider than the view.
 */
function widthOf(code) {
  if (code === 32) {
    return 0.30;
  }
  if (code === 9) {
    return 1.20;
  }
  if (isCjk(code)) {
    return 1.0;
  }
  if (code < 128) {
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      return 0.55;
    }
    /* . , : ; ! ? ( ) [ ] { } " ' / \ | - */
    if (code === 46 || code === 44 || code === 58 || code === 59 || code === 33 || code === 63 ||
        code === 40 || code === 41 || code === 91 || code === 93 || code === 123 || code === 125 ||
        code === 34 || code === 39 || code === 47 || code === 92 || code === 124 || code === 45) {
      return 0.42;
    }
    return 0.50;
  }
  return 1.0;
}

function normalizeLayout(layout) {
  var source = layout || {};
  var fontLevel = source.fontLevel === undefined ? Config.DEFAULT_FONT_LEVEL : source.fontLevel;
  var lineLevel = source.lineLevel === undefined ? Config.DEFAULT_LINE_LEVEL : source.lineLevel;
  if (fontLevel < 0) {
    fontLevel = 0;
  }
  if (fontLevel > Config.FONT_SIZES.length - 1) {
    fontLevel = Config.FONT_SIZES.length - 1;
  }
  if (lineLevel < 0) {
    lineLevel = 0;
  }
  if (lineLevel > Config.LINE_HEIGHTS.length - 1) {
    lineLevel = Config.LINE_HEIGHTS.length - 1;
  }
  var fontSize = source.fontSize ? source.fontSize : Config.FONT_SIZES[fontLevel];
  var ratio = source.lineHeightRatio ? source.lineHeightRatio : Config.LINE_HEIGHTS[lineLevel];
  return {
    fontSize: fontSize,
    lineHeightRatio: ratio,
    lineHeight: source.lineHeight ? source.lineHeight : fontSize * ratio,
    width: source.width ? source.width : Config.CONTENT_W,
    height: source.height ? source.height : Config.BODY_H,
    fontLevel: fontLevel,
    lineLevel: lineLevel
  };
}

function layoutKey(layout) {
  var l = normalizeLayout(layout);
  return String(l.fontLevel) + ':' + String(l.lineLevel) + ':' + String(l.width);
}

/**
 * @param {string} text body text (single copy, shared with the document)
 * @param {object} layout {fontLevel,lineLevel,width,height} or resolved values
 * @returns {{starts:number[],pageCount:number,layoutKey:string}}
 */
function paginate(text, layout) {
  var s = text === null || text === undefined ? '' : String(text);
  var l = normalizeLayout(layout);
  var maxLines = Math.floor(l.height / l.lineHeight);
  if (maxLines < 1) {
    maxLines = 1;
  }
  var usable = l.width - 2;
  if (usable < 20) {
    usable = 20;
  }

  var starts = [0];
  var pageCount = 1;

  if (s.length > 0) {
    var line = 0;
    var lineWidth = 0;
    var i = 0;
    while (i < s.length) {
      var code = s.charCodeAt(i);
      if (code === NEWLINE_CODE) {
        line += 1;
        lineWidth = 0;
        i += 1;
        if (line >= maxLines && i < s.length) {
          while (i < s.length && s.charCodeAt(i) === NEWLINE_CODE) {
            i += 1;
          }
          if (i < s.length) {
            starts.push(i);
            pageCount += 1;
            line = 0;
            lineWidth = 0;
          }
        }
        continue;
      }
      var w = widthOf(code) * l.fontSize;
      if (lineWidth > 0 && lineWidth + w > usable) {
        line += 1;
        lineWidth = 0;
        if (line >= maxLines) {
          starts.push(i);
          pageCount += 1;
          line = 0;
          continue;
        }
      }
      lineWidth += w;
      i += 1;
    }
  }

  return {
    starts: starts,
    pageCount: pageCount,
    layoutKey: String(l.fontLevel) + ':' + String(l.lineLevel) + ':' + String(l.width)
  };
}

/** Returns the text slice for one page. This is the only string allocation. */
function pageText(text, starts, index) {
  var s = text === null || text === undefined ? '' : String(text);
  if (!starts || starts.length === 0) {
    return index === 0 || index === undefined ? s : '';
  }
  var i = index === undefined || index === null ? 0 : Math.floor(index);
  if (i < 0) {
    i = 0;
  }
  if (i > starts.length - 1) {
    i = starts.length - 1;
  }
  var start = starts[i];
  var end = i + 1 < starts.length ? starts[i + 1] : s.length;
  if (start < 0) {
    start = 0;
  }
  if (end > s.length) {
    end = s.length;
  }
  if (end <= start) {
    return '';
  }
  return s.substring(start, end);
}

/** Largest page index whose start offset is <= offset. */
function findPageByOffset(starts, offset) {
  if (!starts || starts.length === 0) {
    return 0;
  }
  var target = offset === undefined || offset === null ? 0 : offset;
  var low = 0;
  var high = starts.length - 1;
  var result = 0;
  while (low <= high) {
    var mid = (low + high) >> 1;
    if (starts[mid] <= target) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

export default {
  paginate: paginate,
  pageText: pageText,
  findPageByOffset: findPageByOffset,
  layoutKey: layoutKey,
  normalizeLayout: normalizeLayout,
  widthOf: widthOf
};
