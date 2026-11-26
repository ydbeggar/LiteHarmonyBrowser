/**
 * 手势事件统一解析（滑动返回 + 上下滑动翻页）。
 *
 * 通道说明（真机 FIT 5 Pro 已验证 / 已否决）：
 * - swipe 事件与 touchstart/touchend 触摸轨迹：真机均正常派发，双通道并用；
 * - key 事件（表冠转动方向键映射）：真机不派发，表冠控制设计已取消，
 *   相关代码删除，勿再引入。
 *
 * 手势统一归一化为 'up' | 'down' | 'left' | 'right'，语义由页面决定：
 * 上滑/下滑翻页，右滑返回。
 */

/* 右滑返回阈值 100px（LW-BACK-01，微信实证防误触值）；
   垂直翻页是轻拂语义，保留小阈值 28px。 */
var MIN_DY = 28;
var MIN_DX = 100;

function lower(value) {
  return value === null || value === undefined ? '' : String(value).toLowerCase();
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return -1;
  }
  var n = Number(value);
  if (isNaN(n)) {
    return -1;
  }
  return Math.floor(n);
}

/**
 * 触摸事件方向归一化（不带距离门槛，touchstart 即可判定）：
 * 'up' | 'down' | 'left' | 'right' | ''。
 * 与 swipeDir 的区别：swipeDir 带防误触距离门槛，只适用于 swipe 事件；
 * 数字编码 0/1/2/3 兼容（固件差异）——注意 0 是 falsy，必须显式比较，
 * 不能用 `event.direction ? ...` 取值（up=0 会整段丢失，v2.8 斜向运动根因）。
 */
function dirOf(event) {
  if (!event) {
    return '';
  }
  var raw = event.direction;
  if (raw === null || raw === undefined) {
    raw = event.dir;
  }
  var dir = lower(raw);
  if (dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right') {
    return dir;
  }
  if (raw === 0 || raw === '0') {
    return 'up';
  }
  if (raw === 1 || raw === '1') {
    return 'down';
  }
  if (raw === 2 || raw === '2') {
    return 'left';
  }
  if (raw === 3 || raw === '3') {
    return 'right';
  }
  return '';
}

/** swipe 事件方向归一化：'up' | 'down' | 'left' | 'right' | '' */
function swipeDir(event) {
  if (!event) {
    return '';
  }
  var raw = event.direction;
  if (raw === null || raw === undefined) {
    raw = event.dir;
  }
  var dir = lower(raw);
  if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
    /* 少数固件给 0/1/2/3 */
    var n = toNumber(raw);
    if (n === 0) {
      dir = 'up';
    } else if (n === 1) {
      dir = 'down';
    } else if (n === 2) {
      dir = 'left';
    } else if (n === 3) {
      dir = 'right';
    } else {
      return '';
    }
  }
  /* 与触摸通道同阈值：固件给了 distance 且过短的滑动不作数（防误触）。
     不带 distance 的事件放行（各固件字段不统一）。 */
  if (typeof event.distance === 'number' && !isNaN(event.distance)) {
    var need = dir === 'left' || dir === 'right' ? MIN_DX : MIN_DY;
    if (event.distance < need) {
      return '';
    }
  }
  return dir;
}

/**
 * 触摸点宽松解析。Lite 的 touch 事件在不同固件上是
 * {touches:[{clientX,clientY}]} / {touches:[{x,y}]} / {clientX,clientY}，
 * 这里逐一尝试，取不到返回 null。
 */
function pointOf(event) {
  if (!event) {
    return null;
  }
  var list = event.touches;
  if (!list || !list.length) {
    list = event.changedTouches;
  }
  var p = list && typeof list.length === 'number' && list.length > 0 ? list[0] : event;
  if (!p) {
    return null;
  }
  var x = toNumber(p.clientX);
  if (x < 0) {
    x = toNumber(p.x);
  }
  var y = toNumber(p.clientY);
  if (y < 0) {
    y = toNumber(p.y);
  }
  if (x < 0 && y < 0) {
    return null;
  }
  return { x: x < 0 ? 0 : x, y: y < 0 ? 0 : y };
}

/**
 * 由起止两点判定方向：'up' | 'down' | 'left' | 'right' | ''
 * 主轴位移不足、或次轴占优时返回空串，避免斜滑误判。
 */
function swipeFromDelta(start, end) {
  if (!start || !end) {
    return '';
  }
  var dx = end.x - start.x;
  var dy = end.y - start.y;
  var ax = dx < 0 ? -dx : dx;
  var ay = dy < 0 ? -dy : dy;
  if (ay >= MIN_DY && ay > ax) {
    return dy < 0 ? 'up' : 'down';
  }
  if (ax >= MIN_DX && ax > ay) {
    return dx < 0 ? 'left' : 'right';
  }
  return '';
}

/**
 * 记录触摸起点。页面在 ontouchstart 里调用；
 * 状态挂在页面实例上，不进 data（避免 setData 复制）。
 */
function remember(vm, event) {
  if (!vm) {
    return;
  }
  vm.gestureOrigin = pointOf(event);
}

/** 结束触摸并返回方向；无起点或位移不足返回 ''。 */
function take(vm, event) {
  if (!vm) {
    return '';
  }
  var start = vm.gestureOrigin;
  vm.gestureOrigin = null;
  return swipeFromDelta(start, pointOf(event));
}

export default {
  swipeDir: swipeDir,
  dirOf: dirOf,
  pointOf: pointOf,
  swipeFromDelta: swipeFromDelta,
  remember: remember,
  take: take
};
