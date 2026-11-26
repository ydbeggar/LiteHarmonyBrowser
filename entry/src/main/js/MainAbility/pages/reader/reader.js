import Route from '../../common/route.js';
import prompt from '@system.prompt';
import Config from '../../common/config.js';
import Layout from '../../common/layout.js';
import Url from '../../common/url.js';
import Html from '../../common/html.js';
import Paginate from '../../common/paginate.js';
import PageSink from '../../common/pagesink.js';
import Net from '../../common/net.js';
import Store from '../../common/store.js';
import Session from '../../common/session.js';
import Gesture from '../../common/gesture.js';
import Saved from '../../common/saved.js';
import Navrule from '../../common/navrule.js';
import Linkpass from '../../common/linkpass.js';
import Screen from '../../common/screen.js';
import Crown from '../../common/crown.js';
import Sway from '../../common/sway.js';
import PageStore from '../../common/pagestore.js';
import Sched from '../../common/scheduler.js';
import Aistore from '../../common/aistore.js';

var READER_PAGE = 'pages/reader/reader';
var TXT_SAVE = '收藏';
var TXT_SAVED = '已收藏';
var TXT_SAVE_FAIL = '保存失败';
var TXT_SAVED_OK = '已加入书签';
var TXT_REMOVED_OK = '已取消收藏';
var LINKS_PAGE = 'pages/links/links';
var SETTINGS_PAGE = 'pages/settings/settings';
/* 收藏星标（白色镂空/实心 PNG）：@system.prompt 之外的可见反馈体系 */
var STAR_LINE = '/common/star_line.png';
var STAR_FULL = '/common/star_full.png';

var FAIL_TEXT = {
  offline: ['网络不可用', '请检查手表网络后重试'],
  timeout: ['加载超时', '服务器响应过慢，请重试'],
  unreachable: ['目标不可达', '无法连接到该网站，请检查地址'],
  unsupported: ['暂不支持该类型内容', '该地址返回的内容无法解析为可读正文'],
  toolarge: ['页面内容过大', '该页面超出手表处理能力，请换更轻量的站点'],
  toc: ['无法打开整本目录', '目录页数百 KB 超出内存，请用阅读页「目录」按钮浏览章节'],
  'offline-miss': ['离线内容已失效', '请返回离线列表并重新保存该网页'],
  'ai-miss': ['AI 正文已失效', '请返回增强搜索重新抓取该网页']
};

function toast(message) {
  try {
    prompt.showToast({ message: message, duration: 1600 });
  } catch (err) {
    /* a toast must never break reading */
  }
}

