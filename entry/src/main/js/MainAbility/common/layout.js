/**
 * 屏幕形态 / 性能档位（v1.0.6 双屏适配）。
 *
 * 目标：
 * - 方形：HUAWEI WATCH FIT 5 Pro 408×480 圆角矩形（既有像素级布局保持不变）；
 * - 圆形：HUAWEI WATCH GT 系列 466×466 纯圆形显示区。
 *
 * 判定依据（优先级从高到低）：
 * 1) windowWidth / windowHeight 是否相等（圆屏通常 1:1，最强信号）；
 * 2) @system.device.getInfo 的 screenShape（'circle' / 'rect'）；
 * 3) model / product 字符串中的 GT / FIT 关键字（旧固件不返回尺寸时的兜底）。
 * getInfo 失败或 600ms 无回调时回落方形 408×480（当前主力真机形态）。
 *
 * 布局策略：
 * - 方屏保持 408×480 原值，所有几何值与原 CSS 完全一致；
 * - 圆屏不改变 376px 内容列宽（466 圆屏在 y=96..370 区间可完整容纳 376 宽），
 *   仅压缩纵向：页头下移到 y=100、正文区 210px 高、底部元素上移，
 *   避开圆屏四角死区；首页标题改居中。
 * - 页面通过 style="width: {{g.xxx}}px; ..." 绑定；g 默认即方屏值，
 *   因此方屏首帧与旧版一致。
 *
 * 网络档位（用户反馈：部分设备 fetch 明显慢于 FIT5 Pro）：
 * - 方屏（FIT5 Pro 实测 45.5KB/s）：20s 超时、48K 解析窗口；
 * - 圆屏 GT：45s 超时、40K 解析窗口（Round 机型网络栈普遍更慢）；
 * - apiVersion < 24 的老机型：60s 超时、32K 解析窗口，进一步降低堆峰值。
 * 这些值只影响单次请求上限与等待时间，不改变正文 12K/10K/8K 的显示上限语义。
 *
 * P1 前置（v1.0.8）：respCapBytes（Range 字节上限）与 parseWindowChars（解析字符窗口）
 * 分离。apiVersion 防御解析：number 直接用；string 取首段；NaN/0 按最慢档。
 */
import device from '@system.device';
import Config from './config.js';

var FIT = {
  shape: 'rect',
  round: false,
  w: 408,
  h: 480,
  timeoutMs: 20000,
  loadMs: 4000,
  maxHtml: 48000,
  maxText: 12000,
  maxResp: 131072,
  respCapBytes: 98304,
  parseWindowChars: 44000,
  slow: false
};

var ROUND = {
  shape: 'circle',
  round: true,
  w: 466,
  h: 466,
  timeoutMs: 45000,
  loadMs: 30000,
  maxHtml: 40000,
  maxText: 10000,
  maxResp: 110000,
  /* v1.1.1：圆屏=GT 系列按受限档处理，字节上限回到 v1.0.7 的 40KB，
     不再沿用 v1.1.0 的 64KB（GT6 大面积 BUG 的怀疑源头）。 */
  respCapBytes: 40960,
  parseWindowChars: 32000,
  slow: true
};

var current = null;
var started = false;
var pending = [];
var watchdog = 0;

function copyProfile(base) {
  return {
    shape: base.shape,
    round: base.round,
    w: base.w,
    h: base.h,
    timeoutMs: base.timeoutMs,
    loadMs: base.loadMs,
    maxHtml: base.maxHtml,
    maxText: base.maxText,
    maxResp: base.maxResp,
    respCapBytes: base.respCapBytes,
    parseWindowChars: base.parseWindowChars,
    slow: base.slow,
    apiVersion: 0,
    model: '',
    source: ''
  };
}

