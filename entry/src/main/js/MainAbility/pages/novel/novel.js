/**
 * 小说搜索页（Bing RSS 模式）。
 * 流程：输入小说名 → 拼接"搜索词+笔趣阁"发 Bing RSS → 解析结果 → 自动打开第一个链接。
 * Bing RSS: https://www.bing.com/search?q=<query>+笔趣阁&format=rss
 */
import Route from '../../common/route.js';
import Net from '../../common/net.js';
import Layout from '../../common/layout.js';

var READER_PAGE = 'pages/reader/reader';
var BING_RSS = 'https://www.bing.com/search?q=';
var BING_SUFFIX = '&format=rss';

export default {
  data: {
    g: Layout.page('search'),
    query: '',
    isLoading: false,
    hasResults: false,
    isFailed: false,
    emptyTitle: '搜索小说',
    failTitle: '',
    failSub: '',
    items: [],
    fadeOpacity: 1
  },

  onInit() {
    this.query = '';
  },

  /* Lite input 的 change 事件：实时触发，回调参数是字符串本身（与 search.js 同款） */
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
    /* 失焦后 change 可能晚一拍，延后读取（与 search.js 同款 80ms） */
    var that = this;
    setTimeout(function () {
      that.doSearch(that.query);
    }, 80);
  },

  doSearch(rawQuery) {
    var q = rawQuery ? String(rawQuery).trim() : '';
    if (!q) {
      this.emptyTitle = '请输入小说名';
      this.hasResults = false;
      this.isFailed = false;
      return;
    }
    this.isLoading = true;
    this.hasResults = false;
    this.isFailed = false;
    /* Bing RSS 搜索：搜索词+笔趣阁，靠摘要关键词过滤识别小说站 */
    var searchQ = q + ' 笔趣阁';
    var url = BING_RSS + encodeURIComponent(searchQ) + BING_SUFFIX;
    var that = this;
    Net.fetchText(url, {
      onSuccess: function (text) {
        that.parseRss(text);
      },
      onFail: function (reason) {
        that.isLoading = false;
        that.isFailed = true;
        that.failTitle = '搜索失败';
        that.failSub = reason === 'timeout' ? '网络超时，请重试' : '无法连接搜索服务';
      }
    }, { maxChars: 15000 });
  },

  /* 解析 Bing RSS XML：提取 <link>/<title>/<description>，按摘要关键词识别小说站。
     笔趣阁域名多样（biquge/biquga/biqugew 等），不能按域名过滤；
     改为在标题/摘要中匹配"笔趣阁/小说/章节/在线阅读/最新章节"等关键词。 */
  parseRss(text) {
    this.isLoading = false;
    var results = [];
    var s = text || '';

    /* 逐条解析 <item> 块 */
    var itemPos = 0;
    while (results.length < 10) {
      var itemStart = s.indexOf('<item>', itemPos);
      if (itemStart < 0) break;
      var itemEnd = s.indexOf('</item>', itemStart + 6);
      if (itemEnd < 0) break;
      var block = s.substring(itemStart + 6, itemEnd);
      itemPos = itemEnd + 7;

      /* 提取 <link> */
      var linkUrl = '';
      var lt = block.indexOf('<link>');
      if (lt >= 0) {
        var gt = block.indexOf('</link>', lt + 6);
        if (gt > lt) {
          linkUrl = block.substring(lt + 6, gt).trim();
        }
      }
      if (!linkUrl || linkUrl.indexOf('http') !== 0) continue;

      /* 提取 <title> */
      var title = '';
      var lt2 = block.indexOf('<title>');
      if (lt2 >= 0) {
        var gt2 = block.indexOf('</title>', lt2 + 7);
        if (gt2 > lt2) {
          title = block.substring(lt2 + 7, gt2).trim();
        }
      }

      /* 提取 <description>（摘要，用于关键词匹配） */
      var desc = '';
      var lt3 = block.indexOf('<description>');
      if (lt3 >= 0) {
        var gt3 = block.indexOf('</description>', lt3 + 13);
        if (gt3 > lt3) {
          desc = block.substring(lt3 + 13, gt3).trim();
        }
      }

      /* 关键词匹配：标题或摘要含小说站特征词 */
      var combined = title + ' ' + desc;
      var isNovel = combined.indexOf('笔趣阁') >= 0 ||
        combined.indexOf('小说') >= 0 ||
        combined.indexOf('章节') >= 0 ||
        combined.indexOf('在线阅读') >= 0 ||
        combined.indexOf('最新章节') >= 0 ||
        combined.indexOf('全文阅读') >= 0 ||
        combined.indexOf('免费阅读') >= 0;
      if (!isNovel) continue;

      /* 排除非小说站：百度贴吧/知道/百科、知乎、CSDN、博客等 */
      var skipDomains = 'tieba.baidu.com|zhidao.baidu.com|baike.baidu.com|zhihu.com|csdn.net|blog.csdn|jianshu.com|weibo.com|bilibili.com|douban.com|taobao.com|jd.com|amazon.cn|wikipedia.org|sogou.com|so.com';
      var skipList = skipDomains.split('|');
      var skipThis = false;
      for (var si = 0; si < skipList.length; si += 1) {
        if (linkUrl.indexOf(skipList[si]) >= 0) {
          skipThis = true;
          break;
        }
      }
      if (skipThis) continue;

      results.push({
        title: title.length > 30 ? title.substring(0, 30) + '…' : (title || linkUrl),
        sub: desc.length > 40 ? desc.substring(0, 40) + '…' : (desc || linkUrl),
        url: linkUrl,
        tid: linkUrl
      });
    }

    if (results.length === 0) {
      this.hasResults = false;
      this.isFailed = false;
      this.emptyTitle = '没有找到「' + this.query + '」';
      return;
    }

    this.items = results;
    this.hasResults = true;

    /* 自动打开第一个结果 */
    var that = this;
    setTimeout(function () {
      Route.go(READER_PAGE, { url: results[0].url });
    }, 300);
  },

  onOpen(index) {
    if (this.items && index >= 0 && index < this.items.length) {
      Route.go(READER_PAGE, { url: this.items[index].url });
    }
  },

  goBack() {
    Route.goHome();
  }
};
