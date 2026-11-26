/**
 * 屏幕常亮（v3.7 新设定）。
 *
 * 接口：@system.brightness.setKeepScreenOn —— FIT5 Pro 真机能力检测实证
 * 「5 方法全在」，d.ts @reserved ["liteWearable"]，语义：**仅阻止不活动超时
 * 自动息屏**（不挡用户手势/遮挡息屏）。
 * 动机：加载大站页面时屏幕常在等待中息屏 → 应用被切后台 → 系统回收（进程被杀、
 * 应用关闭）。设定默认**开启**，设置页可关（关=恢复系统默认息屏策略）。
 */
import brightness from '@system.brightness';

function apply(on) {
  try {
    brightness.setKeepScreenOn({
      keepScreenOn: on === true,
      success: function () {},
      fail: function () {}
    });
  } catch (err) {
    /* 能力缺失时静默降级：息屏行为退回系统默认 */
  }
}

export default {
  apply: apply
};
