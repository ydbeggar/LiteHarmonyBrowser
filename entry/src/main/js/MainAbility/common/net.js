/**
 * Network layer: @system.fetch only.
 * Every request carries a sequence token; callbacks from older requests are
 * dropped. A client-side timer classifies a silent request as `timeout`.
 *
 * v1.0.8 优化：Range 用 respCapBytes（字节），解析截断用 parseWindowChars（字符）。
 * 旧代码 maxHtml 同时当两者用——CJK 页面 48K Range 只拿到 ~16K 字符。
 * 新代码 Range 独立于解析窗口，HTML 中的 JS/CSS/标签不会挤占正文传输额度。
 */
import fetch from '@system.fetch';
import network from '@system.network';
import Config from './config.js';
import Layout from './layout.js';

var seq = 0;

function syscap(name) {
  if (typeof canIUse !== 'function') {
    return true;
  }
  try {
    return canIUse(name);
  } catch (err) {
    return true;
  }
}

function classify(code) {
  return Number(code) === 28 ? 'timeout' : 'unreachable';
}

function checkNetwork(ok) {
  var done = false;
  /* 慢速机型（圆屏 GT / 老 API）网络类型查询也可能慢，给 3s；
     FIT5 Pro 维持 1.5s，避免无谓拉长首屏。 */
  var guardMs = Layout.net().slow ? 3000 : 1500;
  var guard = setTimeout(function () {
    if (!done) {
      done = true;
      ok(true);
    }
  }, guardMs);

  function finish(online) {
    if (done) {
      return;
    }
    done = true;
    clearTimeout(guard);
    ok(online);
  }

  if (!syscap('SystemCapability.Communication.NetManager.Core')) {
    finish(true);
    return;
  }
  try {
    network.getType({
      success: function (res) {
        finish(!!res && String(res.type).toLowerCase() !== 'none');
      },
      fail: function () {
        finish(true);
      }
    });
  } catch (err) {
    finish(true);
  }
}

/**
 * @param {string} url absolute http(s) URL
 * @param {{onSuccess:function,onFail:function}} cb
 * @param {{maxChars:number,timeoutMs:number}=} opts
 *        maxChars 默认按当前设备档位（Layout.net().maxResp）；
 *        timeoutMs 默认按当前设备档位（FIT 20s / GT 45s / API<24 老机型 60s）。
 */
function fetchText(url, cb, opts) {
  var callbacks = cb || {};
  var profile = Layout.net();
  /* Range 用字节上限（respCapBytes），解析截断用字符上限（parseWindowChars）。
     旧代码把 maxHtml 同时当两者——CJK 页面 48K 字符的 Range 只拿到 ~16K 字符。 */
  var byteLimit = opts && opts.maxBytes ? Math.floor(opts.maxBytes) : profile.respCapBytes;
  var charLimit = opts && opts.maxChars ? Math.floor(opts.maxChars) : profile.parseWindowChars;
  var timeoutMs = opts && opts.timeoutMs ? Math.floor(opts.timeoutMs) : profile.timeoutMs;
  seq += 1;
  var mySeq = seq;
  var finished = false;
  var timer = 0;

  function fail(reason) {
    if (finished || mySeq !== seq) {
      return;
    }
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (typeof callbacks.onFail === 'function') {
      callbacks.onFail(reason);
    }
  }

  function succeed(text) {
    if (finished || mySeq !== seq) {
      return;
    }
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (typeof callbacks.onSuccess === 'function') {
      callbacks.onSuccess(text);
    }
  }

  if (!syscap('SystemCapability.Communication.NetStack')) {
    setTimeout(function () {
      fail('unsupported');
    }, 0);
    return { seq: mySeq };
  }

  checkNetwork(function (online) {
    if (finished || mySeq !== seq) {
      return;
    }
    if (!online) {
      fail('offline');
      return;
    }
    timer = setTimeout(function () {
      fail('timeout');
    }, timeoutMs);
    try {
      fetch.fetch({
        url: url,
        method: 'GET',
        responseType: 'text',
        /* 手机端 UA 固定不变，保证站点返回 WAP 轻量页 */
        header: {
          'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          /* 设备实测 @system.fetch 会自动解压 gzip（见 pages/diag），
             大站压缩比 3~5 倍，直接省掉 60%~80% 的传输时间 */
          'Accept-Encoding': Config.ACCEPT_ENCODING,
          'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          /* 只取前 byteLimit 字节：支持 Range 的站点可省下大半流量，
             不支持的站点会返回 200 全量，仍由下方长度检查兜住。
             Range 是字节单位，与解析字符窗口（parseWindowChars）独立。 */
          'Range': 'bytes=0-' + (byteLimit - 1)
        },
        success: function (response) {
          if (finished || mySeq !== seq) {
            return;
          }
          var code = response && response.code ? Number(response.code) : 0;
          if (code >= 400) {
            fail('unreachable');
            return;
          }
          var data = response ? response.data : '';
          if (typeof data !== 'string') {
            succeed('');
            return;
          }
          /* 手表 JS heap 很小，超大响应不能整包进内存：截断到 charLimit 照常
             放行（解析器天然容忍残缺页面，至少能看到目录/前几段），
             比整个判失败体验好得多（1.9.1 大页面教训）。
             截断用字符数（parseWindowChars），与 Range 字节上限独立。 */
          if (data.length > charLimit) {
            data = data.substring(0, charLimit);
            try {
              response.data = null;
            } catch (err) {
              /* ignore */
            }
            response = null;
          }
          succeed(data);
        },
        fail: function (data, code) {
          fail(classify(code));
        }
      });
    } catch (err) {
      fail('unreachable');
    }
  });

  return { seq: mySeq };
}

