import Route from '../../common/route.js';
import Txt from '../../common/txt.js';
import Gesture from '../../common/gesture.js';
import Crown from '../../common/crown.js';
import Space from '../../common/space.js';
import Layout from '../../common/layout.js';
import Store from '../../common/store.js';

var READER_PAGE = 'pages/reader/reader';
var SHELF_PAGE = 'pages/shelf/shelf';
var SEARCH_PAGE = 'pages/search/search';
var OFFLINE_PAGE = 'pages/offline/offline';
/* 关于页显示的版本号：与 AppScope/app.json5、entry/src/main/config.json 同步
   （smoke.js 有三处一致性用例，改动版本号时三处一起改） */
var APP_VERSION = 'Release V1.1.1';

export default {
  data: {
    /* 首页 = 原生 swiper 双页（微信 v1.1 同款结构 swiper > div > list）：
       0 = 主页大胶囊目录（list 竖向滚动），1 = 关于（可滚动卡片列表）；
       左右连贯滑动由原生 swiper 驱动。 */
    pageIndex: 0,
    appVersion: APP_VERSION,
    menu: [
      { key: 'search', name: '搜索网页', icon: '/common/ic_search.png' },
      { key: 'novel', name: '搜索小说', icon: '/common/ic_book.png' },
      { key: 'bookmark', name: '我的书签', icon: '/common/ic_book.png' },
      { key: 'history', name: '浏览历史', icon: '/common/ic_clock.png' },
      { key: 'offline', name: '离线网页', icon: '/common/ic_doc.png' },
      { key: 'test', name: '内置测试站', icon: '/common/ic_target.png' }
    ],
    /* 信息页存储行（v3.3）：仅「本地文件」= 离线网页（二次确认）。
       网页缓存功能已删除，「应用缓存」行随之移除。
       v3.10：卡内小按钮改为卡下方「清除数据」大胶囊（尺寸统一 376×100）。 */
    savedText: '统计中…',
    savedBtn: '清除数据',
    savedBtnColor: '#FFFFFF',
    /* v1.0.8 设备能力显示 + 强开完整模式 */
    screenType: '检测中…',
    perfMode: '检测中…',
    forceFullLabel: '强开完整模式',
    forceFullColor: '#8E8E93',
    /* v1.0.8 清除全部数据（崩溃修复用） */
    clearAllLabel: '清除全部数据',
    clearAllColor: '#FFFFFF',
    /* 双屏几何：默认方屏 408×480（与原 CSS 完全一致）；
       Layout.init 检测到圆屏后整体替换为 466×466 纵向压缩布局。 */
    g: Layout.page('index'),
    /* 形态判定完成前只渲染全屏黑底 boot（g.layoutReady != true）；
       回调里把 layoutReady 合并进 g 后一次性 setData，最终只构建
       圆屏或方屏其中一棵，避免 GT6 上整树替换造成的紫色块/残影。 */
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      var geo = Layout.page('index');
      geo.layoutReady = true;
      that.g = geo;
      that.refreshCaps();
      Crown.applyLater(that, [
        ['homeList', that.pageIndex === 0],
        ['aboutList', that.pageIndex === 1]
      ]);
    });
  },

  onShow() {
    /* 表冠焦点（微信 rotateChange 同款）：随所在页聚焦对应列表 */
    this.armCrown();
    this.refreshSpace();
  },

  onHide() {
    Crown.cancel(this);
    Crown.apply(this, [['homeList', false], ['aboutList', false]]);
    this.resetSpaceUi();
  },

  onDestroy() {
    Crown.cancel(this);
    Crown.apply(this, [['homeList', false], ['aboutList', false]]);
    this.resetSpaceUi();
  },

  armCrown() {
    Crown.apply(this, [
      ['homeList', this.pageIndex === 0],
      ['aboutList', this.pageIndex === 1]
    ]);
  },

  /* ---------------- 信息页：存储占用与清理（v3.2） ---------------- */

  refreshSpace() {
    var that = this;
    Space.usage(function (u) {
      that.savedText = Space.formatBytes(u.savedBytes) + ' · ' + u.savedCount + ' 篇';
    });
    this.refreshCaps();
  },

  /* v1.0.8 设备能力 + 强开完整模式 */
  refreshCaps() {
    this.screenType = Layout.isRound() ? '圆屏' : '方屏';
    var p = Layout.get();
    var limited = p.round || p.apiVersion <= 0 || p.apiVersion < 24;
    this.perfMode = limited ? '受限' : '完整';
    var ff = Store.loadPrefs().forceFull;
    this.forceFullLabel = ff ? '强开完整模式：已开' : '强开完整模式';
    this.forceFullColor = ff ? '#30D158' : '#8E8E93';
  },

  onToggleForceFull() {
    var prefs = Store.loadPrefs();
    var next = !prefs.forceFull;
    prefs.forceFull = next;
    Store.savePrefs(prefs);
    this.forceFullLabel = next ? '强开完整模式：已开' : '强开完整模式';
    this.forceFullColor = next ? '#30D158' : '#8E8E93';
    this.perfMode = next ? '完整(强制)' : (Layout.get().round || Layout.get().apiVersion <= 0 || Layout.get().apiVersion < 24) ? '受限' : '完整';
  },

  /* v1.0.8 清除全部数据（崩溃修复用）：二次确认 */
  onClearAll() {
    if (!this.clearAllConfirm) {
      this.clearAllConfirm = true;
      this.clearAllLabel = '确认清除全部数据';
      this.clearAllColor = '#FF453A';
      return;
    }
    var that = this;
    this.clearAllConfirm = false;
    this.clearAllLabel = '清除中…';
    this.clearAllColor = '#FFFFFF';
    Space.clearSaved(function () {
      Store.clearHistory();
      that.clearAllLabel = '已全部清除';
      that.clearAllColor = '#30D158';
      that.savedText = '0 B · 0 篇';
      if (that.clearAllTimer) { clearTimeout(that.clearAllTimer); }
      that.clearAllTimer = setTimeout(function () {
        that.clearAllLabel = '清除全部数据';
        that.clearAllColor = '#FFFFFF';
      }, 1500);
    });
  },

  /* 本地文件 = 离线网页正文（用户内容），二次确认后清除 */
  onClearSaved() {
    if (!this.savedConfirm) {
      this.savedConfirm = true;
      this.savedBtn = '确认清除数据';
      this.savedBtnColor = '#FF453A';
      return;
    }
    var that = this;
    this.savedConfirm = false;
    this.savedBtn = '清除中…';
    this.savedBtnColor = '#FFFFFF';
    Space.clearSaved(function () {
      that.savedText = '0 B · 0 篇';
      that.flashBtn('savedBtn');
    });
  },

  flashBtn(field) {
    var that = this;
    this[field] = '已清除';
    if (this.spaceTimer) {
      clearTimeout(this.spaceTimer);
    }
    this.spaceTimer = setTimeout(function () {
      that.spaceTimer = 0;
      that[field] = '清除数据';
    }, 1200);
  },

  resetSpaceUi() {
    if (this.spaceTimer) {
      clearTimeout(this.spaceTimer);
      this.spaceTimer = 0;
    }
    this.savedConfirm = false;
    this.savedBtn = '清除数据';
    this.savedBtnColor = '#FFFFFF';
  },

  /* ---------------- 原生 swiper 翻页 ---------------- */

  onPageChange(event) {
    var idx = 0;
    if (event === null || event === undefined) {
      idx = 0;
    } else if (typeof event === 'number') {
      idx = event;
    } else if (typeof event.index === 'number') {
      idx = event.index;
    }
    if (idx < 0) {
      idx = 0;
    }
    if (idx > 1) {
      idx = 1;
    }
    this.pageIndex = idx;
    /* 表冠焦点跟随翻页（微信 onSwiperChange 同款）；信息页显示刷新 */
    this.armCrown();
    if (idx === 1) {
      this.refreshSpace();
    }
  },

  onMenu(index) {
    if (index === 0) {
      Route.go(SEARCH_PAGE, { q: '' });
    } else if (index === 1) {
      Route.go('pages/novel/novel', {});
    } else if (index === 2) {
      Route.go(SHELF_PAGE, { tab: 'bookmark' });
    } else if (index === 3) {
      Route.go(SHELF_PAGE, { tab: 'history' });
    } else if (index === 4) {
      Route.go(OFFLINE_PAGE, {});
    } else if (index === 5) {
      Route.go(READER_PAGE, { url: Txt.TEST_URL });
    }
  },

  /* ---------------- 手势轴向互斥（v2.8 斜向运动修复） ----------------
     目标：上下滑动过程中不允许左右翻页；左右翻页过程中不允许上下滚动。
     主通道（touchstart 带方向，微信 FIT4 同款逻辑）：
     - 竖向 → 立即 stopPropagation（swiper 全程失明），列表原生滚动；
     - 横向 → 立即 SetDraggable(false) 冻结列表，事件上浮给原生 swiper 跟手翻页。
     兜底通道（touchstart 无方向字段）：
     - 起手即 stopPropagation（swiper 失明，杜绝斜向双动），列表暂不冻结；
     - 位移过 5px 按主轴锁定：竖向照旧滚动；横向冻结列表，抬手 swipeTo
       原生动画翻页（300ms 过渡，不跟手但绝无跳变）。
     两个列表（homeList / aboutList）共用实现，refName 区分冻结对象。 */

  onListTouchStart(event) {
    this.gestureStart(event, 'homeList');
  },

  onListTouchMove(event) {
    this.gestureMove(event, 'homeList');
  },

  onListTouchEnd(event) {
    this.gestureEnd(event, 'homeList');
  },

  onAboutTouchStart(event) {
    this.gestureStart(event, 'aboutList');
  },

  onAboutTouchMove(event) {
    this.gestureMove(event, 'aboutList');
  },

  onAboutTouchEnd(event) {
    this.gestureEnd(event, 'aboutList');
  },

  gestureStart(event, refName) {
    this.tRef = refName;
    this.tVertical = false;
    this.tHorizontal = false;
    this.tDecided = false;
    this.tNative = false;
    var p = Gesture.pointOf(event);
    this.tX = p ? p.x : 0;
    this.tY = p ? p.y : 0;
    var dir = Gesture.dirOf(event);
    if (dir === 'up' || dir === 'down') {
      this.tVertical = true;
      this.tDecided = true;
      this.stopTouch(event);
      return;
    }
    if (dir === 'left' || dir === 'right') {
      this.tHorizontal = true;
      this.tDecided = true;
      this.tNative = true;
      this.setListDraggable(false, refName);
      return;
    }
    /* 起手方向未知：swiper 先失明（防斜向双动），列表保持自由（保竖滑手感） */
    this.stopTouch(event);
  },

  gestureMove(event) {
    if (this.tDecided) {
      if (this.tVertical) {
        this.stopTouch(event);
      }
      return;
    }
    /* 兜底判定：先信事件自带方向，再按位移主轴 */
    var dir = Gesture.dirOf(event);
    var p = Gesture.pointOf(event);
    var dx = p ? p.x - this.tX : 0;
    var dy = p ? p.y - this.tY : 0;
    var adx = dx < 0 ? -dx : dx;
    var ady = dy < 0 ? -dy : dy;
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
      if (adx < 5 && ady < 5) {
        this.stopTouch(event);
        return;
      }
      dir = ady > adx ? (dy < 0 ? 'up' : 'down') : (dx < 0 ? 'left' : 'right');
    }
    this.tDecided = true;
    if (dir === 'up' || dir === 'down') {
      this.tVertical = true;
      this.stopTouch(event);
    } else {
      this.tHorizontal = true;
      this.setListDraggable(false, this.tRef);
    }
  },

  gestureEnd(event) {
    if (this.tVertical) {
      this.stopTouch(event);
    }
    if (this.tHorizontal && !this.tNative) {
      /* 兜底横向：swiper 全程失明，抬手用原生动画翻页（左滑 dx<0 → 下一页） */
      var p = Gesture.pointOf(event);
      var dx = p ? p.x - this.tX : 0;
      if (dx <= -80) {
        this.pageTo(this.pageIndex + 1);
      } else if (dx >= 80) {
        this.pageTo(this.pageIndex - 1);
      }
    }
    this.setListDraggable(true, this.tRef);
    this.tVertical = false;
    this.tHorizontal = false;
    this.tDecided = false;
    this.tNative = false;
  },

  /* 原生 swiper 跳页（微信 motion.js swipeTo 同款，守卫调用） */
  pageTo(index) {
    if (index < 0 || index > 1) {
      return;
    }
    try {
      var el = this.$refs && this.$refs.homeSwiper ? this.$refs.homeSwiper : null;
      if (!el && typeof this.$element === 'function') {
        el = this.$element('homeSwiper');
      }
      if (el && typeof el.swipeTo === 'function') {
        el.swipeTo({ index: index });
      }
    } catch (err) {
      /* ignore */
    }
  },

  stopTouch(event) {
    try {
      if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    } catch (err) {
      /* ignore */
    }
  },

  /* list.SetDraggable 为平台隐藏方法（微信包实证存在），守卫调用 */
  setListDraggable(value, refName) {
    try {
      var name = refName || 'homeList';
      var el = this.$refs && this.$refs[name] ? this.$refs[name] : null;
      if (!el && typeof this.$element === 'function') {
        el = this.$element(name);
      }
      if (el && typeof el.SetDraggable === 'function') {
        el.SetDraggable({ draggable: value });
      }
    } catch (err) {
      /* ignore */
    }
  }
};