function classify(info) {
  var shape = info && info.screenShape ? String(info.screenShape) : '';
  var w = info ? Number(info.windowWidth) : 0;
  var h = info ? Number(info.windowHeight) : 0;
  var model = '';
  if (info) {
    model = String(info.model || info.product || '').toUpperCase();
  }
  var round = false;
  /* 1:1 宽高比是圆屏最强信号，优先于厂商可能填错的 screenShape */
  if (w > 0 && h > 0 && Math.abs(w - h) <= 2) {
    round = true;
  } else if (shape === 'circle') {
    round = true;
  } else if (shape === 'rect') {
    round = false;
  } else if (model.indexOf('GT') >= 0) {
    round = true;
  } else if (model.indexOf('FIT') >= 0) {
    round = false;
  }
  var p = round ? copyProfile(ROUND) : copyProfile(FIT);
  /* P1 前置：apiVersion 防御解析。SDK 声明 number，但真机可能返回
     字符串（"26.0.0"）、0 或缺失。number 直接用；string 取首段；
     NaN/0 按最慢档（安全保守）。 */
  var rawApi = info ? info.apiVersion : 0;
  var api = 0;
  if (typeof rawApi === 'number' && !isNaN(rawApi)) {
    api = Math.floor(rawApi);
  } else if (typeof rawApi === 'string' && rawApi) {
    api = parseInt(rawApi, 10);
    if (isNaN(api)) {
      api = 0;
    }
  }
  p.apiVersion = api;
  p.model = model;
  p.source = shape || (w > 0 ? String(w) + 'x' + String(h) : 'fallback');
  /* API<24 老机型或无法确定版本时（apiVersion=0/NaN）：按最慢档保守处理 */
  if (p.apiVersion <= 0 || p.apiVersion < 24) {
    p.slow = true;
    p.timeoutMs = 60000;
    p.loadMs = 45000;
    p.maxHtml = 32000;
    p.maxText = 8000;
    p.maxResp = 90000;
    p.respCapBytes = 32000;
    p.parseWindowChars = 28000;
  }
  return p;
}

function applyToConfig(p) {
  /* 这些常量被 html.js / net.js 直接读取；模块在单页 bundle 内共享，
     因此检测完成后同步一次即可覆盖本页后续解析。（不跨页共享，每页各自 init。） */
  Config.MAX_HTML_CHARS = p.parseWindowChars;
  Config.MAX_TEXT_CHARS = p.maxText;
  Config.MAX_RESPONSE_CHARS = p.respCapBytes;
  Config.FETCH_TIMEOUT = p.timeoutMs;
}

function finish(p) {
  if (current) {
    return;
  }
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = 0;
  }
  current = p;
  applyToConfig(p);
  var queue = pending;
  pending = [];
  for (var i = 0; i < queue.length; i += 1) {
    try {
      queue[i](p);
    } catch (err) {
      /* 单页回调异常不影响其他等待者 */
    }
  }
}

function init(cb) {
  if (current) {
    if (typeof cb === 'function') {
      cb(current);
    }
    return;
  }
  if (typeof cb === 'function') {
    pending.push(cb);
  }
  if (started) {
    return;
  }
  started = true;
  /* 兜底：getInfo 无回调/异常时 600ms 后按方屏继续，页面不能永远空白 */
  watchdog = setTimeout(function () {
    finish(classify(null));
  }, 600);
  try {
    if (!device || typeof device.getInfo !== 'function') {
      finish(classify(null));
      return;
    }
    device.getInfo({
      success: function (info) {
        finish(classify(info));
      },
      fail: function () {
        finish(classify(null));
      }
    });
  } catch (err) {
    finish(classify(null));
  }
}

/* ---------------- 页面几何（方屏默认值 = 原 CSS 精确值） ---------------- */

