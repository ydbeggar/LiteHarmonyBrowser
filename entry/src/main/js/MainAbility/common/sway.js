/**
 * 加载图标水平往复（sway）——JS 补间驱动（fade.js 同款可信机制）。
 *
 * 为什么不用 CSS 动画（v2.9 真机反馈：到右端后瞬跳回左，无过渡）：
 * 本平台 CSS @keyframes 的真机证据只有**双关键帧**（微信 Go 0→360 / Voice 0→0.7）；
 * v2.6 的三关键帧 sway（0/50/100%）症状恰为引擎按 0→50% 段循环的退化行为，
 * alternate 方向亦仅「渲染正常、动态待确认」。而 setData 驱动的位置更新是
 * **已验证机制**（fade.js 5 步×32ms 真机通过；微信语音键 left/top 数据跟手）。
 *
 * 本模块用 32ms 步进的余弦补间驱动 left 数据绑定：运动按定义连续
 * （端点速度为零、无节点交换、无动画重启），不存在任何跳变。
 * 每次 setData 只改一个绑定值，加载态子树很小（≤10 节点），开销有界。
 */
var PERIOD = 1200; /* 一整循环 1.2s：左 → 右 → 左 */
var TICK = 32; /* 与 fade.js 步进一致（真机验证过的 cadence） */
var BASE = 18; /* sway 盒在 72px 容器内的居中 left */
var AMP = 8; /* 左右幅度 ±8px */

/** 启动往复。vm 需在 data 中声明 swayLeft（初始 BASE-AMP）。 */
function start(vm) {
  stop(vm);
  if (!vm) {
    return;
  }
  vm.__swayT0 = Date.now();
  vm.swayLeft = BASE - AMP;
  vm.__swayTimer = setInterval(function () {
    var phase = (Date.now() - vm.__swayT0) % PERIOD;
    /* 余弦往复：0→π 去程（左→右），π→2π 回程，全程连续可导 */
    var x = -AMP * Math.cos((2 * Math.PI * phase) / PERIOD);
    vm.swayLeft = BASE + Math.round(x);
  }, TICK);
}

/** 停止并清理定时器（onHide/onDestroy 配套）。 */
function stop(vm) {
  try {
    if (vm && vm.__swayTimer) {
      clearInterval(vm.__swayTimer);
      vm.__swayTimer = 0;
    }
  } catch (err) {
    /* ignore */
  }
}

export default {
  start: start,
  stop: stop
};
