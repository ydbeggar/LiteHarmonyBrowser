/**
 * RSS 新闻阅读器（v1.1.2，方屏/圆屏共用业务逻辑）。
 *
 * 三种视图：
 * - 列表：当前频道的新闻条目（最多 20 条，list 内滚动）
 * - 频道：5 个公共 RSS 源选择
 * - 详情：标题 / 来源日期 / 正文段落 / 阅读原文
 *
 * 依赖纯函数 common/rss.js；网络走 common/net.js 的 fetchText（串行令牌）。
 */
import storage from '@system.storage';
import Route from '../../common/route.js';
import Net from '../../common/net.js';
import Layout from '../../common/layout.js';
import Rss from '../../common/rss.js';
import Rsscfg from '../../common/rsscfg.js';
import Gesture from '../../common/gesture.js';
import Crown from '../../common/crown.js';

var READER_PAGE = 'pages/reader/reader';
var KEY_SOURCE = 'lwb_rss_src';

var FAIL_TEXT = {
  offline: ['网络不可用', '请检查手表网络后重试'],
  timeout: ['加载超时', 'RSS 源响应过慢，请重试'],
  unreachable: ['无法连接', '该 RSS 源暂时不可用'],
  unsupported: ['暂不支持', '该设备无法访问网络'],
  'http-404': ['源不存在', '该 RSS 地址返回 404'],
  'http-410': ['源已失效', '该 RSS 地址已停止提供'],
  'http-500': ['源服务器错误', '请稍后重试']
};

function failText(reason) {
  var item = FAIL_TEXT[reason];
  return item || ['加载失败', '请点刷新重试'];
}

function clampText(s, max) {
  var v = s === null || s === undefined ? '' : String(s);
  return v.length > max ? v.substring(0, max) : v;
}

