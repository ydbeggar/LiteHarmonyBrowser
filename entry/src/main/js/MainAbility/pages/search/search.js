/**
 * 网页搜索页（双视图）：
 * - 列表视图：自绘搜索框 + 搜索按钮 → 必应 RSS 10 条 → 大字双行胶囊，
 *   10 条一次入列 list 内上下滑动浏览（v3.3 分页器删除），上下渐隐帘与首页同款
 * - 摘要视图：同页 if/elif 切换展示主副标题 + 完整摘要 + 网址，带「访问/返回」
 *
 * 摘要与列表同页共存，返回列表时结果原样保留（数据在页面内存，零传递零请求）。
 * 背景知识：Lite 的 @system.storage 单值硬限制 128 字节、globalThis 不可靠，
 * 跨页存搜索结果不可行 —— 1.5.x 的「结果已失效」根因，故改为同页双视图。
 */
import Route from '../../common/route.js';
import Url from '../../common/url.js';
import Net from '../../common/net.js';
import Search from '../../common/search.js';
import Gesture from '../../common/gesture.js';
import Fade from '../../common/fade.js';
import Store from '../../common/store.js';
import Crown from '../../common/crown.js';
import Sway from '../../common/sway.js';
import Layout from '../../common/layout.js';
import Aicfg from '../../common/aicfg.js';
import Aiclient from '../../common/aiclient.js';
import Aistore from '../../common/aistore.js';
import Md from '../../common/md.js';

var READER_PAGE = 'pages/reader/reader';
var STAR_LINE = '/common/star_line.png';
var STAR_FULL = '/common/star_full.png';

var FAIL_TEXT = {
  offline: ['网络不可用', '请检查手表网络后重试'],
  timeout: ['搜索超时', '网络较慢，请重试'],
  unreachable: ['无法搜索', '请检查网络后重试'],
  unsupported: ['暂不支持', '该设备无法访问搜索服务'],
  toolarge: ['结果过大', '请换个更精确的关键词']
};

/* 摘要每行约 20 字（348px / 17px），行高 26px（长摘要由 list 原生滚动）。
   Lite 的 width/height 未设置默认 0：list-item 与 text 都必须给显式高度，
   否则条目坍缩、摘要不显示（2.3.0 真机「摘要不可用」根因）。 */
function summaryHeight(text) {
  var len = text ? String(text).length : 0;
  var lines = Math.ceil(len / 19);
  if (lines < 1) {
    lines = 1;
  }
  return lines * 26 + 8;
}

