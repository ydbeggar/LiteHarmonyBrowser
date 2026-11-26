/**
 * 增强搜索（v1.1.2，DeepSeek Search / Fetch）。
 *
 * 流程：
 * - 首次进入：API Key 设置视图（Key 持久保存在 @system.storage）
 * - 已启用：输入网址 → Fetch 抓正文；输入关键词 → Search 搜结果
 * - 抓取成功后写入 AiStore 临时分片，阅读页按本地纯文本渲染
 *
 * 方屏/圆屏共用本文件；圆屏页只 re-export。
 */
import Route from '../../common/route.js';
import Layout from '../../common/layout.js';
import Net from '../../common/net.js';
import Aicfg from '../../common/aicfg.js';
import Aiclient from '../../common/aiclient.js';
import Aistore from '../../common/aistore.js';
import Md from '../../common/md.js';
import Gesture from '../../common/gesture.js';
import Crown from '../../common/crown.js';
import Search from '../../common/search.js';

var READER_PAGE = 'pages/reader/reader';
/* v1.1.3：DeepSeek Fetch 正常启用。真机崩溃根因是本地文件写入（Aistore 旧分片
   17 次调用），已改单文件（2 次调用），非 fetch 本身问题。 */

function clampText(s, max) {
  var v = s === null || s === undefined ? '' : String(s);
  return v.length > max ? v.substring(0, max) : v;
}