var FIT_GEO = {
  index: {
    /* 页面内部字段：形态判定前只渲染 boot，false 时不构建任何布局树；
       由 index.js 在 Layout.init 回调中与 g 一起置 true。 */
    layoutReady: false,
    titleW: 352,
    titleX: 28,
    titleY: 24,
    titleAlign: 'left',
    menuX: 16,
    menuY: 94,
    menuH: 384,
    aboutTitleX: 16,
    aboutTitleY: 24,
    aboutShaderTopY: 66,
    aboutListX: 16,
    aboutListY: 88,
    aboutListH: 390,
    shaderTopW: 408,
    shaderTopY: 72,
    shaderW: 408,
    shaderY: 436,
    breakX: 185,
    breakY: 452
  },
  reader: {
    hdrTop: 48,
    bodyMtop: 8,
    bodyH: 320,
    textW: 376,
    textH: 320,
    zoneTopH: 150,
    zoneBottomTop: 170,
    zoneBottomH: 150,
    navTop: 258,
    panelW: 408,
    panelH: 480,
    panelHeadX: 16,
    panelHeadTop: 48,
    panelListX: 16,
    panelListY: 108,
    panelListH: 372,
    shaderTopW: 408,
    shaderTopY: 100,
    shaderW: 408,
    shaderY: 436,
    stateH: 320,
    stateSubH: 46,
    spinGap: 12,
    loadGap: 16,
    tvTitleH: 44,
    tvIntroH: 108,
    tvBtnH: 64
  },
  search: {
    hdrX: 16,
    hdrY: 48,
    detailX: 16,
    detailY: 108,
    detailH: 364,
    dTitleH: 56,
    dSubY: 58,
    dSubH: 22,
    dSumY: 84,
    dSumH: 172,
    dUrlY: 262,
    dUrlH: 20,
    dFootY: 286,
    dFootH: 56,
    btnH: 56,
    listX: 16,
    listY: 108,
    listH: 372,
    barH: 60,
    areaY: 82,
    areaH: 288,
    stateH: 288,
    itemH: 88,
    innerH: 84,
    shaderTopW: 408,
    shaderTopY: 168,
    shaderW: 408,
    shaderY: 436
  },
  ai: {
    hdrX: 16,
    hdrY: 48,
    listX: 16,
    listY: 108,
    listH: 372,
    barH: 60,
    areaY: 82,
    areaH: 288,
    stateH: 288,
    itemH: 88,
    innerH: 84,
    setupTitleH: 44,
    setupHintH: 58,
    setupInputH: 56,
    setupBtnH: 52,
    setupGap: 12,
    shaderTopW: 408,
    shaderTopY: 168,
    shaderW: 408,
    shaderY: 436
  },
  rss: {
    hdrX: 16,
    hdrY: 48,
    listX: 16,
    listY: 108,
    listH: 372,
    channelH: 52,
    feedY: 160,
    feedH: 320,
    itemH: 100,
    innerH: 96,
    detailTitleH: 56,
    detailMetaH: 22,
    detailBodyY: 84,
    detailBodyH: 216,
    detailBtnY: 308,
    detailBtnH: 52,
    shaderTopW: 408,
    shaderTopY: 168,
    shaderW: 408,
    shaderY: 436
  },
  links: {
    hdrTop: 48,
    bodyH: 304,
    listH: 304,
    emptyH: 304
  },
  shelf: {
    hdrTop: 48,
    segH: 56,
    actH: 52,
    pagerH: 56,
    bodyH: 252,
    listH: 252,
    emptyH: 252
  },
  settings: {
    hdrTop: 48,
    secH: 96,
    secLabelH: 28,
    optRowH: 60,
    optH: 56,
    keepH: 56,
    extraOn: true
  },
  offline: {
    hdrTop: 48,
    bodyH: 372,
    listH: 372,
    emptyH: 372
  }
};

