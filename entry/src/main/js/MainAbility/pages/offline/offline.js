import Route from '../../common/route.js';
import Url from '../../common/url.js';
import Saved from '../../common/saved.js';
import Gesture from '../../common/gesture.js';
import Crown from '../../common/crown.js';
import Layout from '../../common/layout.js';

var READER_PAGE = 'pages/reader/reader';

function two(v) {
  return v < 10 ? '0' + v : '' + v;
}

function fmtTime(ts) {
  if (!ts) {
    return '';
  }
  var d = new Date(ts);
  return two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
}

export default {
  data: {
    countLabel: '',
    hasItems: false,
    items: [],
    g: Layout.page('offline')
  },

  onInit() {
    var that = this;
    Layout.init(function () {
      that.g = Layout.page('offline');
      Layout.syncConfig();
    });
    this.all = [];
    this.load();
  },

  onShow() {
    this.load();
  },

  onHide() {
    Crown.cancel(this);
    Crown.apply(this, [['itemList', false]]);
  },

  onDestroy() {
    Crown.cancel(this);
    Crown.apply(this, [['itemList', false]]);
  },

  load() {
    var that = this;
    Saved.list(function (list) {
      var out = [];
      for (var i = 0; i < list.length; i += 1) {
        var sub = Url.hostOf(list[i].url) || '离线正文';
        var when = fmtTime(list[i].ts);
        if (when) {
          sub = sub + '  ·  ' + when;
        }
        out.push({
          key: list[i].key,
          title: list[i].title,
          sub: sub
        });
      }
      that.all = list;
      that.items = out;
      that.hasItems = out.length > 0;
      that.countLabel = out.length + ' 篇';
      /* 表冠焦点：列表在 if 分支内，渲染后延时重申（微信 rotateChange 同款语义） */
      Crown.applyLater(that, [['itemList', out.length > 0]]);
    });
  },

  onOpen(index) {
    var it = this.all[index];
    if (!it) {
      return;
    }
    Route.go(READER_PAGE, { offline: 1, key: it.key, title: it.title, parts: it.parts });
  },

  onDelete(index) {
    var it = this.all[index];
    if (!it) {
      return;
    }
    var that = this;
    /* 删除是异步的：必须等清单重写完成后刷新，否则刷新读到旧清单，删掉的条目又出现 */
    Saved.remove(it.key, it.parts, function () {
      that.load();
    });
  },

  onBack() {
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
  }
};