export default {
  data: {
    g: Layout.page('ai'),
    isSetup: true,
    isSearch: false,
    isLoading: false,
    hasResults: false,
    isFailed: false,
    keyConfigured: false,
    keyMasked: '未设置',
    items: [],
    failTitle: '',
    failSub: '',
    loadingText: '',
    waitText: '',
    currentUrl: '',
    fadeOpacity: 1
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('ai');
      that.applyConfig();
    });
    this.waitTimer = 0;
    this.waitSec = 0;
    this.maxText = 12000;
    /* v1.1.3：输入框值存非响应式属性，避免每次按键触发 setData（GT6 输入法内存尖峰崩溃） */
    this._keyInput = '';
    this._query = '';
  },

  onShow() {
    Crown.apply(this, [['aiList', this.hasResults]]);
  },

  onDestroy() {
    this.stopWait();
    /* 离开页面时让在飞的 Search/Fetch 回调失效，避免返回首页后突然跳阅读页 */
    Net.cancel();
  },

  applyConfig() {
    var that = this;
    Aicfg.load(function (cfg) {
      that._key = cfg.key || '';
      that.keyConfigured = cfg.hasKey;
      that.keyMasked = Aicfg.mask(cfg.key);
      that.isSetup = !cfg.enabled;
      that.isSearch = cfg.enabled;
      that.isLoading = false;
      that.isFailed = false;
      /* v1.1.3 内存收紧：AI 正文上限与普通阅读一致（去掉额外余量），
         降低 fetch/存储/显示的峰值内存 */
      that.maxText = Layout.net().maxText;
    });
  },

  onKeyChange(e) {
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
    this._keyInput = v;
  },

  onSaveKey() {
    var key = String(this._keyInput || '').trim();
    if (!key) {
      /* v1.1.3 修复：空输入不清空已保存的 Key，仅返回搜索界面 */
      if (this.keyConfigured) {
        this.isSetup = false;
        this.isSearch = true;
        this.isFailed = false;
        return;
      }
      this.failTitle = '请输入 API Key';
      this.failSub = 'Key 只保存在手表本地';
      this.isFailed = true;
      return;
    }
    var that = this;
    Aicfg.saveKey(key, function (ok, reason, finalKey) {
      if (!ok) {
        that.failTitle = '保存失败';
        that.failSub = reason || '请重试';
        that.isFailed = true;
        return;
      }
      that._key = finalKey || Aicfg.normalizeKey(key);
      that.keyConfigured = true;
      that.keyMasked = Aicfg.mask(that._key);
      that._keyInput = '';
      that.isSetup = false;
      that.isSearch = true;
      that.isFailed = false;
      that.maxText = Layout.net().maxText;
    });
  },

  /* v1.1.3 修复：进入 Key 设置界面但不清空已保存的 Key */
  onOpenKeySetup() {
    var that = this;
    Aicfg.load(function (cfg) {
      that._key = cfg.key || '';
      that.keyConfigured = cfg.hasKey;
      that.keyMasked = Aicfg.mask(cfg.key);
      that._keyInput = '';
      that.isFailed = false;
      that.isSetup = true;
      that.isSearch = false;
    });
  },

  onClearKey() {
    var that = this;
    Aicfg.clear(function () {
      /* 清除自填 Key 后回退默认 Key，刷新界面（默认仍可用） */
      that.hasResults = false;
      that.items = [];
      that.isFailed = false;
      that.applyConfig();
    });
  },

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
    this._query = v;
  },

  onReadUrl() {
    var that = this;
    setTimeout(function () {
      var q = String(that._query || '').trim();
      if (!q) {
        that.showFail('请输入网址', '网址以 http(s):// 开头');
        return;
      }
      /* 「搜网页」：DeepSeek Fetch 拉取网页正文（存储已改单文件，调用次数已控） */
      var url = q;
      if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) {
        url = 'https://' + url;
      }
      that.fetchPage(url);
    }, 80);
  },

  onSearch() {
    var that = this;
    setTimeout(function () {
      var q = String(that._query || '').trim();
      if (!q) {
        that.showFail('请输入关键词', '例如：鸿蒙开发');
        return;
      }
      that.search(q);
    }, 80);
  },

  search(q) {
    var that = this;
    this.isLoading = true;
    this.hasResults = false;
    this.isFailed = false;
    this.loadingText = '正在搜索…';
    this.startWait();
    /* 「搜索」：用 Bing RSS 返回结果（同主页网页搜索）；打开结果时才走 DeepSeek Fetch */
    Net.fetchText(Search.buildUrl(q), {
      onSuccess: function (text) {
        that.stopWait();
        that.isLoading = false;
        var r = Search.parse(text);
        if (r.kind === 'error' || !r.items || r.items.length < 1) {
          that.showFail('没有找到相关结果', '换个关键词试试');
          return;
        }
        var items = [];
        for (var i = 0; i < r.items.length; i += 1) {
          var it = r.items[i];
          items.push({
            title: it.title || it.url,
            siteName: it.sub || '',
            date: '',
            snippet: it.summary || it.sub || '',
            url: it.url || ''
          });
        }
        that.items = items;
        that.hasResults = true;
        that.isFailed = false;
        Crown.applyLater(that, [['aiList', true]]);
      },
      onFail: function (reason) {
        that.stopWait();
        that.isLoading = false;
        that.showFail('搜索失败', reason === 'timeout' ? '网络超时' : '无法连接搜索服务');
      }
    }, { maxChars: 15000 });
  },

  fetchPage(url) {
    var that = this;
    this.isLoading = true;
    this.hasResults = false;
    this.isFailed = false;
    this.currentUrl = url;
    this.loadingText = 'DeepSeek 正在抓取网页…';
    this.startWait();
    Aiclient.fetchPage(url, this.getKey(), function (err, page) {
      that.stopWait();
      if (err) {
        that.isLoading = false;
        that.showFail('读取失败', err);
        return;
      }
      var text = Md.toText(page.content || '');
      if (!text || text.length < 20) {
        that.isLoading = false;
        that.showFail('没有可读正文', '该页面可能是图片、视频或需要登录');
        return;
      }
      var truncated = false;
      if (text.length > that.maxText) {
        text = text.substring(0, that.maxText);
        truncated = true;
      }
      Aistore.save(url, text, function (ok) {
        that.isLoading = false;
        if (!ok) {
          that.showFail('保存失败', '手表存储空间不足或文件服务异常');
          return;
        }
        Route.go(READER_PAGE, {
          url: url,
          title: page.title || url,
          aiKey: Aistore.keyOf(url),
          aiTruncated: truncated ? 1 : 0
        });
      });
    }, { maxContent: this.maxText, timeoutMs: Layout.net().slow ? 90000 : 60000 });
  },

  getKey() {
    return this._key || '';
  },

  showFail(title, sub) {
    this.isLoading = false;
    this.hasResults = false;
    this.isFailed = true;
    this.failTitle = title || '操作失败';
    this.failSub = sub || '';
    Crown.applyLater(this, [['aiList', false]]);
  },

  onRetry() {
    this.isFailed = false;
    this.isSearch = true;
  },

  onFallbackRead() {
    if (this.currentUrl) {
      Route.go(READER_PAGE, { url: this.currentUrl });
    }
  },

  onOpen(index) {
    if (!this.items || index < 0 || index >= this.items.length) {
      return;
    }
    var item = this.items[index];
    if (item && item.url) {
      this.fetchPage(item.url);
    }
  },

  onBack() {
    this.stopWait();
    Net.cancel();
    if (this.isSetup) {
      Route.goHome();
      return;
    }
    if (this.hasResults) {
      this.hasResults = false;
      this.isFailed = false;
      return;
    }
    Route.goHome();
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
  },

  startWait() {
    var that = this;
    this.stopWait();
    this.waitSec = 0;
    this.waitText = '0 秒';
    this.waitTimer = setInterval(function () {
      that.waitSec += 1;
      that.waitText = that.waitSec + ' 秒';
      if (that.waitSec >= 90) {
        that.stopWait();
      }
    }, 1000);
  },

  stopWait() {
    if (this.waitTimer) {
      clearInterval(this.waitTimer);
      this.waitTimer = 0;
    }
  }
};
