/**
 * 手表端路由封装。
 *
 * 两个约束（均已在 FIT 5 / API 6.1.1 上实测）：
 * 1. @system.router 只提供 replace（ArkUI.Lite 能力）；push / back / getParams /
 *    getLength 属于 ArkUI.Full，在手表上是 undefined，直接调用会抛
 *    "TypeError: Expected a function"。
 * 2. Lite 的每个页面被打成独立 bundle，模块级变量不跨页面共享，
 *    因此跨页参数不能放在模块变量里。这里用 globalThis（同一 VM 内共享）
 *    同步传递，并用 @system.storage 做异步兜底。
 * 3. 2.4.0 修正：storage 单 value 硬限制 128 字节，写入**静默失败**——
 *    离线打开的 {offline,key,title,parts} 与长 URL 参数都可能超限，目标页
 *    会读到旧参数或空参数（「离线网页不可用」根因之一）。现以 @system.file
 *    文件通道为异步主通道（大小无关、真机已实证），storage 保留为兜底。
 */
import router from '@system.router';
import storage from '@system.storage';
import Fs from './fsutil.js';
import Layout from './layout.js';

var HOME = 'pages/index/index';
var KEY_PARAMS = 'lwb_route_params';
var KEY_CURRENT = 'lwb_current_url';
var PARAMS_FILE = 'internal://app/lwb_route.txt';
var CURRENT_FILE = 'internal://app/lwb_cur.txt';
var PARAMS_READ_LEN = 4000;

var memParams = '';

function writeRaw(text) {
  memParams = text;
  try {
    if (typeof globalThis === 'object' && globalThis) {
      globalThis.__lwbRouteParams = text;
    }
  } catch (err) {
    /* ignore */
  }
  try {
    storage.set({ key: KEY_PARAMS, value: text });
  } catch (err) {
    /* ignore */
  }
}

function readRaw() {
  if (memParams) {
    return memParams;
  }
  try {
    if (typeof globalThis === 'object' && globalThis && typeof globalThis.__lwbRouteParams === 'string') {
      return globalThis.__lwbRouteParams;
    }
  } catch (err) {
    /* ignore */
  }
  return '';
}