export default {
  data: {
    g: Layout.page('search'),
    isList: true,
    isDetail: false,
    fadeOpacity: 1,
    headerTitle: '网页搜索',
    query: '',
    isLoading: false,
    hasResults: false,
    isFailed: false,
    swayLeft: 10,
    failTitle: '',
    failSub: '',
    emptyTitle: '没有找到相关结果',
    items: [],
    current: { title: '', sub: '', summary: '', url: '' },
    sumHeight: 34,
    sumItemHeight: 52,
    /* 摘要页右上角网页收藏：白色镂空星 ☆ = 未收藏，实心星 ★ = 已收藏（PNG 高清图标） */
    starIcon: STAR_LINE
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('search');
      Layout.syncConfig();
    });

    this.initialized = true;
    this.searched = false;

    var params = Route.takeSync();
    this.applyParams(params);
    Route.takeAsync(function (asyncParams) {
      if (that.searched) {
        return;
      }
      that.applyParams(asyncParams);
    });
  },

  applyParams(params) {
    if (params && params.q) {
      this.doSearch(String(params.q));
    }
  },

  /* Lite input 的 change 事件：实时触发，回调参数是字符串本身 */
  onQueryChange(e) {
    var v = '';
    if (e === null || e === undefined) {
      v = '';
    } else if (typeof e === 'string') {
      v = e;
    } else if (typeof e.value === 'string') {
      v = e.value;
    } else if (typeof e.text === 'string') {
      v = e.text;
    }
    this.query = v;
  },

  onSearch() {
    /* 失焦后 change 可能晚一拍，延后读取 */
    var that = this;
    setTimeout(function () {
      that.showList();
      that.doSearch(that.query);
    }, 80);
  },

  doSearch(rawQuery) {
    var q = Url.trim(String(rawQuery || ''));
    if (!q) {
      return;
    }
    /* 网址直达（v2.5：首页地址栏功能并入搜索框）：输入像网址就直接打开，
       否则按关键词搜索（浏览器地址栏习惯）。 */
    if (Url.looksLikeUrl(q)) {
      var direct = Url.normalize(q);
      if (direct) {
        this.openPage(direct, q);
        return;
      }
    }
    this.searched = true;
    this.query = q;
    this.showList();
    this.isLoading = true;
    this.hasResults = false;
    this.isFailed = false;
    this.startSpin();

    /* 单请求取 10 条。注意不能并发多个 fetchText：common/net.js 的序号令牌
       会把前一个未完成请求的回调静默丢弃（1.5.0 卡「正在搜索」的根因）。
       v1.1.3：增强搜索开启时改用 DeepSeek Search；关闭时保留 Bing RSS。 */
    var that = this;
    Aicfg.load(function (cfg) {
      if (cfg.enabled && cfg.hasKey) {
        that.aiSearch(q, cfg.key);
      } else {
        that.bingSearch(q);
      }
    });
  },

  aiSearch(q, key) {
    var that = this;
    Aiclient.search(q, key, function (err, list) {
      if (err) {
        that.onFail('unreachable');
        return;
      }
      var items = [];
      for (var i = 0; i < list.length; i += 1) {
        var it = list[i];
        items.push({
          title: it.title || it.url,
          sub: it.siteName ? ('DeepSeek · ' + it.siteName) : 'DeepSeek',
          summary: it.summary || it.snippet || '',
          url: it.url
        });
      }
      if (items.length === 0) {
        that.stopSpin();
        that.isLoading = false;
        that.hasResults = false;
        that.isFailed = false;
        that.emptyTitle = '没有找到「' + q + '」相关结果';
        Fade.fadeIn(that);
        return;
      }
      that.showResults(items, q);
    }, { timeoutMs: Layout.net().slow ? 60000 : 30000 });
  },

  bingSearch(q) {
    var that = this;
    Net.fetchText(Search.buildUrl(q), {
      onSuccess: function (text) {
        var r = Search.parse(text);
        if (r.kind === 'error') {
          that.onFail('unreachable');
          return;
        }
        if (r.items.length === 0) {
          that.stopSpin();
          that.isLoading = false;
          that.hasResults = false;
          that.isFailed = false;
          that.emptyTitle = '没有找到「' + q + '」相关结果';
          Fade.fadeIn(that);
          return;
        }
        that.showResults(r.items, q);
      },
      onFail: function (reason) {
        that.onFail(reason);
      }
    });
  },

  showResults(items, q) {
    this.stopSpin();
    this.isLoading = false;
    this.isFailed = false;
    /* v3.3：10 条一次入列，list 原生滚动浏览（分页器删除，list 288px 高） */
    this.items = items;
    this.hasResults = items.length > 0;
    /* v1.0 修复表冠：结果列表在 hasResults=true 之后才挂载，showList() 里的
       一次性 applyLater 早已过期 → 结果到达后重新接管焦点（crown 内置多档延时重申）。 */
    this.armCrown('result');
    Fade.fadeIn(this);
  },

  onFail(reason) {
    this.stopSpin();
    var pair = FAIL_TEXT[reason] || FAIL_TEXT.unreachable;
    this.isLoading = false;
    this.hasResults = false;
    this.isFailed = true;
    this.failTitle = pair[0];
    this.failSub = pair[1];
    Fade.fadeIn(this);
  },

  /* 摆动动画：common/sway.js 余弦补间驱动（连续无跳变），搜索结束立即停止 */
  startSpin() {
    Sway.start(this);
  },

  stopSpin() {
    Sway.stop(this);
  },

  /* ------------------------- 双视图切换（同页） ------------------------- */

  showList() {
    this.isList = true;
    this.isDetail = false;
    this.headerTitle = '网页搜索';
    this.armCrown('result');
  },

  /* 点击结果控件 → 摘要视图（数据直接从页面内存取，结果列表原样保留） */
  onOpen(index) {
    var item = this.items[index];
    if (!item) {
      return;
    }
    this.current = {
      title: item.title || '',
      sub: item.sub || '',
      summary: item.summary || '',
      url: item.url || ''
    };
    /* text 高度 = 行数×26+8；list-item 高度 = 10（上边距）+ text + 8（下留白） */
    this.sumHeight = summaryHeight(this.current.summary);
    this.sumItemHeight = this.sumHeight + 18;
    this.refreshStar();
    this.isList = false;
    this.isDetail = true;
    this.headerTitle = '网页摘要';
    Fade.fadeIn(this);
    this.armCrown('sum');
  },

  /* 表冠焦点随视图切换（微信 rotateChange 同款：先全部失焦，再聚焦活跃列表） */
  armCrown(which) {
    Crown.applyLater(this, [
      ['resultList', which === 'result'],
      ['sumList', which === 'sum']
    ]);
  },

  /* 网页收藏：白色镂空星 ↔ 白色实心星（store 书签，与阅读页收藏同库） */
  refreshStar() {
    var saved = this.current && this.current.url ? Store.isBookmarked(this.current.url) : false;
    this.starIcon = saved ? STAR_FULL : STAR_LINE;
  },

  onStar() {
    if (!this.current || !this.current.url) {
      return;
    }
    var saved = Store.toggleBookmark({ url: this.current.url, title: this.current.title });
    this.starIcon = saved ? STAR_FULL : STAR_LINE;
  },

  /* 返回列表视图：结果原样保留（零请求） */
  onBackToList() {
    this.showList();
    Fade.fadeIn(this);
  },

  /* 摘要页头部返回 = 回列表；列表页头部返回 = 回首页 */
  onHdrBack() {
    if (this.isDetail) {
      this.onBackToList();
      return;
    }
    this.onBack();
  },

  /* 访问：跳阅读页打开网址 */
  /* v1.1.3 增强模式预抓：开启增强搜索时用 DeepSeek Fetch 取纯文本→aistore→
     阅读页按 aiKey 读取；关闭时走标准 HTML 解析（reader 不引入 AI 模块以控体积）。 */
  openPage(url, title) {
    var that = this;
    Aicfg.load(function (cfg) {
      if (!(cfg.enabled && cfg.hasKey)) {
        Route.go(READER_PAGE, { url: url });
        return;
      }
      that.isLoading = true;
      that.isFailed = false;
      that.startSpin();
      Aiclient.fetchPage(url, cfg.key, function (err, page) {
        that.stopSpin();
        that.isLoading = false;
        if (err) {
          that.onFail('unreachable');
          return;
        }
        var text = Md.toText(page.content || '');
        if (!text || text.length < 20) {
          that.onFail('unreachable');
          return;
        }
        var max = Layout.net().maxText + (Layout.isRound() ? 2000 : 4000);
        var truncated = false;
        if (text.length > max) {
          text = text.substring(0, max);
          truncated = true;
        }
        Aistore.save(url, text, function (ok) {
          if (!ok) {
            that.onFail('unreachable');
            return;
          }
          Route.go(READER_PAGE, {
            url: url,
            title: page.title || title || url,
            aiKey: Aistore.keyOf(url),
            aiTruncated: truncated ? 1 : 0
          });
        });
      }, { timeoutMs: Layout.net().slow ? 90000 : 60000 });
    });
  },

  onVisit() {
    if (!this.current.url) {
      return;
    }
    this.openPage(this.current.url, this.current.title);
  },

  onBack() {
    Route.goHome();
  },

  /* 全局手势：右滑返回（摘要视图回列表，列表视图回首页） */
  onSwipe(event) {
    if (Gesture.swipeDir(event) === 'right') {
      this.onHdrBack();
    }
  },

  onTouchStart(event) {
    Gesture.remember(this, event);
  },

  onTouchEnd(event) {
    if (Gesture.take(this, event) === 'right') {
      this.onHdrBack();
    }
  },

  /* v1.0：回到本页时按当前视图重申表冠焦点（结果列表 / 摘要列表） */
  onShow() {
    if (this.isDetail) {
      this.armCrown('sum');
      return;
    }
    if (this.hasResults) {
      this.armCrown('result');
    }
  },

  onHide() {
    Crown.cancel(this);
    Crown.apply(this, [['resultList', false], ['sumList', false]]);
  },

  onDestroy() {
    this.stopSpin();
    Crown.cancel(this);
    Crown.apply(this, [['resultList', false], ['sumList', false]]);
    Fade.cancel(this);
  }
};