export default {
  data: {
    g: Layout.page('rss'),
    isList: true,
    isChannels: false,
    isDetail: false,
    isLoading: false,
    isFailed: false,
    hasItems: false,
    failTitle: '',
    failSub: '',
    headerTitle: 'RSS 新闻',
    sourceIndex: 0,
    sourceName: '少数派',
    sourceList: Rsscfg.sources,
    items: [],
    current: { title: '', meta: '', content: '', url: '' },
    paragraphs: [],
    chunkH: 0,
    fadeOpacity: 1
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('rss');
      that.applySource(function () {
        that.loadSource();
      });
    });
    this.loaded = false;
    Crown.cancel(this);
  },

  onShow() {
    Crown.apply(this, [['feedList', this.isList]]);
  },

  onDestroy() {
    /* 离开页面时取消 RSS 请求的序号，防止旧回调覆盖新页面 */
    Net.cancel();
  },

  applySource(cb) {
    var that = this;
    var done = false;
    var timer = 0;
    function finish(value) {
      if (done) { return; }
      done = true;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      var n = Math.floor(Number(value));
      if (isNaN(n) || n < 0 || n >= Rsscfg.sources.length) {
        n = Rsscfg.DEFAULT_INDEX;
      }
      that.sourceIndex = n;
      that.sourceName = Rsscfg.sources[n].name;
      if (typeof cb === 'function') { cb(); }
    }
    /* storage 回调丢失时按默认源继续，不让页面停在空白列表。 */
    timer = setTimeout(function () { finish(''); }, 800);
    try {
      storage.get({
        key: KEY_SOURCE,
        default: '',
        success: function (value) { finish(value); },
        fail: function () { finish(''); }
      });
    } catch (err) {
      finish('');
    }
  },

  saveSource(index) {
    try {
      storage.set({ key: KEY_SOURCE, value: String(index) });
    } catch (err) {
      /* 源选择失败不影响本次阅读 */
    }
  },

  loadSource() {
    var that = this;
    var source = Rsscfg.sources[this.sourceIndex] || Rsscfg.sources[0];
    this.sourceName = source.name;
    this.isList = true;
    this.isChannels = false;
    this.isDetail = false;
    this.isLoading = true;
    this.isFailed = false;
    this.hasItems = false;
    this.items = [];
    this.failTitle = '';
    this.failSub = '';
    Net.fetchText(source.url, {
      onSuccess: function (text) {
        that.onFeed(text);
      },
      onFail: function (reason) {
        that.onFail(reason);
      }
    }, {
      maxChars: 60000,
      maxBytes: 65536,
      timeoutMs: Layout.net().timeoutMs
    });
  },

  onFeed(text) {
    var feed = Rss.parse(text, this.sourceName);
    if (!feed || !feed.items || feed.items.length < 1) {
      this.isLoading = false;
      this.isFailed = true;
      var ft = ['该源暂无内容', '可以换一个频道或稍后刷新'];
      this.failTitle = ft[0];
      this.failSub = ft[1];
      return;
    }
    var items = [];
    for (var i = 0; i < feed.items.length; i += 1) {
      var it = feed.items[i];
      var meta = this.sourceName;
      if (it.date) {
        meta += ' · ' + it.date;
      }
      var summary = it.summary || it.content || '';
      items.push({
        title: clampText(it.title, 60),
        meta: clampText(meta, 32),
        summary: clampText(summary, 100),
        content: it.content || it.summary || '',
        url: it.link || ''
      });
    }
    this.items = items;
    this.isLoading = false;
    this.isFailed = false;
    this.hasItems = true;
    Crown.applyLater(this, [['feedList', true]]);
  },

  onFail(reason) {
    var ft = failText(reason);
    this.isLoading = false;
    this.isFailed = true;
    this.hasItems = false;
    this.failTitle = ft[0];
    this.failSub = ft[1];
  },

  onRefresh() {
    this.loadSource();
  },

  onOpenChannel() {
    this.isChannels = true;
    this.isList = false;
    this.isDetail = false;
    Crown.applyLater(this, [['channelList', true]]);
  },

  onPickChannel(index) {
    if (index < 0 || index >= Rsscfg.sources.length) {
      return;
    }
    this.sourceIndex = index;
    this.sourceName = Rsscfg.sources[index].name;
    this.saveSource(index);
    this.loadSource();
  },

  onOpen(index) {
    if (!this.items || index < 0 || index >= this.items.length) {
      return;
    }
    var it = this.items[index];
    var content = it.content || it.summary || '';
    this.current = {
      title: it.title,
      meta: it.meta,
      content: content,
      url: it.url
    };
    this.paragraphs = this.buildParagraphs(content);
    this.isDetail = true;
    this.isList = false;
    this.isChannels = false;
    Crown.applyLater(this, [['detailList', true]]);
  },

  buildParagraphs(text) {
    var s = String(text || '');
    var lines = s.split('\n');
    var out = [];
    var charsPerLine = this.g && this.g.round ? 18 : 21;
    var total = 0;
    for (var i = 0; i < lines.length; i += 1) {
      var t = String(lines[i] || '').trim();
      if (!t) { continue; }
      t = clampText(t, 1200);
      var h = Math.ceil(t.length / charsPerLine) * 26 + 10;
      if (h < 36) { h = 36; }
      out.push({ text: t, h: h });
      total += h;
      if (out.length >= 60 || total > 3600) { break; }
    }
    if (out.length < 1) {
      out.push({ text: '（无正文摘要，请阅读原文）', h: 40 });
    }
    return out;
  },

  onBack() {
    Net.cancel();
    if (this.isDetail) {
      this.isDetail = false;
      this.isList = true;
      Crown.applyLater(this, [['feedList', true]]);
      return;
    }
    if (this.isChannels) {
      this.isChannels = false;
      this.isList = true;
      Crown.applyLater(this, [['feedList', true]]);
      return;
    }
    Route.goHome();
  },

  onReadOriginal() {
    if (this.current && this.current.url) {
      Route.go(READER_PAGE, { url: this.current.url });
    }
  },

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
