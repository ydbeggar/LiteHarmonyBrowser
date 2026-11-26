import Route from '../../common/route.js';
import prompt from '@system.prompt';
import Config from '../../common/config.js';
import Txt from '../../common/txt.js';
import Store from '../../common/store.js';
import Screen from '../../common/screen.js';
import Gesture from '../../common/gesture.js';
import Layout from '../../common/layout.js';

var READER_PAGE = 'pages/reader/reader';

var PREVIEW = '抬腕读一篇文章，字号与行距会立即生效。调整之后，阅读页会重新分页，并停在原来的内容附近。';

/* 选中态 = 青绿实心胶囊（华为创新研究强调色）；未选中 = 玻璃胶囊 */
var ON_BG = '#2D6CFF';
var OFF_BG = '#1C1C1E';
var ON_FG = '#FFFFFF';
var OFF_FG = '#8E8E93';

function pick(current, value) {
  return current === value ? ON_BG : OFF_BG;
}

function pickFg(current, value) {
  return current === value ? ON_FG : OFF_FG;
}

export default {
  data: {
    f0Bg: '#1C1C1E', f0Fg: '#8E8E93',
    f1Bg: '#1C1C1E', f1Fg: '#8E8E93',
    f2Bg: '#1C1C1E', f2Fg: '#8E8E93',
    f3Bg: '#1C1C1E', f3Fg: '#8E8E93',
    l0Bg: '#1C1C1E', l0Fg: '#8E8E93',
    l1Bg: '#1C1C1E', l1Fg: '#8E8E93',
    l2Bg: '#1C1C1E', l2Fg: '#8E8E93',
    kOnBg: '#1C1C1E', kOnFg: '#8E8E93',
    kOffBg: '#1C1C1E', kOffFg: '#8E8E93',
    fontSizePx: 24,
    lineHeightPx: 37,
    previewText: PREVIEW,
    g: Layout.page('settings')
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('settings');
      Layout.syncConfig();
    });
    this.initialized = false;
    Store.init();
    Store.setWriteErrorHandler(function () {
      try {
        prompt.showToast({ message: Txt.PREFS_FAIL, duration: 1600 });
      } catch (err) {
        /* ignore */
      }
    });
    this.applyPrefs(Store.loadPrefs());
    this.initialized = true;

    var that = this;
    Store.init(function () {
      if (that.initialized) {
        that.applyPrefs(Store.loadPrefs());
      }
    });
  },

  onShow() {
    if (this.initialized) {
      this.applyPrefs(Store.loadPrefs());
    }
  },

  applyPrefs(prefs) {
    var fs = Config.FONT_SIZES;
    var lh = Config.LINE_HEIGHTS;
    this.fontSizePx = prefs.fontSize;
    this.lineHeightPx = Math.floor(prefs.fontSize * prefs.lineHeight);

    this.f0Bg = pick(prefs.fontSize, fs[0]);
    this.f1Bg = pick(prefs.fontSize, fs[1]);
    this.f2Bg = pick(prefs.fontSize, fs[2]);
    this.f3Bg = pick(prefs.fontSize, fs[3]);
    this.f0Fg = pickFg(prefs.fontSize, fs[0]);
    this.f1Fg = pickFg(prefs.fontSize, fs[1]);
    this.f2Fg = pickFg(prefs.fontSize, fs[2]);
    this.f3Fg = pickFg(prefs.fontSize, fs[3]);

    this.l0Bg = pick(prefs.lineHeight, lh[0]);
    this.l1Bg = pick(prefs.lineHeight, lh[1]);
    this.l2Bg = pick(prefs.lineHeight, lh[2]);
    this.l0Fg = pickFg(prefs.lineHeight, lh[0]);
    this.l1Fg = pickFg(prefs.lineHeight, lh[1]);
    this.l2Fg = pickFg(prefs.lineHeight, lh[2]);

    var keepOn = prefs.keepScreenOn !== false;
    this.kOnBg = keepOn ? ON_BG : OFF_BG;
    this.kOffBg = keepOn ? OFF_BG : ON_BG;
    this.kOnFg = keepOn ? ON_FG : OFF_FG;
    this.kOffFg = keepOn ? OFF_FG : ON_FG;
  },

  save(mutate) {
    var prefs = Store.loadPrefs();
    mutate(prefs);
    Store.savePrefs(prefs);
    this.applyPrefs(prefs);
  },

  onFont(index) {
    this.save(function (prefs) {
      prefs.fontSize = Config.FONT_SIZES[index];
    });
  },

  onLine(index) {
    this.save(function (prefs) {
      prefs.lineHeight = Config.LINE_HEIGHTS[index];
    });
  },

  /* 屏幕常亮（v3.7）：开=阻止不活动超时自动息屏；立即生效并持久化 */
  onKeep(on) {
    this.save(function (prefs) {
      prefs.keepScreenOn = on === true;
    });
    Screen.apply(on === true);
  },

  onBack() {
    Route.getCurrent(function (url) {
      if (url) {
        Route.go(READER_PAGE, { url: url });
        return;
      }
      Route.goHome();
    });
  },

  /* 全局手势：右滑返回（swipe 与触摸轨迹双通道） */
  onSwipe(event) {
    if (Gesture.swipeDir(event) === 'right') {
      this.onBack();
    }
  },

  onTouchStart(event) {
    Gesture.remember(this, event);
  },

  onTouchEnd(event) {
    if (Gesture.take(this, event) === 'right') {
      this.onBack();
    }
  }
};
