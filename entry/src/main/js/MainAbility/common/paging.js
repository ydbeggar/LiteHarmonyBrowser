/**
 * List window paging shared by the shelf and links pages.
 *
 * FIT 5 Pro 实测：5 组 div+img 同屏只有 14fps，长列表必须切片渲染。
 * 本模块只做纯计算（无 @system.* 依赖），因此可以直接被 tools/smoke.js 覆盖。
 */

import Config from './config.js';

function sizeOf(pageSize) {
  var size = Number(pageSize);
  if (!size || isNaN(size) || size < 1) {
    size = Config.LIST_PAGE_SIZE;
  }
  return Math.floor(size);
}

function countOf(total, pageSize) {
  var n = Number(total);
  if (isNaN(n) || n <= 0) {
    return 0;
  }
  return Math.ceil(Math.floor(n) / sizeOf(pageSize));
}

/**
 * @param {number} total 条目总数
 * @param {number} page 期望页码（0 基，越界自动钳制）
 * @param {number} [pageSize] 每页条数，缺省 Config.LIST_PAGE_SIZE
 * @returns {{page:number,pageCount:number,pageSize:number,start:number,end:number,count:number,hasPrev:boolean,hasNext:boolean,label:string,offset:number}}
 */
function windowOf(total, page, pageSize) {
  var size = sizeOf(pageSize);
  var n = Number(total);
  if (isNaN(n) || n < 0) {
    n = 0;
  }
  n = Math.floor(n);
  var pages = n === 0 ? 0 : Math.ceil(n / size);

  var p = Number(page);
  if (isNaN(p) || p < 0) {
    p = 0;
  }
  p = Math.floor(p);
  if (pages > 0 && p > pages - 1) {
    p = pages - 1;
  }
  if (pages === 0) {
    p = 0;
  }

  var start = p * size;
  if (start > n) {
    start = n;
  }
  var end = start + size;
  if (end > n) {
    end = n;
  }

  return {
    page: p,
    pageCount: pages,
    pageSize: size,
    start: start,
    end: end,
    count: n,
    hasPrev: pages > 1 && p > 0,
    hasNext: pages > 1 && p < pages - 1,
    /* 单页时不显示页码，省掉底部一行 */
    label: pages > 1 ? String(p + 1) + '/' + String(pages) : '',
    offset: start
  };
}

/** 取当前页的条目切片；越界一律返回空数组，不抛错。 */
function slice(items, win) {
  var source = items || [];
  if (!win) {
    return source;
  }
  var out = [];
  for (var i = win.start; i < win.end && i < source.length; i += 1) {
    out.push(source[i]);
  }
  return out;
}

export default {
  sizeOf: sizeOf,
  countOf: countOf,
  windowOf: windowOf,
  slice: slice
};