export default {
  data: {
    g: Layout.page('reader'),
    title: '轻鸿浏览器',
    pageText: '',
    pageTextA: '',
    pageTextB: '',
    layerB: false,
    swayLeft: 10,
    pageLabel: '',
    loadingUrl: '',
    failTitle: '',
    failSub: '',
    isLoading: true,
    isOk: false,
    isEmpty: false,
    isFailed: false,
    showStart: false,
    panelOpen: false,
    fadeOpacity: 1,
    starIcon: '/common/star_line.png',
    fontSizePx: 18,
    lineHeightPx: 30,
    saveLabel: '收藏',
    isSaved: false,
    hasNext: false,
    hasPrev: false,
    showNav: false,
    /* 离线保存进度（操作页「保存离线」行内进度条，@system.prompt 在 FIT5 Pro 不存在，
       toast 不可见，保存进度与结果必须在界面里直接可见） */
    saveOffLabel: '保存离线',
    saveOffColor: '#FFFFFF',
    saveTrackBg: '#1C1C1E',
    saveBarW: 0,
    /* 加载进度（v3.8）：@system.fetch 无传输进度事件——按等待时间给渐进估值
       （爬升至 95%）+ 真实已等待秒数，到手即结束；用户不再面对"黑盒等待" */
    loadBarW: 0,
    loadLabel: ''
  },

  onInit() {
    var prefs = Store.loadPrefs();
    this.applyLayout(prefs);
    /* 屏幕常亮保险重申（v3.7）：加载大站时息屏→切后台→进程被回收是崩溃
       报告的混杂因素；阅读页每次进入都确认一次（幂等，开销一次原生调用） */
    Screen.apply(prefs.keepScreenOn !== false);
    this.url = '';
    this.starts = null;
    this.pageCount = 1;
    this.pageIndex = 0;
    this.restoreOffset = 0;
    this.initialized = false;
    Store.setWriteErrorHandler(function () {
      toast(TXT_SAVE_FAIL);
    });

    var that = this;
    Layout.init(function () {
      that.g = Layout.page('reader');
      Layout.syncConfig();
      that.applyLayout(Store.loadPrefs());
      that.resolveTarget();
      that.initialized = true;
    });

    Store.init(function () {
      if (!that.initialized) {
        return;
      }
      var saved = Store.loadPrefs();
      /* 加载中不重渲染：setData 会打断 CSS 旋转动画（真机 1 秒即停的根因之一） */
      if (that.isLoading) {
        return;
      }
      if (saved.fontSize === that.fontSizeValue && saved.lineHeight === that.lineHeightValue) {
        return;
      }
      if (that.url) {
        that.refreshSaved(that.url);
      }
      if (that.isOk) {
        that.repaginate(saved);
      } else {
        that.applyLayout(saved);
      }
    });
  },

  onShow() {
    if (!this.initialized) {
      return;
    }
    var prefs = Store.loadPrefs();
    var changed =
      prefs.fontSize !== this.fontSizeValue ||
      prefs.lineHeight !== this.lineHeightValue;
    if (changed) {
      if (this.isOk) {
        this.repaginate(prefs);
      } else {
        this.applyLayout(prefs);
      }
      return;
    }
    if (this.url && this.isOk) {
      var frame = Session.getFrame(this.url);
      if (frame && !frame.doc) {
        this.restore();
      } else if (frame && frame.pageIndex !== this.pageIndex) {
        this.renderAt(frame.pageIndex);
      }
    }
    /* v1.0：操作页仍打开时回到本页，重申工具列表的表冠焦点 */
    if (this.panelOpen) {
      Crown.applyLater(this, [['toolList', true]]);
    }
  },

  onHide() {
    this.persistPosition();
    Crown.cancel(this);
    Crown.apply(this, [['toolList', false]]);
  },

  onDestroy() {
    this.stopSpinner();
    this.stopLoadMeter();
    if (this.saveResetTimer) {
      clearTimeout(this.saveResetTimer);
      this.saveResetTimer = 0;
    }
    Crown.cancel(this);
    Crown.apply(this, [['toolList', false]]);
    this.saveBusy = false;
    this.persistPosition();
    /* v3.9 销毁即释放：框架对旧页 VM 可能延迟回收，正文三缓冲/分页面逐章
       累积会把堆拖到崩溃边缘（第五章加载崩的累积面）；文档驻留一并清空
       （新页按需重抓，renderAt 有自愈降级）。 */
    this.pageText = '';
    this.pageTextA = '';
    this.pageTextB = '';
    this.starts = null;
    Session.dropDocs();
  },

  /* ------------------------------- loading ------------------------------- */

  resolveTarget() {
    if (this.targetResolved) {
      return;
    }
    var params = Route.takeSync();
    if (params) {
      this.targetResolved = true;
      this.applyTarget(params);
      return;
    }
    var that = this;
    Route.takeAsync(function (asyncParams) {
      if (that.targetResolved) {
        return;
      }
      that.targetResolved = true;
      that.applyTarget(asyncParams);
    });
  },

  applyTarget(params) {
    if (params && params.aiKey) {
      this.openAiText(
        String(params.url || ''),
        String(params.title || ''),
        Number(params.aiTruncated) === 1
      );
      return;
    }
    if (params && params.offline) {
      this.openOffline(
        params.key ? String(params.key) : '',
        params.title ? String(params.title) : '',
        params.parts ? Number(params.parts) : 0
      );
      return;
    }
    var url = params && params.url ? String(params.url) : '';
    if (url) {
      var frame = Session.getFrame(url);
      if (frame && frame.doc) {
        this.install(frame.doc, frame.pageIndex, 0);
        return;
      }
      this.fetch(url, 0);
      return;
    }
    var current = Session.getCurrent();
    if (current && current.doc) {
      this.install(current.doc, current.pageIndex, 0);
    } else if (current && current.url) {
      this.fetch(current.url, current.pageIndex);
    } else {
      this.url = '';
      this.isLoading = false;
      this.isOk = false;
      this.isEmpty = false;
      this.isFailed = true;
      this.failTitle = '未指定网址';
      this.failSub = '请返回首页输入网址，或点内置测试站';
    }
  },

  fetch(url, offset) {
    var that = this;
    this.url = url;
    Route.setCurrent(url);
    this.restoreOffset = offset || 0;
    this.title = Url.displayOf(url);
    this.loadingUrl = Url.displayOf(url);
    this.pageText = '';
    this.pageLabel = '';
    this.isLoading = true;
    this.isOk = false;
    this.isEmpty = false;
    this.isFailed = false;
    this.startSpinner();
    this.startLoadMeter();

    /* v3.10 整本目录页防护：/chapter/<书号> 等目录型地址常把数百章内联在一页
       （创世实测 419KB / 853 链接）。该站无视 Range、HEAD 预检 500 拒绝，
       响应必然整包序列化进 698KB 堆 → 必崩且 JS 侧无法提前截断。
       直接给可读失败态（不发请求），章节列表请用阅读页「目录」按钮。 */
    if (Url.looksLikeToc(url)) {
      this.onFail('toc');
      return;
    }

    /* v3.3 网页缓存功能整体删除（用户决策：实际作用感知不大）：
       同一网页不再有本地快路径，直接走网络。删除同时根除 v3.1 起的
       「写分片与翻页区间读同批文件」竞态/锁悬挂崩溃类，
       阅读与翻页热路径不再触碰 @system.file。
       v3.5 堆峰值治理（创世中文网 ch3 加载崩溃）：开抓前清空旧文档驻留，
       响应上限收紧到解析窗口，加载峰值独占堆空间。 */
    Session.dropDocs();
    this.netFetch(url);
  },

  netFetch(url) {
    Layout.syncConfig();
    var that = this;
    /* 响应上限 = 当前屏幕/性能档位的解析窗口（Layout.net().maxHtml）：
       解析器本来就只消费前 48K 字符，大站 100K+ 字符的响应多出来的部分是
       纯堆负担（创世 115K 响应里正文只占前 31K）。截断后瞬时峰值从 ~240K
       降到 ~125K，顺带省一半传输；圆屏/老机型会进一步收紧。 */
    Net.fetchText(url, {
      onSuccess: function (text) {
        that.onBody(text);
      },
      onFail: function (reason) {
        that.onFail(reason);
      }
    }, { maxChars: Layout.net().parseWindowChars });
  },

  onBody(text) {
    this.stopSpinner();
    this.stopLoadMeter();
    var url = this.url;
    /* P2：单遍流式分页。解析边喂 sink，正文只保留一份；不再 chunks→join→stripNoise
       之后再 Paginate.paginate 扫第二遍。布局必须在 parse 前确定（install 里还会再
       apply 一次，但那时 starts 已由同一个布局算出）。
       v1.1.1：受限设备（圆屏 / API<24）回退 v1.0.7 的整串 parse + Paginate 路径，
       避免 PageSink 在低堆/老固件上的兼容问题；全功能档位才用流式 sink。 */
    this.applyLayout(Store.loadPrefs());
    var doc;
    if (this.isFullMode()) {
      var sink = PageSink.create(this.layout, {
        maxText: Config.MAX_TEXT_CHARS,
        keepText: true
      });
      doc = Html.parse(text, url, { sink: sink });
    } else {
      doc = Html.parse(text, url);
    }
    text = null;
    if (doc.kind === 'unsupported') {
      this.onFail('unsupported');
      return;
    }
    doc.url = url;
    doc.status = 'ok';
    doc.failReason = '';
    doc.fetchedAt = Date.now();
    if (doc.text.length < Config.MIN_TEXT_CHARS) {
      Session.open(doc, 0);
      this.isLoading = false;
      this.isOk = false;
      this.isEmpty = true;
      this.isFailed = false;
      this.pageText = '';
      this.pageLabel = '0 / 0';
      this.title = Url.displayOf(url);
      this.refreshSaved(url);
      return;
    }
    this.install(doc, 0, this.restoreOffset);
  },

  /**
   * 是否全功能档位（允许 P3 磁盘分页 / 并发文件调用）。
   * 判定只用屏幕形态 + API：圆屏=GT 系列、API<24=FIT4 等老机型 → 受限。
   * forceFull（关于页「强开完整模式」）可强制覆盖。
   */
  isFullMode() {
    if (Store.loadPrefs().forceFull) {
      return true;
    }
    var p = Layout.get();
    if (p.round) {
      return false;
    }
    if (p.apiVersion <= 0 || p.apiVersion < 24) {
      return false;
    }
    return true;
  },

  install(doc, pageIndex, offset) {
    var that = this;
    var prefs = Store.loadPrefs();
    this.applyLayout(prefs);
    this.url = doc.url;
    Route.setCurrent(doc.url);
    this.title = doc.title;

    /* 连续阅读：记录站点自带的上一页/下一页入口 */
    this.nextHref = doc.nextHref || '';
    this.prevHref = doc.prevHref || '';
    this.hasNext = this.nextHref.length > 0;
    this.hasPrev = this.prevHref.length > 0;

    /* 电子书站书名/目录页：识别「开始阅读」与「第x章」目录，给直达控件。
       判定：有「开始阅读」链接，或章节链接 ≥3 条且正文很短（书名页/目录页）。 */
    this.startHref = doc.startHref || '';
    this.chapters = doc.chapters || [];
    this.showStart = !!this.startHref ||
      (this.chapters.length >= 3 && doc.text.length < 1000);

    var result;
    if (doc.starts && doc.starts.length > 0) {
      /* P2：解析阶段已由 pagesink 产出页起点，直接复用，省掉第二次全文扫描 */
      result = { starts: doc.starts, pageCount: doc.pageCount || doc.starts.length };
    } else {
      result = Paginate.paginate(doc.text, this.layout);
    }
    this.starts = result.starts;
    this.pageCount = result.pageCount;

    Session.open(doc, 0);
    Store.addHistory({ url: doc.url, title: doc.title });
    this.refreshSaved(doc.url);

    this.isLoading = false;
    this.isOk = true;
    this.isEmpty = false;
    this.isFailed = false;

    var target = offset > 0 ? Paginate.findPageByOffset(this.starts, offset) : pageIndex || 0;
    this.restoreOffset = 0;
    this.renderAt(target);

    /* PUA 字体加密检测（番茄小说等反爬站）：正文可能是密文 */
    if (doc.puaEncrypted) {
      toast('该站使用字体加密，正文可能显示异常');
    }

    /* P3：首帧后异步落盘章文件（仅全功能档位；受限设备保持 v1.0.7 纯内存读写）。
       v1.1.1：受限设备（圆屏 / API<24）不落盘、不读盘，避免文件服务大面积崩溃；
       强开完整模式（forceFull）可覆盖。 */
    this.isDisk = false;
    if (!doc.ai && this.isFullMode() && doc.text && doc.text.length > 2000 && this.starts && this.starts.length > 1) {
      var saveUrl = doc.url;
      var saveText = doc.text;
      var saveStarts = this.starts;
      Sched.scheduleFileOp(function () {
        PageStore.save(saveUrl, saveText, saveStarts, function (ok) {
          if (ok) {
            that.isDisk = true;
          }
        });
      });
    }

    if (doc.truncated) {
      toast('内容过长，仅展示前 ' + Config.MAX_TEXT_CHARS + ' 字');
    }
  },

  onFail(reason) {
    this.stopSpinner();
    this.stopLoadMeter();
    var pair = FAIL_TEXT[reason] || FAIL_TEXT.unreachable;
    this.failTitle = pair[0];
    if (reason === 'timeout') {
      this.failSub = '网络较慢，已等待 ' + Math.round(Layout.net().timeoutMs / 1000) + ' 秒，请重试';
    } else {
      this.failSub = pair[1];
    }
    this.isLoading = false;
    this.isOk = false;
    this.isEmpty = false;
    this.isFailed = true;
    this.pageText = '';
  },

  restore() {
    if (!this.url) {
      return;
    }
    var offset = this.restoreOffset;
    if (this.starts && this.pageIndex < this.starts.length) {
      offset = this.starts[this.pageIndex];
    }
    this.fetch(this.url, offset);
  },

  /* -------------------------------- render ------------------------------- */

  renderAt(index) {
    var doc = Session.getDoc(this.url);
    if (!doc) {
      this.restore();
      return;
    }
    var i = index;
    if (isNaN(i) || i < 0) {
      i = 0;
    }
    if (i > this.pageCount - 1) {
      i = this.pageCount - 1;
    }
    this.pageIndex = i;

    /* P3 磁盘翻页：落盘成功后走 PageStore 读页，省掉 doc.text 的 substring 副本。
       失败回退纯内存切片（Paginate.pageText）。 */
    if (this.isDisk && doc.text && doc.text.length > 2000) {
      var that = this;
      var pageKey = PageStore.keyOf(this.url);
      PageStore.loadPage(pageKey, i, function (chunk) {
        if (chunk && chunk.length > 0) {
          that.paintPage(chunk, i);
        } else {
          /* 磁盘读失败：回退内存 */
          that.isDisk = false;
          that.paintPage(Paginate.pageText(doc.text, that.starts, i), i);
        }
      });
      return;
    }

    /* 纯内存模式：直接切片 */
    var chunk = Paginate.pageText(doc.text, this.starts, i);
    this.paintPage(chunk, i);
  },

  /** 渲染一页文本（双缓冲 + 页码 + 导航行）。 */
  paintPage(chunk, i) {
    if (this.layerB) {
      this.pageTextA = chunk;
      this.layerB = false;
    } else {
      this.pageTextB = chunk;
      this.layerB = true;
    }
    this.pageText = chunk;
    this.pageLabel = String(i + 1) + ' / ' + String(this.pageCount);
    this.showNav = (this.hasNext || this.hasPrev) && i >= this.pageCount - 1;
    Session.setPage(this.url, i);
  },

  repaginate(prefs) {
    var doc = Session.getDoc(this.url);
    if (!doc) {
      this.restore();
      return;
    }
    var offset = 0;
    if (this.starts && this.pageIndex < this.starts.length) {
      offset = this.starts[this.pageIndex];
    }
    this.applyLayout(prefs);
    var result = Paginate.paginate(doc.text, this.layout);
    this.starts = result.starts;
    this.pageCount = result.pageCount;
    this.isOk = true;
    this.isLoading = false;
    this.isEmpty = false;
    this.isFailed = false;
    this.renderAt(Paginate.findPageByOffset(result.starts, offset));
  },

  persistPosition() {
    if (this.url) {
      Session.setPage(this.url, this.pageIndex);
    }
  },

  /* 摆动动画：common/sway.js 余弦补间驱动（连续无跳变），加载结束立即停止 */
  startSpinner() {
    Sway.start(this);
  },

  stopSpinner() {
    Sway.stop(this);
  },

  /* 加载进度仪表（v3.8）：按当前档位 Layout.net().loadMs 估算爬升至 95%，
     配合真实已等待秒数；慢速档位（圆屏 GT / 老 API）额外标注“慢速网络”。
     fetch 完成/失败即停。
     注意：响应到达瞬间 @system.fetch 把整包（约 90~160KB）序列化进 JS
     线程，期间任何定时器都无法触发（动画/进度条"卡住"的物理原因）——
     估值让冻结发生在较高百分比，解冻后迅速走满。 */
  startLoadMeter() {
    this.loadStart = Date.now();
    this.stopLoadMeter();
    var that = this;
    var step = Math.floor(Layout.net().loadMs / 95);
    if (step < 20) {
      step = 20;
    }
    var slow = Layout.net().slow;
    this.loadTimer = setInterval(function () {
      var elapsed = Date.now() - that.loadStart;
      var pct = Math.floor(elapsed / step);
      if (pct > 95) {
        pct = 95;
      }
      that.loadBarW = Math.floor(240 * pct / 100);
      var label = '约 ' + pct + '% · 已等待 ' + Math.floor(elapsed / 1000) + ' 秒';
      if (slow) {
        label = '慢速网络 · ' + label;
      }
      that.loadLabel = label;
    }, 250);
  },

  stopLoadMeter() {
    if (this.loadTimer) {
      clearInterval(this.loadTimer);
      this.loadTimer = 0;
    }
    this.loadBarW = 0;
    this.loadLabel = '';
  },

  refreshSaved(url) {
    this.isSaved = Store.isBookmarked(url);
    this.saveLabel = this.isSaved ? TXT_SAVED : TXT_SAVE;
    this.starIcon = this.isSaved ? STAR_FULL : STAR_LINE;
  },

  /* -------------------------------- theme -------------------------------- */

  /* 主题固定为黑底蓝字（视觉值全部硬编码于 CSS）；v3.1 清理无绑定的主题字段 */

  applyLayout(prefs) {
    var geo = Layout.page('reader');
    this.fontSizeValue = prefs.fontSize;
    this.lineHeightValue = prefs.lineHeight;
    this.fontSizePx = prefs.fontSize;
    this.lineHeightPx = Math.floor(prefs.fontSize * prefs.lineHeight);
    this.layout = {
      fontLevel: Math.max(0, Config.FONT_SIZES.indexOf(prefs.fontSize)),
      lineLevel: Math.max(0, Config.LINE_HEIGHTS.indexOf(prefs.lineHeight)),
      fontSize: prefs.fontSize,
      lineHeight: this.lineHeightPx,
      /* 方屏 376 / 圆屏独立页 340；圆屏专用页的正文高度 264 */
      width: geo.textW || Config.CONTENT_W,
      height: geo.bodyH
    };
  },

  /* ------------------------------- actions ------------------------------- */

  onPrev() {
    if (this.showStart) {
      return;
    }
    if (this.isOk && this.pageIndex > 0) {
      this.renderAt(this.pageIndex - 1);
    }
  },

  onNext() {
    if (!this.isOk || this.showStart) {
      return;
    }
    if (this.pageIndex < this.pageCount - 1) {
      this.renderAt(this.pageIndex + 1);
      return;
    }
    /* 本章最后一页再往后翻：站点若有"下一页"入口则自动续读 */
    if (this.hasNext) {
      this.onNextChapter();
    }
  },

  /* 书名/目录页直达：「开始阅读」优先，其次第一条章节链接 */
  onStartRead() {
    var url = this.startHref || (this.chapters.length > 0 ? this.chapters[0].href : '');
    if (!url) {
      return;
    }
    this.persistPosition();
    Route.go(READER_PAGE, { url: url });
  },

  onNextChapter() {
    if (!this.nextHref) {
      return;
    }
    this.persistPosition();
    Route.go(READER_PAGE, { url: this.nextHref });
  },

  onPrevChapter() {
    if (!this.prevHref) {
      return;
    }
    this.persistPosition();
    Route.go(READER_PAGE, { url: this.prevHref });
  },

  /* 手势统一入口：swipe 事件与触摸轨迹两条通道都汇到这里。300ms 内只处理一次，
     避免固件同时派发 swipe 与 touch 时连翻两页。 */
  applySwipe(dir) {
    if (!dir) {
      return;
    }
    var now = Date.now();
    if (this.lastGestureAt && now - this.lastGestureAt < 300) {
      return;
    }
    this.lastGestureAt = now;
    if (dir === 'right') {
      if (this.panelOpen) {
        this.onClosePanel();
        return;
      }
      this.leave();
      return;
    }
    if (dir === 'left') {
      this.onOpenPanel();
      return;
    }
    if (this.panelOpen) {
      return;
    }
    if (dir === 'up') {
      this.onNext();
      return;
    }
    if (dir === 'down') {
      this.onPrev();
    }
  },

  /* 只保留「上下滑动翻页」+「右滑返回」；左右翻页设计已取消。
     表冠/key 通道已取消（真机不派发），勿再引入 onKey。 */
  onSwipe(event) {
    this.applySwipe(Gesture.swipeDir(event));
  },

  /* 触摸轨迹兜底：部分固件不派发 swipe，只派发 touchstart/touchend */
  onTouchStart(event) {
    Gesture.remember(this, event);
  },

  onTouchEnd(event) {
    this.applySwipe(Gesture.take(this, event));
  },

  leave() {
    this.persistPosition();
    var previous = Session.pop();
    if (previous && previous.url) {
      Route.go(READER_PAGE, { url: previous.url });
      return;
    }
    Route.goHome();
  },

  onBack() {
    this.leave();
  },

  onGoHome() {
    this.leave();
  },

  onRetry() {
    if (!this.url) {
      this.leave();
      return;
    }
    /* 重试 = 重新走网络（v3.3 起无网页缓存，无需强制刷新参数） */
    this.fetch(this.url, this.restoreOffset || 0);
  },

  onOpenLinks() {
    var doc = Session.getDoc(this.url);
    if (!this.url || !doc) {
      return;
    }
    this.persistPosition();
    /* 目录数据走文件通道传给目录页（每页独立 bundle、模块不跨页共享，
       目录页看不到本页 Session——v3.4 linkpass，route 文件参数同款机制）。
       链接表 = 章节链接优先 + 其余补足（大站目录排在 HTML 后段，靠优先级保住） */
    Linkpass.save({
      title: doc.title || '',
      url: this.url,
      pageIndex: this.pageIndex,
      links: Linkpass.mergeLinks(doc.chapters, doc.links)
    });
    Route.go(LINKS_PAGE);
  },

  onOpenSettings() {
    this.persistPosition();
    Route.go(SETTINGS_PAGE);
  },

  /* 操作页打开/关闭（v1.0 修复）：左滑路径此前直接改 panelOpen、绕过本方法，
     表冠焦点从未申请（真机操作页表冠不滚动的根因）——现在左右滑动都走这里。 */
  onOpenPanel() {
    if (this.panelOpen) {
      Crown.applyLater(this, [['toolList', true]]);
      return;
    }
    this.panelOpen = true;
    /* 工具页列表（if 分支内）挂载后接管表冠焦点 */
    Crown.applyLater(this, [['toolList', true]]);
  },

  onClosePanel() {
    this.panelOpen = false;
    Crown.cancel(this);
    Crown.apply(this, [['toolList', false]]);
  },

  /* 保存当前正文为离线网页（纯文本，@system.file 分片写入）。
     操作页行内显示「正在保存… N%」进度条；toast 在 FIT5 Pro 无 prompt 模块不可见，
     进度与结果状态就是保存反馈的主通道（2.4.0 网页下载进度显示）。 */
  onSaveOffline() {
    if (this.saveBusy) {
      return;
    }
    var doc = Session.getDoc(this.url);
    if (!doc) {
      this.showSaveState('暂无正文可存', '#FF453A', 0, '#1C1C1E');
      return;
    }
    if (String(doc.url).indexOf('offline://') === 0) {
      this.showSaveState('已在离线列表', '#64B5FF', 0, '#1C1C1E');
      return;
    }
    var that = this;
    this.saveBusy = true;
    this.showSaveState('保存中 0%', '#FFFFFF', 0, '#2C2C2E');
    toast('开始保存到离线');
    /* v1.0.1 崩溃修复：延后一拍再开始写盘——先让本次点击事件与面板重绘返回，
       再进入 10~13 次串行 file 调用与逐片切片；整段包 try/catch，
       任何异常都只降级为"保存失败"，不拖垮页面。 */
    setTimeout(function () {
      try {
        /* 离线标题识别（v3.3）：识别「书名 + 第n章」作为列表标题，
           识别不出回退原网页标题（Navrule.offlineTitle，纯函数冒烟覆盖）。 */
        var displayTitle = Navrule.offlineTitle(doc.title, doc.text);
        Saved.save(
          { url: doc.url, title: displayTitle ? displayTitle : doc.title },
          doc.text,
          function (written, total) {
            var pct = total > 0 ? Math.floor(written * 100 / total) : 0;
            that.showSaveState('保存中 ' + pct + '%', '#FFFFFF', pct, '#2C2C2E');
          },
          function (ok) {
            that.saveBusy = false;
            /* v1.0.2（"保存完成即崩"的修复）：完成态 UI 全部挪出 file 回调栈。
               真机反馈：崩溃后重开应用，离线条目**已成功写入**——说明最后一个
               写（清单）已落盘，崩溃发生在该次原生回调栈内的收尾（setData/
               toast/定时器）。这里改为下一拍执行，收尾不再重入原生调用栈。 */
            setTimeout(function () {
              try {
                if (ok) {
                  that.showSaveState('已保存到离线', '#64B5FF', 100, '#2C2C2E');
                  toast('已保存到离线网页');
                  that.saveResetTimer = setTimeout(function () {
                    that.saveResetTimer = 0;
                    that.showSaveState('保存离线', '#FFFFFF', 0, '#1C1C1E');
                  }, 1400);
                } else {
                  that.showSaveState('保存失败·重试', '#FF453A', 0, '#1C1C1E');
                  toast('保存失败');
                }
              } catch (err2) {
                /* 完成态 UI 异常绝不影响已写入的离线内容 */
              }
            }, 120);
          }
        );
      } catch (err) {
        that.saveBusy = false;
        that.showSaveState('保存失败·重试', '#FF453A', 0, '#1C1C1E');
      }
    }, 60);
  },

  showSaveState(label, color, pct, trackBg) {
    this.saveOffLabel = label;
    this.saveOffColor = color;
    this.saveTrackBg = trackBg;
    /* 轨道宽 240px（v2.5 胶囊内进度条），满值 = 整条 */
    this.saveBarW = Math.floor(240 * (pct > 100 ? 100 : pct) / 100);
  },

  /* 打开 AI 抓取的纯文本：正文来自 internal://app/ai/ 分片，不走网络与 HTML 解析 */
  openAiText(url, title, truncated) {
    var that = this;
    this.url = url || '';
    this.title = title || 'AI 阅读';
    this.loadingUrl = 'AI 正文';
    this.pageText = '';
    this.pageLabel = '';
    this.isLoading = true;
    this.isOk = false;
    this.isEmpty = false;
    this.isFailed = false;
    this.startSpinner();
    this.startLoadMeter();
    Aistore.load(url, function (text) {
      that.stopSpinner();
      that.stopLoadMeter();
      if (!text || text.length < Config.MIN_TEXT_CHARS) {
        that.onFail('ai-miss');
        return;
      }
      var doc = {
        url: that.url,
        title: that.title,
        text: text,
        links: [],
        nextHref: '',
        prevHref: '',
        startHref: '',
        chapters: [],
        truncated: !!truncated,
        kind: 'text',
        ai: true,
        status: 'ok',
        failReason: '',
        fetchedAt: Date.now()
      };
      that.install(doc, 0, 0);
      if (truncated) {
        toast('网页较长，已截断显示');
      }
    });
  },

  /* 打开离线网页：正文直接来自本地分片文件，不走网络与 HTML 解析 */
  openOffline(key, title, parts) {
    var that = this;
    this.url = 'offline://' + key;
    this.title = title || '离线网页';
    this.loadingUrl = '离线内容';
    this.pageText = '';
    this.pageLabel = '';
    this.isLoading = true;
    this.isOk = false;
    this.isEmpty = false;
    this.isFailed = false;
    this.startSpinner();
    this.startLoadMeter();
    Saved.load(key, parts, function (text) {
      that.stopSpinner();
      that.stopLoadMeter();
      if (!text || text.length < Config.MIN_TEXT_CHARS) {
        that.onFail('offline-miss');
        return;
      }
      var doc = {
        url: 'offline://' + key,
        title: title || '离线网页',
        text: text,
        links: [],
        nextHref: '',
        prevHref: '',
        startHref: '',
        chapters: [],
        truncated: false,
        kind: 'text',
        status: 'ok',
        failReason: '',
        fetchedAt: Date.now()
      };
      that.install(doc, 0, 0);
    });
  },

  onToggleBookmark() {
    var doc = Session.getDoc(this.url);
    if (!doc) {
      toast(TXT_SAVE_FAIL);
      return;
    }
    var saved = Store.toggleBookmark({ url: doc.url, title: doc.title });
    this.isSaved = saved;
    this.saveLabel = saved ? TXT_SAVED : TXT_SAVE;
    this.starIcon = saved ? STAR_FULL : STAR_LINE;
    toast(saved ? TXT_SAVED_OK : TXT_REMOVED_OK);
  }
};