function parse(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

/**
 * 圆屏专用页映射（v1.0.7）：
 * 页面 JS 里仍写 pages/reader/reader 这类逻辑地址；检测到圆屏后
 * 自动改走 pages/round/reader/reader。首页固定为 pages/index/index，
 * 由首页内部的 if 分支渲染圆屏布局，不做重定向。
 */
function targetUri(uri) {
  var text = uri ? String(uri) : '';
  if (!text || text === HOME || text.indexOf('pages/round/') === 0) {
    return text;
  }
  if (Layout.isRound() && text.indexOf('pages/') === 0) {
    return 'pages/round/' + text.substring(6);
  }
  return text;
}

/** 跳转到 uri，并携带本次跳转的参数。 */
function go(uri, params) {
  var text = '';
  try {
    text = JSON.stringify(params || {});
  } catch (err) {
    text = '';
  }
  memParams = text;
  try {
    if (typeof globalThis === 'object' && globalThis) {
      globalThis.__lwbRouteParams = text;
    }
  } catch (err) {
    /* ignore */
  }
  var jumped = false;
  function jump() {
    if (jumped) {
      return;
    }
    jumped = true;
    router.replace({ uri: targetUri(uri) });
  }
  /* 主通道：文件（无 128 字节限制），经全局串行队列（v3.7）。
     写失败时清掉旧文件，避免目标页读到旧参数。 */
  Fs.writeSmall(PARAMS_FILE, text, function (ok) {
    if (ok) {
      jump();
      return;
    }
    Fs.deleteList([PARAMS_FILE], jump);
  });
  /* 兜底通道：storage（小参数仍可用；超 128 字节静默失败也无害） */
  try {
    storage.set({ key: KEY_PARAMS, value: text });
  } catch (err4) {
    /* ignore */
  }
  /* 兜底：文件回调异常时也能跳转 */
  setTimeout(jump, 400);
}

/** 同步取参数（globalThis 通道）；取不到返回 null。 */
function takeSync() {
  return parse(readRaw());
}

/** 异步取参数：文件主通道 → storage 兜底 → null。 */
function takeAsync(cb) {
  var sync = takeSync();
  if (sync) {
    cb(sync);
    return;
  }
  var settled = false;
  function fromStorage() {
    if (settled) {
      return;
    }
    settled = true;
    try {
      storage.get({
        key: KEY_PARAMS,
        success: function (value) {
          cb(parse(value));
        },
        fail: function () {
          cb(null);
        }
      });
    } catch (err) {
      cb(null);
    }
  }
  Fs.readSmall(PARAMS_FILE, function (text) {
    if (!text) {
      fromStorage();
      return;
    }
    if (settled) {
      return;
    }
    settled = true;
    cb(parse(text));
  });
}

/** 记录"当前正在阅读的网址"，供返回时恢复。
    v3.4（浏览热路径去文件 I/O）：同值去重——fetch/install 每次翻章各调一次，
    去重后重复调用零操作；短 URL 走 storage（kv 轻操作，v3.0 等级），
    仅超长 URL（>100 字符，罕见）落文件并清 storage 旧值防读到过期数据。
    v3.1~v3.3 每次翻章 2 次文件写，是浏览崩溃文件风暴的组成部分。 */
var lastCurrent = null;

function setCurrent(url) {
  var text = url ? String(url) : '';
  if (text === lastCurrent) {
    return;
  }
  lastCurrent = text;
  try {
    if (typeof globalThis === 'object' && globalThis) {
      globalThis.__lwbCurrentUrl = text;
    }
  } catch (err) {
    /* ignore */
  }
  if (text.length <= 100) {
    try {
      storage.set({ key: KEY_CURRENT, value: text });
    } catch (err2) {
      /* ignore */
    }
    return;
  }
  /* 先写文件，成功后再清 storage：文件写失败时保留旧值，至少还能恢复
     上一页；失败同时清 lastCurrent，下次同 URL 还会重试。 */
  Fs.writeSmall(CURRENT_FILE, text, function (ok) {
    if (!ok) {
      if (lastCurrent === text) {
        lastCurrent = null;
      }
      return;
    }
    try {
      storage.set({ key: KEY_CURRENT, value: '' });
    } catch (err3) {
      /* ignore */
    }
  });
}

/** 读取"当前正在阅读的网址"：globalThis → storage（短 URL 主存）→ 文件
    （长 URL 存档）兜底，取不到回调空串。读取只发生在返回链路（用户动作）。 */
function getCurrent(cb) {
  try {
    if (typeof globalThis === 'object' && globalThis && typeof globalThis.__lwbCurrentUrl === 'string') {
      if (globalThis.__lwbCurrentUrl) {
        cb(globalThis.__lwbCurrentUrl);
        return;
      }
    }
  } catch (err) {
    /* ignore */
  }
  var settled = false;
  function fromFile() {
    if (settled) {
      return;
    }
    settled = true;
    Fs.readSmall(CURRENT_FILE, function (text) {
      cb(text ? String(text) : '');
    });
  }
  try {
    storage.get({
      key: KEY_CURRENT,
      success: function (value) {
        if (settled) {
          return;
        }
        if (value) {
          settled = true;
          cb(String(value));
          return;
        }
        fromFile();
      },
      fail: fromFile
    });
  } catch (err3) {
    fromFile();
  }
}

/** 回到首页。 */
function goHome() {
  writeRaw('');
  router.replace({ uri: HOME });
}

export default {
  HOME: HOME,
  go: go,
  _targetUri: targetUri,
  takeSync: takeSync,
  takeAsync: takeAsync,
  setCurrent: setCurrent,
  getCurrent: getCurrent,
  goHome: goHome
};
