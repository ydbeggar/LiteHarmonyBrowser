/**
 * Cross-page session singleton.
 *
 * The only owner of large Document objects. At most Config.MAX_DOCS (=1)
 * frames keep a full document; older frames degrade to url + title +
 * pageIndex and are re-fetched on demand. Pages therefore must NOT keep
 * their own reference to `doc`, otherwise the 800KB heap cap is broken.
 * （v3.5：dropDocs 在新抓取开始前清空全部常驻文档——大站加载峰值
 * 约 240K 时不能叠加旧文档驻留，创世中文网 ch3 崩溃教训。）
 */
import Config from './config.js';

var frames = [];
var currentUrl = '';
var seqCounter = 0;

function findByUrl(url) {
  for (var i = 0; i < frames.length; i += 1) {
    if (frames[i].url === url) {
      return frames[i];
    }
  }
  return null;
}

function nextSeq() {
  seqCounter += 1;
  return seqCounter;
}

function clampIndex(value, max) {
  var n = Number(value);
  if (isNaN(n) || n < 0) {
    n = 0;
  }
  n = Math.floor(n);
  if (max !== undefined && n > max) {
    n = max;
  }
  return n;
}

function pruneDocs() {
  var withDocs = [];
  for (var i = 0; i < frames.length; i += 1) {
    if (frames[i].doc) {
      withDocs.push(frames[i]);
    }
  }
  withDocs.sort(function (a, b) {
    return b.seq - a.seq;
  });
  for (var j = Config.MAX_DOCS; j < withDocs.length; j += 1) {
    withDocs[j].doc = null;
  }
}

/**
 * 清空全部常驻文档（保留 url/title/pageIndex 元数据，按需重抓）。
 * 在新抓取开始前调用：让加载峰值（响应+解析临时区）独占堆空间。
 */
function dropDocs() {
  for (var i = 0; i < frames.length; i += 1) {
    frames[i].doc = null;
  }
}

function trimFrames() {
  while (frames.length > Config.MAX_FRAMES) {
    var index = -1;
    var i;
    for (i = 0; i < frames.length; i += 1) {
      if (!frames[i].doc && frames[i].url !== currentUrl) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      for (i = 0; i < frames.length; i += 1) {
        if (frames[i].url !== currentUrl) {
          index = i;
          break;
        }
      }
    }
    if (index < 0) {
      break;
    }
    frames.splice(index, 1);
  }
}

function ensureFrame(url, title, pageIndex) {
  var frame = findByUrl(url);
  if (!frame) {
    frame = {
      url: url,
      title: title || url,
      pageIndex: clampIndex(pageIndex),
      doc: null,
      seq: 0
    };
    frames.push(frame);
  }
  return frame;
}

/** Registers a freshly loaded document and makes it current. */
function open(doc, pageIndex) {
  if (!doc || !doc.url) {
    return null;
  }
  var frame = ensureFrame(doc.url, doc.title, pageIndex);
  frame.doc = doc;
  frame.title = doc.title || doc.url;
  frame.pageIndex = clampIndex(pageIndex);
  frame.seq = nextSeq();
  currentUrl = doc.url;
  pruneDocs();
  trimFrames();
  return frame;
}

function setCurrent(doc, pageIndex) {
  return open(doc, pageIndex);
}

function getCurrent() {
  return findByUrl(currentUrl);
}

function getFrame(url) {
  return findByUrl(url);
}

function getDoc(url) {
  var frame = findByUrl(url);
  return frame ? frame.doc : null;
}

function hasDoc(url) {
  return getDoc(url) !== null;
}

function setPage(url, pageIndex) {
  var frame = findByUrl(url);
  if (frame) {
    frame.pageIndex = clampIndex(pageIndex);
  }
}

function getPage(url) {
  var frame = findByUrl(url);
  return frame ? frame.pageIndex : 0;
}

/**
 * Registers (or refreshes) a frame without replacing its document. Used when
 * the links page hands over to a child reader page.
 */
function push(url, doc, pageIndex) {
  if (!url) {
    return null;
  }
  var frame = ensureFrame(url, doc ? doc.title : url, pageIndex);
  if (doc) {
    frame.doc = doc;
    frame.title = doc.title || url;
  }
  frame.pageIndex = clampIndex(pageIndex);
  frame.seq = nextSeq();
  currentUrl = url;
  pruneDocs();
  trimFrames();
  return frame;
}

/** Returns to the most recently used other frame (used by tests/back fallback). */
function pop() {
  var best = null;
  for (var i = 0; i < frames.length; i += 1) {
    var frame = frames[i];
    if (frame.url === currentUrl) {
      continue;
    }
    if (!best || frame.seq > best.seq) {
      best = frame;
    }
  }
  if (!best) {
    return null;
  }
  currentUrl = best.url;
  return best;
}

function reset() {
  frames = [];
  currentUrl = '';
  seqCounter = 0;
}

function stackSize() {
  return frames.length;
}

function docCount() {
  var count = 0;
  for (var i = 0; i < frames.length; i += 1) {
    if (frames[i].doc) {
      count += 1;
    }
  }
  return count;
}

export default {
  open: open,
  setCurrent: setCurrent,
  getCurrent: getCurrent,
  getFrame: getFrame,
  getDoc: getDoc,
  hasDoc: hasDoc,
  setPage: setPage,
  getPage: getPage,
  push: push,
  pop: pop,
  dropDocs: dropDocs,
  reset: reset,
  stackSize: stackSize,
  docCount: docCount
};
