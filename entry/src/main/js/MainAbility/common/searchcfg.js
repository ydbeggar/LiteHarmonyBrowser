/**
 * 搜索专用常量（从 config.js 拆出：reader 不内联这些字面量）。
 */
var SearchCfg = {
  /* 搜索引擎：必应中国 RSS（选型实测见 common/search.js 头注）。
     单页响应约 6~7 KB、10 条直链结果。
     注意：只能单请求！common/net.js 的序号令牌会丢弃前一个未完成请求的回调，
     并发两个 fetch 会让先发的那个永久不回调（1.5.0 真机卡「正在搜索」的根因）。 */
  URL_BASE: 'https://cn.bing.com/search?format=rss&q=',
  MAX_RESULTS: 10,
  TITLE_CHARS: 40,
  /* 控件副标题 = 摘要截断（一行）；完整摘要上限给摘要视图展示 */
  SUBTITLE_CHARS: 28,
  SUMMARY_FULL_CHARS: 600
};

export default SearchCfg;
