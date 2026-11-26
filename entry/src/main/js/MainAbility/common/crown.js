/**
 * 表冠焦点管理（微信 v1.1 rotateChange 同款模式，FIT4 生产包逻辑实证）。
 *
 * 平台事实：
 * - list.rotation({focus:boolean}) 为表冠焦点接口（SDK Lite 方法白名单，2026-11 核对），
 *   焦点在列表上时表冠旋转原生驱动该列表滚动（微信列表的表冠滑动即此机制，
 *   其 JS 内无任何表冠事件处理——本机表冠 key 事件不派发，勿走事件路线）；
 * - 微信全部列表另带 rotationvibrate 属性（表冠段落感振动）。
 *
 * 微信 rotateChange 模式（main/message 页原逻辑）：
 * 状态切换时「先对所有列表 focus:false，再给唯一活跃列表 focus:true」；
 * onShow 重申、onHide/onDestroy 全部释放。
 *
 * 守卫原则：$refs/$element/rotation 任一缺失即静默跳过（旧固件优雅降级为纯触摸滚动）。
 */
function elOf(vm, name) {
  try {
    if (vm && vm.$refs && vm.$refs[name]) {
      return vm.$refs[name];
    }
    if (vm && typeof vm.$element === 'function') {
      return vm.$element(name);
    }
  } catch (err) {
    /* ignore */
  }
  return null;
}

function setFocus(el, on) {
  try {
    if (el && typeof el.rotation === 'function') {
      el.rotation({ focus: on ? true : false });
    }
  } catch (err) {
    /* ignore */
  }
}

/**
 * pairs = [[refName, active], ...]：先全部失焦，再聚焦唯一活跃项。
 * 至多一个 active=true（微信同款语义）。
 */
function apply(vm, pairs) {
  if (!pairs) {
    return;
  }
  var i;
  for (i = 0; i < pairs.length; i += 1) {
    setFocus(elOf(vm, pairs[i][0]), false);
  }
  for (i = 0; i < pairs.length; i += 1) {
    if (pairs[i][1]) {
      setFocus(elOf(vm, pairs[i][0]), true);
    }
  }
}

/**
 * 条件分支内的列表（if/elif）在状态切换当帧可能尚未挂载，且**首次挂载含
 * 图标解码的列表可能晚于 450ms**（真机 v1.0 反馈：结果页/操作页表冠不滚动）：
 * 立即尝试 + 四档延时重申（150ms 覆盖普通挂载、450ms 覆盖 280ms 滑入动画、
 * 1000/1600ms 覆盖重挂载与慢解码；每 vm 四个定时器，cancel 一并清理）。
 */
function applyLater(vm, pairs, delay) {
  cancel(vm);
  apply(vm, pairs);
  if (!vm) {
    return;
  }
  vm.__crownTimer = setTimeout(function () {
    vm.__crownTimer = 0;
    apply(vm, pairs);
  }, delay || 150);
  vm.__crownTimer2 = setTimeout(function () {
    vm.__crownTimer2 = 0;
    apply(vm, pairs);
  }, 450);
  vm.__crownTimer3 = setTimeout(function () {
    vm.__crownTimer3 = 0;
    apply(vm, pairs);
  }, 1000);
  vm.__crownTimer4 = setTimeout(function () {
    vm.__crownTimer4 = 0;
    apply(vm, pairs);
  }, 1600);
}

/** 页面退出时清理延时定时器（onHide/onDestroy 配套调用）。 */
function cancel(vm) {
  try {
    if (vm && vm.__crownTimer) {
      clearTimeout(vm.__crownTimer);
      vm.__crownTimer = 0;
    }
    if (vm && vm.__crownTimer2) {
      clearTimeout(vm.__crownTimer2);
      vm.__crownTimer2 = 0;
    }
    if (vm && vm.__crownTimer3) {
      clearTimeout(vm.__crownTimer3);
      vm.__crownTimer3 = 0;
    }
    if (vm && vm.__crownTimer4) {
      clearTimeout(vm.__crownTimer4);
      vm.__crownTimer4 = 0;
    }
  } catch (err) {
    /* ignore */
  }
}

export default {
  apply: apply,
  applyLater: applyLater,
  cancel: cancel
};
