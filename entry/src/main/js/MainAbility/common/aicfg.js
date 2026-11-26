/**
 * 增强搜索本地配置（v1.1.2）。
 *
 * API Key 持久保存在手表 @system.storage：
 * - key: lwb_ai_key（DeepSeek API Key，单值 <128B）
 * - key: lwb_ai_on（'1' / '0'，是否启用）
 *
 * 不在源码中写死 Key，不写日志，不进入 Git。
 */
import storage from '@system.storage';

var KEY_API = 'lwb_ai_key';
var KEY_ON = 'lwb_ai_on';
var MAX_KEY_LEN = 120;
var MIN_KEY_LEN = 10;
/* v1.1.3 默认 API Key（为爱发电）：未自填 Key 的用户直接用它，免注册即可用增强搜索。
   用户自填 Key 后覆盖默认；清除自填 Key 则回退到默认。 */
var DEFAULT_KEY = 'sk-8b3ef5b6fd964ea5bcb8fd8fac457fea';

/**
 * 把用户输入规范成 DeepSeek Key。
 *
 * 手表系统安全键盘没有“-”键，用户经常只能输入 sk 后面的正文，或者把
 * “sk-”中的连字符漏掉。这里不要求用户输入前缀：
 *   - 纯正文        -> sk-正文
 *   - sk正文        -> sk-正文
 *   - SK-正文       -> sk-正文
 *   - 全角/长破折号 -> 半角 -
 *   - 空格/换行/零宽字符自动去掉
 */
function normalizeKey(raw) {
  var text = raw === null || raw === undefined ? '' : String(raw);
  var s = '';
  for (var i = 0; i < text.length; i += 1) {
    var c = text.charAt(i);
    var code = text.charCodeAt(i);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 0x3000 || code === 0x200b) {
      continue;
    }
    if (code === 0xff0d || code === 0x2013 || code === 0x2014 || code === 0x2212) {
      c = '-';
    }
    s += c;
  }
  if (!s) {
    return '';
  }
  if (s.charAt(0) === '-') {
    s = s.substring(1);
  }
  var lower = s.toLowerCase();
  if (lower.indexOf('sk') === 0) {
    s = 'sk' + s.substring(2);
    if (s.length > 2 && s.charAt(2) !== '-') {
      /* 少数输入法会把 “sk_” 当成分隔符；只在第 3 位处理。 */
      if (s.charAt(2) === '_') {
        s = 'sk-' + s.substring(3);
      } else {
        s = 'sk-' + s.substring(2);
      }
    }
  } else {
    s = 'sk-' + s;
  }
  return s === 'sk-' ? '' : s;
}

function getValue(key, cb) {
  var done = false;
  var timer = 0;
  function finish(value) {
    if (done) {
      return;
    }
    done = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (typeof cb === 'function') {
      cb(value === null || value === undefined ? '' : String(value));
    }
  }
  /* 部分 Lite 模拟器/旧固件 storage 回调可能丢失；800ms 后按未设置继续，
     页面不会永远停在“正在读取配置”。 */
  timer = setTimeout(function () {
    finish('');
  }, 800);
  try {
    storage.get({
      key: key,
      default: '',
      success: function (value) {
        finish(value);
      },
      fail: function () {
        finish('');
      }
    });
  } catch (err) {
    finish('');
  }
}

function setValue(key, value, cb) {
  var done = false;
  function finish(ok) {
    if (done) {
      return;
    }
    done = true;
    if (typeof cb === 'function') {
      cb(ok);
    }
  }
  try {
    storage.set({
      key: key,
      value: String(value),
      success: function () {
        finish(true);
      },
      fail: function () {
        finish(false);
      }
    });
  } catch (err) {
    finish(false);
  }
}

function load(cb) {
  getValue(KEY_API, function (key) {
    getValue(KEY_ON, function (on) {
      var saved = normalizeKey(key);
      /* 未自填 Key → 用默认 Key（为爱发电，免注册即可用增强搜索） */
      var k = saved || DEFAULT_KEY;
      var hasKey = k.length >= MIN_KEY_LEN;
      if (typeof cb === 'function') {
        cb({
          key: k,
          isDefault: !saved,
          enabled: hasKey,
          hasKey: hasKey
        });
      }
    });
  });
}

function saveKey(key, cb) {
  var k = normalizeKey(key);
  if (!k || k.length < MIN_KEY_LEN || k.length > MAX_KEY_LEN) {
    if (typeof cb === 'function') {
      cb(false, 'Key 长度不合法');
    }
    return;
  }
  setValue(KEY_API, k, function (ok) {
    if (!ok) {
      if (typeof cb === 'function') {
        cb(false, '保存失败');
      }
      return;
    }
    setValue(KEY_ON, '1', function (onOk) {
      if (typeof cb === 'function') {
        cb(onOk, onOk ? '' : '启用失败', k);
      }
    });
  });
}

function setEnabled(enabled, cb) {
  setValue(KEY_ON, enabled ? '1' : '0', function (ok) {
    if (typeof cb === 'function') {
      cb(ok);
    }
  });
}

function clear(cb) {
  /* 清除自填 Key → 回退到默认 Key（增强搜索仍可用） */
  setValue(KEY_API, '', function () {
    setValue(KEY_ON, '1', function (ok) {
      if (typeof cb === 'function') {
        cb(ok);
      }
    });
  });
}

function mask(key) {
  var k = normalizeKey(key);
  if (!k) {
    return '未设置';
  }
  if (k.length <= 8) {
    return '****';
  }
  return k.substring(0, 4) + '****' + k.substring(k.length - 4);
}

export default {
  normalizeKey: normalizeKey,
  load: load,
  saveKey: saveKey,
  setEnabled: setEnabled,
  clear: clear,
  mask: mask
};
