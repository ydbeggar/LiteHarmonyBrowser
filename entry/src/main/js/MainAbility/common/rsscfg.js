/**
 * 公共 RSS 源清单（方屏/圆屏共用）。
 *
 * 说明：
 * - 2026-11-26 PC 实测可访问、响应体积适合手表（除特别标注）；
 * - 手表端仍需逐源复测（部分源对移动/手表 UA 可能返回不同内容）；
 * - 36Kr 的 /feed 返回 HTML 反爬页，不纳入；
 * - IT之家 132.9 KB 偏大，作为备选不默认加载。
 */
var SOURCES = [
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed' },
  { id: 'solidot', name: '奇客 Solidot', url: 'https://www.solidot.org/index.rss' },
  { id: 'infoq', name: 'InfoQ 中文', url: 'https://www.infoq.cn/feed' },
  { id: 'cnblogs', name: '博客园', url: 'https://feed.cnblogs.com/blog/sitehome/rss' },
  { id: 'oschina', name: '开源中国', url: 'https://www.oschina.net/news/rss' }
];

export default {
  sources: SOURCES,
  DEFAULT_INDEX: 0
};
