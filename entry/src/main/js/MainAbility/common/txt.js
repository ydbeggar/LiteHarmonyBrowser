/**
 * 界面文案与站点常量（从 config.js 拆出：reader 只内联自己的 5 条短文案）。
 * v3.1 清理：INVALID / SAVE_FAIL / ADDR_EMPTY / TEST_LABEL 四条历史文案零引用已删。
 */
var Txt = {
  BOOKMARKS_EMPTY: '暂无书签',
  HISTORY_EMPTY: '暂无历史',
  CLEAR_HISTORY: '清空历史',
  CLEAR_CONFIRM: '再次点击确认清空',
  PREFS_FAIL: '设置保存失败，本次仍生效',

  /* 内置联网测试站（手机版轻小说页面：正文短、结构简单，便于验证联网链路） */
  TEST_URL: 'https://m.sfacg.com/c/9864296/'
};

export default Txt;
