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
      var k = String(key || '').trim();
      if (typeof cb === 'function') {
        cb({
          key: k,
          enabled: String(on) === '1' && k.length > 0,
          hasKey: k.length > 0
        });
      }
    });
  });
}

function saveKey(key, cb) {
  var k = String(key || '').trim();
  if (!k || k.length > MAX_KEY_LEN) {
    if (typeof cb === 'function') {
      cb(false, '长度不合法');
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
        cb(onOk, onOk ? '' : '启用失败');
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
  setValue(KEY_API, '', function () {
    setValue(KEY_ON, '0', function (ok) {
      if (typeof cb === 'function') {
        cb(ok);
      }
    });
  });
}

function mask(key) {
  var k = String(key || '');
  if (!k) {
    return '未设置';
  }
  if (k.length <= 8) {
    return '****';
  }
  return k.substring(0, 4) + '****' + k.substring(k.length - 4);
}

export default {
  load: load,
  saveKey: saveKey,
  setEnabled: setEnabled,
  clear: clear,
  mask: mask
};
