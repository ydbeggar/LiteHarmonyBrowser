/**
 * Global constants for the Lite Wearable reader. Dependency-free and small.
 *
 * 视觉设计：严格模仿「华为创新研究」（com.huawei.study.hiresearch.wear 1.0.2.404）
 * 的 UI 语言——纯黑底、青绿强调、玻璃胶囊卡、白字层级、无阴影无渐变，
 * 层次只靠 黑/深灰/白透明度 分层（逆向结论：两样本均不使用阴影/模糊/渐变）。
 * 颜色值取自 交付-手表动效逆向设计-v1.0/motion-tokens.json 的
 * hiresearch-gt4-466x466 令牌原值；几何按 FIT 5 Pro 408×480 方屏换算。
 *
 * 动效设计：参考微信手表版 + 华为创新研究两套动效语言（瞬时状态 + 仪式化时间轴），
 * 保证动画流畅连贯优先。全部动效遵守逆向规范第 3.3 节：
 * 只动 opacity / transform.rotate|translateY，不动布局；持续动画必有结束条件；
 * 不引入弹簧/回弹（低帧率设备上回弹最容易暴露掉帧）。
 */
var Config = {
  /* 分页正文区尺寸（common/paginate.js 使用；页面几何在各页 CSS 内硬编码） */
  BODY_H: 320,
  CONTENT_W: 376,

  /* 字号/行距档位（用户在设置页调节）。
     档位整体上移对齐华为创新研究的正文尺度（body 30px@466 圆屏 ≈ 26px@408 方屏）；
     旧档位值由 store.js 按档位序号迁移（见 normalizePrefs）。 */
  FONT_SIZES: [20, 24, 28, 32],
  LINE_HEIGHTS: [1.4, 1.55, 1.7],
  DEFAULT_FONT_LEVEL: 1,
  DEFAULT_LINE_LEVEL: 1,

  /* FIT 5 Pro 实测：fetch 吞吐 45.5 KB/s、JS heap 698 KB。
     128 KB 响应约需 2.8 秒传输，解析峰值可控。
     v3.6 堆治理（创世大站连续加载崩溃）：JerryScript 串按 UTF-8 类字节存，
     CJK 每字 3 字节——30K 字文本 = chunks 90K + join 90K + strip 副本 90K +
     常驻 90K ≈ 360K 瞬时/常驻，叠加响应 90K 与框架底座即越 698K 上限。
     12K 字（≈26 屏/章，覆盖 99%+ 小说章节）把文本管线压到 ≤108K 瞬时、
     36K 常驻；超长内容截断提示不变。 */
  /* v3.10：65536 → 48000。创世章节页实测 115~160KB（117~127K 字符），正文在
     前 31K 字符内；该站无视 Range、HEAD 预检 500 拒绝——响应必然整包序列化
     进 JS 堆（≈ 字节数），截断窗口每减 1K 字符即少 1K 堆峰值与 1K 解析扫描。
     48K 给正文留 17K 余量，同时降低"响应到达瞬间"的主线程冻结时长。 */
  /* v1.0.6：以下三项为方屏 FIT5 Pro 默认值；Layout.init 完成后会按档位覆盖
     （GT 圆屏 40K/10K/110K，API<24 老机型 32K/8K/90K），见 common/layout.js。 */
  MAX_HTML_CHARS: 48000,
  MAX_TEXT_CHARS: 12000,
  MAX_RESPONSE_CHARS: 131072,
  MAX_LINKS: 40,
  MAX_STORE_ITEMS: 50,
  MAX_FRAMES: 8,
  /* v3.5 常驻文档 2→1（创世中文网第三章加载崩溃根因之一）：
     大站页面响应可达 115K 字符，加载峰值（响应+截断副本+分块+拼接）约 240K，
     两个常驻文档（~90K）叠加旧页 VM 残留即越 698K 堆上限——ch1 无常驻、
     ch2 一个文档故存活，ch3（158KB 最大页）加载时崩溃。
     1 个常驻 = 只留当前文档，返回旧页按需重抓（Session 本就支持降级重抓）。 */
  MAX_DOCS: 1,

  /* 列表页每页条目数：玻璃胶囊大卡（92px/条）单屏只放 3 条，保证可读性与命中区 */
  LIST_PAGE_SIZE: 3,

  /* 动效令牌（对齐 motion-tokens.json global.durationMs / easing）。
     持续动画一律 CSS @keyframes（编译器与逆向样本实证支持）；内容换页用 JS 补间。 */
  MOTION: {
    ENTER_MS: 280,        /* 视图/状态入场：fade + translateY(12px→0)，ease-out */
    FADE_STEP_MS: 32,     /* 内容换页 JS 补间步进（5 步 ≈ 160ms） */
    SPIN_MS: 1500,        /* 加载旋转环一圈，linear（LW-SPIN-01） */
    BACK_SWIPE_PX: 100,   /* 右滑返回阈值（LW-BACK-01，防误触） */
    GESTURE_DEDUP_MS: 300 /* swipe 与 touch 双通道去重 */
  },

  /* 连续阅读：识别"下一章/上一页"等翻页控件。
     词表用单串 + split：snapshot 字符串池按对象计数，48 个短词合并成
     4 个长串能显著降低 jerry-snapshot 的编译期堆峰值（1.9.1 教训）。 */
  NEXT_WORDS: '下一页|下页|下一章|下一节|下一回|下一话|下章|next|nextpage|下一页>|»|›'.split('|'),
  PREV_WORDS: '上一页|上页|上一章|上一节|上一回|上一话|上章|prev|previous|«|‹'.split('|'),

  /* 移动站正文里混入的推广/翻页噪声行：只有整行短于 NOISE_MAX_CHARS 才删，
     避免误伤正文（判定见 common/html.js 的 stripNoise） */
  NOISE_MAX_CHARS: 30,
  NOISE_WORDS: '本章未完|点击下一页继续|请记住本站|本站域名|手机版阅读网址|返回目录|章节目录|加入书签|投推荐票|求收藏|求推荐|一秒记住|更新最快|无弹窗|请收藏本站|天才一秒记住|加书架|下载|领红包|试试使用|字号|夜间模式|上一章|下一章|推荐票|打赏|催更|月票|自动订阅|设置|举报|分享|报错|加入书签|存入书架|加入书架|点击阅读|全文阅读|免费阅读|手机阅读|最新章节|热门小说|推荐阅读|猜你喜欢|相关推荐|广告|更多精彩|关注我们|下载APP|客户端下载'.split('|'),

  MAX_TITLE_CHARS: 40,
  MAX_URL_CHARS: 300,
  MAX_LINK_TEXT_CHARS: 60,
  MAX_LINK_HREF_CHARS: 200,
  MIN_TEXT_CHARS: 20,
  DISPLAY_URL_CHARS: 46,

  /* 表端 TLS 握手 + 45.5KB/s 传输对慢站很紧：小说站目录页常 8 秒不够
     （1.9.1 真机 luoxiadushu 超时教训），放宽到 20 秒。
     v1.0.6 起实际超时由 common/layout.js 按设备档位覆盖：
     FIT 方屏 20s / GT 圆屏 45s / API<24 老机型 60s（见 Layout.net()）。
     这里保留 FIT 默认值，供未初始化 Layout 的纯函数/测试使用。 */
  FETCH_TIMEOUT: 20000,

  /* 请求头固定携带的压缩协商。设备实测 @system.fetch 收到 gzip 响应会自动
     解压后交给 JS，所以这里只影响传输字节数，不影响解析逻辑。 */
  ACCEPT_ENCODING: 'gzip, deflate',

  KEY_BOOKMARKS: 'lwb_bookmarks',
  KEY_HISTORY: 'lwb_history',
  KEY_PREFS: 'lwb_prefs'
  /* v3.1 清理：COLORS 常量随 applyTheme 一并移除——全站视觉值硬编码于各页 CSS */
};

export default Config;
