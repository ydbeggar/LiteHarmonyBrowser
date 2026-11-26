import Route from '../../common/route.js';
import Config from '../../common/config.js';
import Url from '../../common/url.js';
import Linkpass from '../../common/linkpass.js';
import Paging from '../../common/paging.js';
import Gesture from '../../common/gesture.js';
import Fade from '../../common/fade.js';
import Navrule from '../../common/navrule.js';
import Crown from '../../common/crown.js';
import Layout from '../../common/layout.js';

var READER_PAGE = 'pages/reader/reader';

export default {
  data: {
    title: '链接',
    countLabel: '',
    hasLinks: false,
    fadeOpacity: 1,
    hasPager: false,
    hasPrevPage: false,
    hasNextPage: false,
    pageLabel: '',
    prevColor: '#4A4A4C',
    nextColor: '#4A4A4C',
    links: [],
    g: Layout.page('links')
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('links');
      Layout.syncConfig();
    });
    this.page = 0;
    this.allLinks = [];
    this.openedOnce = false;
    this.loadLinks();
  },

  onShow() {
    /* 首次进入 onInit 已载入，跳过重复读；后续（亮屏等）重新载入保持新鲜 */
    if (this.openedOnce) {
      this.loadLinks();
    }
    this.openedOnce = true;
  },

  onHide() {
    Crown.cancel(this);
    Crown.apply(this, [['itemList', false]]);
  },

  onDestroy() {
    Crown.cancel(this);
    Crown.apply(this, [['itemList', false]]);
  },

  loadLinks() {
    var that = this;
    /* v3.4：链接表由阅读页经文件通道传入（linkpass）。旧实现读本页
       Session——每页独立 bundle、模块不跨页共享，永远是空副本，
       「目录」因此永远显示"本页无可用链接"（目录识别失败的真根因）。 */
    Linkpass.load(function (payload) {
      var links = payload && payload.links ? payload.links : null;
      if (!links || links.length < 1) {
        that.title = '链接';
        that.countLabel = '0';
        that.hasLinks = false;
        that.hasPager = false;
        that.allLinks = [];
        that.links = [];
        Fade.fadeIn(that);
        return;
      }

      that.title = payload.title || '链接';
      var chapters = [];
      var others = [];
      var source = links;
      for (var i = 0; i < source.length && chapters.length + others.length < Config.MAX_LINKS; i += 1) {
        var href = source[i].href;
        var text = source[i].text;
        if (!href) {
          continue;
        }
        if (!text || text.length === 0) {
          text = Url.displayOf(href);
        }
        var item = {
          href: href,
          text: text,
          sub: Url.hostOf(href) || Url.displayOf(href)
        };
        /* 「第x章」类章节链接置顶，目录页直达阅读更顺手 */
        if (Navrule.isChapterText(text)) {
          chapters.push(item);
        } else {
          others.push(item);
        }
      }

      that.allLinks = chapters.concat(others);
      that.applyPage();
    });
  },

  /* 列表分页：每页 Config.LIST_PAGE_SIZE 条，避免 40 条同屏掉到 14fps 以下 */
  applyPage() {
    var win = Paging.windowOf(this.allLinks.length, this.page);
    this.page = win.page;
    this.links = Paging.slice(this.allLinks, win);
    this.pageLabel = win.label ? win.label : (win.count > 0 ? '1/1' : '0/0');
    this.hasPager = win.pageCount > 1;
    this.hasPrevPage = win.hasPrev;
    this.hasNextPage = win.hasNext;
    this.prevColor = win.hasPrev ? '#64B5FF' : '#4A4A4C';
    this.nextColor = win.hasNext ? '#64B5FF' : '#4A4A4C';
    this.hasLinks = win.count > 0;
    this.countLabel = win.count > 0 ? '共 ' + win.count + ' 条' : '0';
    Fade.fadeIn(this);
    /* 表冠焦点跟随当前列表（列表在 if 分支内，延时重申） */
    Crown.applyLater(this, [['itemList', this.hasLinks]]);
  },

  onPrevPage() {
    if (!this.hasPrevPage) {
      return;
    }
    this.page = this.page - 1;
    this.applyPage();
  },

  onNextPage() {
    if (!this.hasNextPage) {
      return;
    }
    this.page = this.page + 1;
    this.applyPage();
  },

  onOpen(index) {
    var item = this.links[index];
    if (!item || !item.href) {
      return;
    }
    /* 子页独立 bundle 自行重新抓取（跨页文档不共享，route 参数只带 URL） */
    Route.go(READER_PAGE, { url: item.href });
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
  },

  onDestroy() {
    Fade.cancel(this);
  }
};
