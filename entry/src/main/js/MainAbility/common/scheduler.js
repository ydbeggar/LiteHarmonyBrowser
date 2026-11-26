/**
 * 调度器（P2-c）：文件突发预算 + 内存闸门 + 简单任务队列。
 *
 * 设备分类（2026-11-08 三台实测，屏幕形态 + API 二分）：
 *   - 方屏 + API≥24（FIT5 Pro）：burst 并发安全，预算 4 次/500ms 窗口；
 *   - 圆屏（GT6 等）或 API<24（FIT4 等）：burst 并发不安全，严格串行 1 次。
 * 不用设备型号判断（getInfo 返回值不干净），只用 screenShape + apiVersion。
 *
 * 语法：ES5（var/function），不依赖 Promise/globalThis/正则。
 */
import Fs from './fsutil.js';
import Layout from './layout.js';
import Store from './store.js';

/* ---------------- 文件突发预算 ---------------- */

var BURST_WINDOW_MS = 500;

var burst = { count: 0, start: 0 };
var burstQueue = [];

/** 按设备档位返回单次突发上限：FIT5 Pro=4，受限设备=1（严格串行）。
    forceFull 开启时强制按 FIT5 档位运行。 */
function burstLimit() {
  /* 强开完整模式：忽略设备分类，直接用全功能档位 */
  if (Store.loadPrefs().forceFull) {
    return 4;
  }
  var p = Layout.get();
  /* 圆屏=GT 系列（burst 不安全），API<24=FIT4 等老机型（burst 不安全） */
  if (p.round || p.apiVersion <= 0 || p.apiVersion < 24) {
    return 1;
  }
  return 4;
}

function scheduleFileOp(thunk, done) {
  var limit = burstLimit();
  var now = Date.now();
  if (now - burst.start > BURST_WINDOW_MS) {
    burst = { count: 0, start: now };
  }
  if (burst.count >= limit) {
    var waitMs = BURST_WINDOW_MS - (now - burst.start) + 20;
    if (waitMs < 20) {
      waitMs = 20;
    }
    burstQueue.push({ thunk: thunk, done: done });
    setTimeout(function () {
      scheduleFileOp(thunk, done);
    }, waitMs);
    return;
  }
  burst.count += 1;
  Fs.runOp(function (release) {
    try {
      thunk();
    } catch (err) {
      /* 任务异常不阻塞队列 */
    }
    release();
    if (typeof done === 'function') {
      done();
    }
  });
}

function burstPending() {
  return burstQueue.length;
}

function resetBurst() {
  burst = { count: 0, start: 0 };
  burstQueue = [];
}

/* ---------------- 内存闸门 ---------------- */

/**
 * 估算峰值是否在安全范围内。
 * @param {number} respCapBytes 响应字节上限
 * @param {number} textCapChars 正文字符上限
 * @param {number} linkCount 链接条数
 * @param {number} heapBytes 设备 JS heap 上限
 * @returns {{ok:boolean, peakBytes:number, reason:string}}
 */
function memoryGate(respCapBytes, textCapChars, linkCount, heapBytes) {
  /* CJK 3B/字 × 2 份副本 + 链接表 + 40KB 工作区 */
  var textBytes = textCapChars * 3 * 2;
  var linksBytes = Math.min(linkCount, 16) * 260 * 3;
  var workArea = 40 * 1024;
  var peak = respCapBytes + textBytes + linksBytes + workArea;
  var limit = Math.floor(heapBytes * 0.40);
  return {
    ok: peak <= limit,
    peakBytes: peak,
    reason: peak <= limit ? '' : 'peak ' + Math.round(peak / 1024) + 'KB > limit ' + Math.round(limit / 1024) + 'KB'
  };
}

/**
 * 降级方案：超预算时逐级降 respCap / textCap。
 * @returns {{respCapBytes:number, textCapChars:number, ok:boolean}}
 */
function degrade(respCapBytes, textCapChars, linkCount, heapBytes) {
  var r = respCapBytes;
  var t = textCapChars;
  var steps = [
    [respCapBytes, textCapChars],
    [Math.floor(respCapBytes * 0.75), Math.floor(textCapChars * 0.8)],
    [Math.floor(respCapBytes * 0.5), Math.floor(textCapChars * 0.6)],
    [32768, 3000]
  ];
  for (var i = 0; i < steps.length; i += 1) {
    r = steps[i][0];
    t = steps[i][1];
    var g = memoryGate(r, t, linkCount, heapBytes);
    if (g.ok) {
      return { respCapBytes: r, textCapChars: t, ok: true };
    }
  }
  return { respCapBytes: r, textCapChars: t, ok: false };
}

/* ---------------- 简单任务队列 ---------------- */

/* 优先级：0=最高（翻页/点击），1=首屏，2=剩余解析，3=落盘，4=清理 */
var queue = [];

function enqueue(priority, fn) {
  queue.push({ p: priority, fn: fn });
  queue.sort(function (a, b) {
    return a.p - b.p;
  });
}

function processQueue() {
  while (queue.length > 0) {
    var task = queue.shift();
    try {
      task.fn();
    } catch (err) {
      /* 单任务异常不影响队列 */
    }
  }
}

function queueLength() {
  return queue.length;
}

export default {
  scheduleFileOp: scheduleFileOp,
  burstPending: burstPending,
  resetBurst: resetBurst,
  memoryGate: memoryGate,
  degrade: degrade,
  enqueue: enqueue,
  processQueue: processQueue,
  queueLength: queueLength
};
