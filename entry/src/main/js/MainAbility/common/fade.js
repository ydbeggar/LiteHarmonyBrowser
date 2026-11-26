/**
 * 轻量过渡动画：内容淡入（JS 补间）。
 *
 * 适用：同一节点内「内容换页」的过渡（列表翻页、结果刷新）——节点不重建，
 * CSS @keyframes 不会重播，只能 JS 补间。视图/状态切换一律用
 * if 插入 + CSS 入场动画（见各页 .anim-in），本模块不参与。
 *
 * 曲线：ease-out cubic（出快入稳），5 步 × 32ms ≈ 160ms，
 * 与 CSS 入场动画（280ms ease-out）同族，全应用过渡节奏连贯。
 * 只写 opacity 一个数字字段，不动布局（逆向规范 3.3）。
 *
 * 用法：页面 data 声明 fadeOpacity: 1，容器绑
 *   style="opacity: {{fadeOpacity}}"
 * 内容切换完成后调用 Fade.fadeIn(this)；
 * onDestroy 里调用 Fade.cancel(this) 清定时器。
 */

/* ease-out cubic 采样：0.35 起步（不全隐，避免闪烁）→ 1.0 */
var STEPS = [0.35, 0.67, 0.86, 0.96, 1];
var INTERVAL = 32;

function fadeIn(vm) {
  if (!vm) {
    return;
  }
  cancel(vm);
  var i = 0;
  vm.fadeOpacity = STEPS[0];
  function next() {
    i += 1;
    if (i >= STEPS.length) {
      vm.fadeOpacity = 1;
      vm.__fadeTimer = 0;
      return;
    }
    vm.fadeOpacity = STEPS[i];
    vm.__fadeTimer = setTimeout(next, INTERVAL);
  }
  vm.__fadeTimer = setTimeout(next, INTERVAL);
}

function cancel(vm) {
  if (!vm) {
    return;
  }
  if (vm.__fadeTimer) {
    clearTimeout(vm.__fadeTimer);
    vm.__fadeTimer = 0;
  }
  vm.fadeOpacity = 1;
}

export default {
  fadeIn: fadeIn,
  cancel: cancel,
  INTERVAL: INTERVAL
};