/**
 * 通用请求（v1.1.2，DeepSeek Search/Fetch 用）。
 *
 * 与 fetchText 共用序号令牌：任何新请求都会让旧请求的回调失效，
 * 因此同一时刻只允许一个网络请求（页面层负责串行）。
 *
 * @param {string} url
 * @param {{onSuccess:function,onFail:function}} cb
 * @param {{method:string,header:object,data:string,responseType:string,
 *          timeoutMs:number,maxChars:number}=} opts
 */
function request(url, cb, opts) {
  var callbacks = cb || {};
  var options = opts || {};
  var profile = Layout.net();
  var timeoutMs = options.timeoutMs ? Math.floor(options.timeoutMs) : profile.timeoutMs;
  var maxChars = options.maxChars ? Math.floor(options.maxChars) : 200000;
  seq += 1;
  var mySeq = seq;
  var finished = false;
  var timer = 0;

  function fail(reason) {
    if (finished || mySeq !== seq) {
      return;
    }
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (typeof callbacks.onFail === 'function') {
      callbacks.onFail(reason);
    }
  }

  function succeed(text) {
    if (finished || mySeq !== seq) {
      return;
    }
    finished = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (typeof callbacks.onSuccess === 'function') {
      callbacks.onSuccess(text);
    }
  }

  if (!syscap('SystemCapability.Communication.NetStack')) {
    setTimeout(function () {
      fail('unsupported');
    }, 0);
    return { seq: mySeq };
  }

  checkNetwork(function (online) {
    if (finished || mySeq !== seq) {
      return;
    }
    if (!online) {
      fail('offline');
      return;
    }
    timer = setTimeout(function () {
      fail('timeout');
    }, timeoutMs);
    try {
      var header = options.header || {};
      if (!header['Accept']) {
        header['Accept'] = 'application/json,text/plain,*/*';
      }
      if (!header['User-Agent']) {
        header['User-Agent'] = 'LiteHarmonyBrowser/1.1.4';
      }
      fetch.fetch({
        url: url,
        method: options.method || 'GET',
        responseType: options.responseType || 'text',
        header: header,
        data: options.data,
        success: function (response) {
          if (finished || mySeq !== seq) {
            return;
          }
          var code = response && response.code ? Number(response.code) : 0;
          if (code >= 400) {
            fail('http-' + code);
            return;
          }
          var data = response ? response.data : '';
          if (typeof data !== 'string') {
            succeed(data);
            return;
          }
          if (maxChars > 0 && data.length > maxChars) {
            data = data.substring(0, maxChars);
          }
          succeed(data);
        },
        fail: function (data, code) {
          fail(classify(code));
        }
      });
    } catch (err) {
      fail('unreachable');
    }
  });

  return { seq: mySeq };
}

export default {
  fetchText: fetchText,
  request: request,
  cancel: function () {
    seq += 1;
  },
  isSupported: function () {
    return syscap('SystemCapability.Communication.NetStack');
  }
};