/* 圆屏只覆盖纵向与少数绝对定位 X；内容列宽 376 不变 */
var ROUND_GEO = {
  index: {
    titleW: 340,
    titleX: 61,
    titleY: 64,
    titleAlign: 'center',
    menuX: 45,
    menuY: 134,
    menuH: 234,
    aboutTitleX: 45,
    aboutTitleY: 64,
    aboutShaderTopY: 106,
    aboutListX: 45,
    aboutListY: 128,
    aboutListH: 240,
    shaderTopW: 466,
    shaderTopY: 112,
    shaderW: 466,
    shaderY: 368,
    breakX: 214,
    breakY: 398
  },
  reader: {
    hdrTop: 56,
    bodyMtop: 0,
    bodyH: 264,
    textW: 340,
    textH: 264,
    zoneTopH: 110,
    zoneBottomTop: 154,
    zoneBottomH: 110,
    navTop: 220,
    panelW: 466,
    panelH: 466,
    panelHeadX: 63,
    panelHeadTop: 56,
    panelListX: 63,
    panelListY: 116,
    panelListH: 274,
    shaderTopW: 466,
    shaderTopY: 0,
    shaderW: 466,
    shaderY: 356,
    stateH: 264,
    stateSubH: 40,
    spinGap: 8,
    loadGap: 12,
    tvTitleH: 40,
    tvIntroH: 60,
    tvBtnH: 48
  },
  search: {
    hdrX: 45,
    hdrY: 100,
    detailX: 45,
    detailY: 158,
    detailH: 210,
    dTitleH: 44,
    dSubY: 44,
    dSubH: 24,
    dSumY: 68,
    dSumH: 80,
    dUrlY: 150,
    dUrlH: 20,
    dFootY: 170,
    dFootH: 40,
    btnH: 40,
    listX: 45,
    listY: 158,
    listH: 210,
    barH: 56,
    areaY: 62,
    areaH: 148,
    stateH: 148,
    itemH: 80,
    innerH: 76,
    shaderTopW: 466,
    shaderTopY: 214,
    shaderW: 466,
    shaderY: 368
  },
  ai: {
    hdrX: 63,
    hdrY: 56,
    listX: 63,
    listY: 112,
    listH: 278,
    barH: 52,
    areaY: 64,
    areaH: 214,
    stateH: 214,
    itemH: 80,
    innerH: 76,
    setupTitleH: 40,
    setupHintH: 52,
    setupInputH: 48,
    setupBtnH: 44,
    setupGap: 10,
    shaderTopW: 466,
    shaderTopY: 0,
    shaderW: 466,
    shaderY: 356
  },
  rss: {
    hdrX: 63,
    hdrY: 56,
    listX: 63,
    listY: 112,
    listH: 278,
    channelH: 48,
    feedY: 164,
    feedH: 226,
    itemH: 92,
    innerH: 88,
    detailTitleH: 44,
    detailMetaH: 24,
    detailBodyY: 76,
    detailBodyH: 150,
    detailBtnY: 236,
    detailBtnH: 40,
    shaderTopW: 466,
    shaderTopY: 0,
    shaderW: 466,
    shaderY: 356
  },
  links: {
    hdrTop: 100,
    bodyH: 210,
    listH: 210,
    emptyH: 210
  },
  shelf: {
    hdrTop: 100,
    segH: 56,
    actH: 48,
    pagerH: 48,
    bodyH: 112,
    listH: 112,
    emptyH: 112
  },
  settings: {
    hdrTop: 100,
    secH: 72,
    secLabelH: 24,
    optRowH: 48,
    optH: 44,
    keepH: 56,
    extraOn: false
  },
  offline: {
    hdrTop: 100,
    bodyH: 210,
    listH: 210,
    emptyH: 210
  }
};

function copyObject(src) {
  var out = {};
  var keys = Object.keys(src);
  for (var i = 0; i < keys.length; i += 1) {
    out[keys[i]] = src[keys[i]];
  }
  return out;
}

function buildPage(name, profile) {
  var base = FIT_GEO[name];
  if (!base) {
    return { w: profile.w, h: profile.h, round: profile.round, slow: profile.slow };
  }
  var g = copyObject(base);
  var over = profile.round ? ROUND_GEO[name] : null;
  if (over) {
    var keys = Object.keys(over);
    for (var i = 0; i < keys.length; i += 1) {
      g[keys[i]] = over[keys[i]];
    }
  }
  g.w = profile.w;
  g.h = profile.h;
  g.round = profile.round;
  g.slow = profile.slow;
  return g;
}

function page(name) {
  return buildPage(name, current || FIT);
}

function net() {
  var p = current || FIT;
  return {
    timeoutMs: p.timeoutMs,
    loadMs: p.loadMs,
    maxHtml: p.maxHtml,
    maxText: p.maxText,
    maxResp: p.maxResp,
    respCapBytes: p.respCapBytes,
    parseWindowChars: p.parseWindowChars,
    slow: p.slow
  };
}

function syncConfig() {
  applyToConfig(current || FIT);
}

/* 测试辅助：不污染当前 profile / Config */
function pageFor(info, name) {
  return buildPage(name, classify(info));
}

function netFor(info) {
  var p = classify(info);
  return {
    timeoutMs: p.timeoutMs,
    loadMs: p.loadMs,
    maxHtml: p.maxHtml,
    maxText: p.maxText,
    maxResp: p.maxResp,
    respCapBytes: p.respCapBytes,
    parseWindowChars: p.parseWindowChars,
    slow: p.slow
  };
}

function resetForTest() {
  current = null;
  started = false;
  pending = [];
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = 0;
  }
  applyToConfig(FIT);
}

export default {
  init: init,
  get: function () {
    return current || FIT;
  },
  isRound: function () {
    return !!(current && current.round);
  },
  page: page,
  net: net,
  syncConfig: syncConfig,
  _pageFor: pageFor,
  _netFor: netFor,
  _reset: resetForTest
};
