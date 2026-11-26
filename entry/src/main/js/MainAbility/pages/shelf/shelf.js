import Route from '../../common/route.js';
import Config from '../../common/config.js';
import Txt from '../../common/txt.js';
import Url from '../../common/url.js';
import Store from '../../common/store.js';
import Paging from '../../common/paging.js';
import Gesture from '../../common/gesture.js';
import Fade from '../../common/fade.js';
import Crown from '../../common/crown.js';
import Layout from '../../common/layout.js';

var READER_PAGE = 'pages/reader/reader';

function two(value) {
  return value < 10 ? '0' + value : '' + value;
}

function formatTime(ts) {
  if (!ts) {
    return '';
  }
  var d = new Date(ts);
  return two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}

export default {
  data: {
    title: '书签',
    countLabel: '',
    hint: '',
    showHint: true,
    fadeOpacity: 1,
    clearLabel: Txt.CLEAR_HISTORY,
    hasClear: false,
    hasItems: false,
    hasPager: false,
    hasPrevPage: false,
    hasNextPage: false,
    pageLabel: '',
    prevColor: '#4A4A4C',
    nextColor: '#4A4A4C',
    emptyTitle: '',
    emptySub: '',
    bmColor: '#FFFFFF',
    hisColor: '#8E8E93',
    bmBg: '#2D6CFF',
    hisBg: '#1C1C1E',
    items: [],
    g: Layout.page('shelf')
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('shelf');
      Layout.syncConfig();
    });
    this.mode = 'bookmark';
    this.confirmClear = false;
    this.initialized = false;
    this.page = 0;
    this.allItems = [];
    this.pageStart = 0;
    var params = Route.takeSync();
    if (params && params.tab === 'history') {
      this.mode = 'history';
    }
    Store.init();
    this.load();
    this.initialized = true;

    var that = this;
    Store.init(function () {
      if (that.initialized) {
        that.load();
      }
    });
  },

  onShow() {
    if (this.initialized) {
      this.load();
    }
  },

  load() {
    var source = this.mode === 'history' ? Store.loadHistory() : Store.loadBookmarks();
    var items = [];
    for (var i = 0; i < source.length && i < Config.MAX_STORE_ITEMS; i += 1) {
      var entry = source[i];
      var sub = Url.hostOf(entry.url) || Url.displayOf(entry.url);
      if (this.mode === 'history') {
        var when = formatTime(entry.visitedAt);
        if (when) {
          sub = sub + '  ·  ' + when;
        }
      }
      items.push({ url: entry.url, title: entry.title, sub: sub });
    }

    this.title = this.mode === 'history' ? '浏览历史' : '我的书签';
    this.hasClear = this.mode === 'history';
    this.hint = this.mode === 'history' ? '按最近访问倒序' : '点击条目直接打开';
    this.clearLabel = this.confirmClear ? Txt.CLEAR_CONFIRM : Txt.CLEAR_HISTORY;
    this.allItems = items;
    this.applyPage();

    if (this.mode === 'history') {
      this.emptyTitle = Txt.HISTORY_EMPTY;
      this.emptySub = '打开一篇文章后会自动记录在这里';
      this.bmColor = '#8E8E93';
      this.hisColor = '#FFFFFF';
      this.bmBg = '#1C1C1E';
      this.hisBg = '#2D6CFF';
    } else {
      this.emptyTitle = Txt.BOOKMARKS_EMPTY;
      this.emptySub = '阅读时点击收藏，文章会出现在这里';
      this.bmColor = '#FFFFFF';
      this.hisColor = '#8E8E93';
      this.bmBg = '#2D6CFF';
      this.hisBg = '#1C1C1E';
    }
  },

  /* 列表分页：每页 Config.LIST_PAGE_SIZE 条。同屏渲染 40~50 条会掉到 10fps 以下，
     这里只把当前页切片交给 list 渲染（见 common/paging.js）。 */
  applyPage() {
    var win = Paging.windowOf(this.allItems.length, this.page);
    this.page = win.page;
    this.pageStart = win.start;
    this.items = Paging.slice(this.allItems, win);
    this.pageLabel = win.label ? win.label : (win.count > 0 ? '1/1' : '0/0');
    this.hasPager = win.pageCount > 1;
    this.hasPrevPage = win.hasPrev;
    this.hasNextPage = win.hasNext;
    this.prevColor = win.hasPrev ? '#64B5FF' : '#4A4A4C';
    this.nextColor = win.hasNext ? '#64B5FF' : '#4A4A4C';
    this.showHint = !this.hasPager;
    this.countLabel = '共 ' + win.count + ' 条';
    this.hasItems = win.count > 0;
    Fade.fadeIn(this);
    /* 表冠焦点跟随当前列表（列表在 if 分支内，延时重申） */
    Crown.applyLater(this, [['itemList', this.hasItems]]);
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

  onShowBookmarks() {
    if (this.mode !== 'bookmark') {
      this.mode = 'bookmark';
      this.confirmClear = false;
      this.page = 0;
      this.load();
    }
  },

  onShowHistory() {
    if (this.mode !== 'history') {
      this.mode = 'history';
      this.confirmClear = false;
      this.page = 0;
      this.load();
    }
  },

  onOpen(index) {
    var item = this.items[index];
    if (!item) {
      return;
    }
    Route.go(READER_PAGE, { url: item.url });
  },

  onDelete(index) {
    var item = this.items[index];
    if (!item) {
      return;
    }
    if (this.mode === 'history') {
      Store.removeHistory(item.url);
    } else {
      Store.removeBookmark(item.url);
    }
    this.confirmClear = false;
    this.load();
  },

  onClear() {
    if (this.mode !== 'history') {
      return;
    }
    if (!this.confirmClear) {
      this.confirmClear = true;
      this.clearLabel = Txt.CLEAR_CONFIRM;
      return;
    }
    Store.clearHistory();
    this.confirmClear = false;
    this.page = 0;
    this.load();
  },

  onBack() {
    Route.goHome();
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

  onHide() {
    Crown.cancel(this);
    Crown.apply(this, [['itemList', false]]);
  },

  onDestroy() {
    Crown.cancel(this);
    Crown.apply(this, [['itemList', false]]);
    Fade.cancel(this);
  }
};
