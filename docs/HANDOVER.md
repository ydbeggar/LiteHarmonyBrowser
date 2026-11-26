# 交接说明（新会话从这里开始）

> 本文件记录开发主线状态，**最后更新 2026-11-26**；最新变更见「五之四十」，当前主版本 **v1.1.1（1101）**（P2 流式解析 + P3 章文件分页 + 小说搜索 + GT 受限档回退；v1.0.4/1.0.5 已弃用）。
> 2026-11-26 恢复档案（会话丢失后重建，含完整证据索引）：`内部恢复档案（不随仓库发布）`。
> 结论分两类并明确标注：**真机实测**（WATCH FIT 5 Pro）与**本机构建/脚本验证**。
> 未经真机复验的新改动会单独标「待真机确认」。

## 一、项目现状

| 项 | 值 |
|---|---|
| 工程 | `<repo>` |
| bundleName | `com.example.litewearbrowser` |
| 应用名 | **轻鸿浏览器**（`AppScope/res/element/string.json` 与 `entry/.../element/string.json` 两处；图标为 2026-11-04 新换的 92×92 蓝底书本图，三处 media 均已替换） |
| 版本 | **versionCode 1101 / versionName 1.1.1**（关于页 `Release V1.1.1`；P2/P3 + 小说搜索 + GT 受限档回退；v1.0.4/1.0.5 已弃用） |
| 目标设备 | HUAWEI WATCH FIT 5 Pro **408×480 方屏** + HUAWEI WATCH GT 系列 **466×466 圆屏**（圆屏走 `pages/round/*`；发布页标注兼容 GT7/GT6/FIT4/GTR2/FIT5） |
| 页面 | 方屏 7 个业务页 + 首页；圆屏独立页 7 个（reader/search/links/shelf/settings/offline/novel；首页在 index 内分支） |
| 公共模块 | `common/`：config / layout / searchcfg / txt / navrule / url / html / paginate / pagesink / pagestore / scheduler / paging / gesture / fade / crown / sway / fsutil / store / session / route / net / search / saved / space / linkpass / screen |
| 本地存储 | `@system.file` 单文件数据集（store v3.4：bm/hs/pf.txt，3900B 自截断）；`fsutil` 全局 FIFO 串行 + 16ms 调用间隔；离线正文 `saved.js`（片 ≤1200 字、单次保存 ≤6 次调用）；P3 章文件 `internal://app/read/<key>.txt/.idx`（仅完整档）；网页缓存已删除（v3.3） |
| 小说站导航 | `common/navrule.js` + `html.js` 提取 `startHref`（「开始阅读」类）与 `chapters`（「第x章」类，≤40 条、章节优先）；reader 书名/目录页给「开始阅读 ›」「目录」直达控件；「上一章/下一章」走原有 NEXT/PREV 词表；links 页章节置顶 |
| 构建产物 | `dist/unsigned/LiteHarmonyBrowser-v1.1.1-unsigned-final.hap`（67 条目）与同名 `.app`（3 条目） |
| 交付包 | `dist/unsigned/LiteHarmonyBrowser-v1.1.1-unsigned-final.hap`（482,932 B）与同名 `.app`（468,480 B）；交付说明见 `轻鸿蒙开发\交付-轻鸿浏览器-v1.1.1\交付说明.md`；桌面同步放 `.app` |
| SHA256 | hap `885B66FB2B3FDC4BA2620E14C7A0D2814E5ED7BFEC466D19350CD0A5126CC75F`<br>app `71EDC3F52FDCBE64E3210E2B9EB74EF7CD3A738CBB0015B39C67E7F12F7E5222` |
| 签名 | `build-profile.json5` 已配置手动签名 `signingConfigs`（fit5pro.p12 / .cer / .p7b，SHA256withECDSA），**未绑定 product**，命令行只出未签名包；真机安装须用 **bin 格式 HAP**（见五之三十七） |
| 档位 | compile `26.0.0` / target `5.0.0(12)` / compatible `4.0.0(10)` / minPlatformVersion 10 |

> 打包脚本对 zip 条目使用固定时间戳，**同样的输入 hap 会产出同样的字节**，上面两个 SHA256 可直接用于回归比对。

## 二、可安装包的必要条件（血泪经验，缺一不可）

> **2026-11-07 更新**：真机安装已确认**必须使用 bin 格式 HAP**（外层仅 1 个 `signed.bin`，见「五之三十七」）。
> 本节 1~8 条是 ZIP 包时代的字段经验，仍适用于生成本地 HAP/调试，但**不能直接用于 Lite 真机安装**。

1. **`i18n/en-US.json` + `i18n/zh-CN.json`** 必须存在（`js/MainAbility/i18n/`）——缺了装不上；
2. **`resources/base/media/icon_small.png`**（92×92）必须存在——缺了装不上；
3. `config.json` 的 `deviceConfig` 必须是 `{"default": {}}`（打包补丁里再置 `{}`）；
4. `config.json` **不要手写 `apiVersion` 的目标值**，以 `build-profile.json5` 的 `targetSdkVersion` / `compatibleSdkVersion` 为准；
5. 打包 `.app` 时需给 hap 内 `config.json` 补 `module.package` / `module.mainAbility` / `app.apiVersion.compileSdkType` / `app.apiVersion.compileSdkVersion` / `app.appEnvironments`（hvigor 26 对 liteWearable 会主动删除）；
6. `.app` 结构：`entry-default.hap` + `pack.info` + `pac.json`（`{"dataProcess":[],"specialAPIs":[]}`），hap 内也要嵌一份 `pack.info`；
7. `manifest.json` 不能带 `compatibleSdkVersionStage`（即使值是空串也要删）；
8. `pack.info` 的 `modules[].apiVersion` 要删。

> 第 5~8 条已全部自动化：`tools/pack-app.ps1`（见第七节），不要再手工改包。

## 三、Lite Wearable 运行时约束（真机实测）

| 主题 | 结论 |
|---|---|
| 路由 | `@system.router` **只有 `replace` 可用**；`push`/`back`/`getParams`/`getLength` 是 ArkUI.Full，调用即抛 `TypeError: Expected a function` |
| 跨页传参 | 模块级变量**不跨页面共享**（每页独立 bundle）；用 `globalThis`（同步）+ `@system.storage`（异步兜底），见 `common/route.js` |
| `this.$refs` | **不可用**（undefined） |
| input 事件 | 只有 `change`；**实时触发**，回调参数是**字符串本身**（不是 `{value}`）；输入框不能用 `ref` 取值 |
| `render` 方法名 | **ACELite 保留方法名**，页面对象定义 `render()` 会覆盖框架实现并抛错，用 `refresh` / `refreshView` 等替代 |
| `@system.brightness` | d.ts 标了 Lite，但运行时是 `undefined` |
| gzip | **支持自动解压**（带 `Accept-Encoding: gzip` 返回解压后内容） |
| 单页 JS 上限 | **安装期：≤112 KB 可装、≥120 KB 安装失败/卡死**；运行期另受 JS 堆（698 KB）约束，见本节末「知识条目」 |
| 手势事件 | 公共事件白名单只有 `click longpress touchstart touchmove touchcancel touchend key swipe`（SDK `lite_component_map.js` 的 `liteCommonTag.events`，已核对源码）。绑在根节点上会编译成 `onBubbleEvents`，子节点事件可冒泡上来。**swipe 与 touchstart/touchend 真机均正常派发**（1.3.1 诊断页实测通过） |
| 并发 fetch | **禁止同时发起多个 `Net.fetchText`**：`common/net.js` 的序号令牌会把前一个未完成请求的回调静默丢弃（`mySeq !== seq` 直接 return），页面会永久卡在加载态。1.5.0 真机「一直正在搜索」的根因。需要多份数据只能**串行**请求（前一个回调里再发下一个） |
| `@system.storage` | **单 value 硬限制 128 字节、key ≤32 字符**（技能文档明确）。大 JSON 写入会失败且无感知（1.5.x「结果已失效」根因）。跨页大数据**不可存**：globalThis 不可靠、storage 存不下、file.readText 有 4096B 限制。**唯一可靠做法：数据留在页面内存（同页双视图）或跨页时重新请求**。路由参数（几十字节）可用 |
| `@system.file` 缓存 | `file.writeText` 的 `append` 分批追加可靠；`file.readText` **默认 length 4096，超 4KB 可报 302**（读必须分片），且 **position 偏移是字节还是字符官方未验证**——`common/cache.js` 用 `probe()` 写后自校验一次（比对中文位置的内容）判出语义并存 storage（`lwb_cm`），`load/loadRange` 按语义推进；探测失败或文件缺失一律降级内存路径，功能不回退。file API 本身真机可用性**已实证**（2026-11-05 能力检测：`system.file` 12 方法全在；模拟器仍不可用），缓存链路前提成立 |
| 表冠 | **真机已否决：key 事件完全不派发**（1.3.1 诊断页转表冠自检行始终无 `key` 行）。SDK 里表冠相关只有 `list`/`swiper`/`picker` 的 `rotation({focus})` 方法，而 `$refs` 实测为 `undefined`。**表冠控制设计已取消**，代码中的 key 通道已全部删除，勿再引入 |
| CSS 动画 | **类选择器 CSS 完整支持 `@keyframes` + `animation-*` + `transform(rotate/translateY)`**（2.0 已投入使用；编译器 `lite-transform-style.js` 显式处理 `@KEYFRAMES`，逆向样本真机实证）。注意：`animation-timing-function` 仅 `linear/ease-in/ease-out/ease-in-out`；`animation-direction: alternate` 不在枚举（呼吸用三段 keyframes 模拟）；CSS `transition` **不支持**；复合选择器 `.a.b` 未证实（用多个单类选择器层叠代替）；`transform` 不进内联 styleMap，只能写类 CSS |
| `if/elif/else` 布局 | **条件节点不参与父级 flex 流，渲染在父容器原点**（2.0 真机截图实证：搜索详情内容从 y≈0 叠在页头下）。**条件块必须整屏视图化（自带页头 408×480）或放进 `stack` 用 `left/top` 定位**；需要占位的条件元素（旋转环、按钮）要放进固定尺寸的普通容器里。`setData` 重渲染会打断 CSS 动画（旋转环"1 秒即停"根因）→ 用 A/B 节点定时交换保活，并给回调用"数据未变即跳过"守卫 |

> **能力基线修正（2026-11-05，重要）**：FIT 5 Pro 性能与系统 API 高于 FIT4/GT4 且**向下兼容**；逆向样本（微信 FIT4 / 华为 GT4）真机验证过的能力，**即使未在 Lite 声明也可用**。不要按 SDK 白名单自我阉割——验证优先级：样本实证 > 白名单声明 > 保守猜测。

> **知识条目（2026-11-05 补充）：单页 JS 的 112 KB 是安装期门槛，不是运行期安全线**
>
> - **安装期**：打包/安装器校验的是单页**编译产物的字节数**——≤112 KB 可安装，≥120 KB 安装失败或启动卡死。这条只回答「装不装得上」。
> - **运行期**：单页实际能否加载与执行，取决于 **JS 堆**（FIT 5 Pro 实测 715,000 B ≈ 698 KB，峰值预算建议 ≤280 KB）。页面 bundle、正文 `doc`、HTML 解析中间量、缓存与搜索结果**共享同一个堆**。
> - **结论**：装得上 ≠ 跑得动。评估新页面要同时看「编译产物体积」与「该页峰值堆占用」；接近 112 KB 的页面即使安装成功，也可能在解析/渲染时触顶 OOM，或被 GC 拖成卡顿。
> - **实操**：优化优先砍**常驻对象**（整篇正文、结果列表、长字符串、重复缓存副本），而不是只盯 bundle 大小；新增大页面必须真机跑一遍，观察是否卡顿/重启。

## 四、性能参数（真机实测，详见 `docs/device-fit5pro.md`）

- 屏幕 408×480 / 195 dpi / rect，**四角圆角半径约 96px**，安全区：标题 y48-96、内容 y100-410（宽 376）、底部 y414-456（宽 320）；
- JS heap **715000 B ≈ 698 KB**；fetch 吞吐 **45.5 KB/s**；单次可返回 ≥1.3 MB（失败原因不是体积上限）；
- 运算约 3-4 万 OPS；`for...in` 只有 4,947 OPS（慢 6 倍，**禁用**）；
- 渲染：1 组 div+img 22fps、2 组 19fps、5 组 14fps（列表必须分页）。

## 五、本轮（1.3.0）改动

1. **gzip 常驻**：`common/net.js` 的请求头加 `Accept-Encoding: gzip, deflate`（值集中在 `Config.ACCEPT_ENCODING`）。保留 `Range` 分片，理由与冲突处理写在代码注释里：主流服务器对 206 响应会跳过压缩，万一某站压缩后再切片，解压后的正文由 `MAX_RESPONSE_CHARS` 长度检查兜住并提示「页面内容过大」。
2. **列表分页**：新增纯函数模块 `common/paging.js`（`windowOf` / `slice` / `countOf`），`shelf` 与 `links` 均改为每页 `Config.LIST_PAGE_SIZE`（=10）条，底部有 `‹ 1/5 ›` 分页器；删除/清空/切换 tab 后页码自动钳制。
3. **正文能力增强**（`common/html.js`）：
   - 翻页控件识别新增 `title` / `aria-label` 兜底（很多站点锚文本只有一个 `›` 符号）；
   - 新增 `stripNoise`：只删「整行短于 `Config.NOISE_MAX_CHARS`（=30）且命中 `NOISE_WORDS`」的推广/翻页噪声行，长段落不误伤。
4. **测试修复**：`tools/smoke.js` 在 `sample.js` 删除后就崩（引用已删模块），已移除 sample 用例并修掉 3 条过期断言（`isSampleUrl`、50000 字上限、`CONTENT_W`）；新增 paging 7 条、html 4 条用例，**当前 42 条全绿**。
5. **构建脚本**：新增 `tools/build.ps1`（冒烟 → hvigor → 打包一条命令）与 `tools/pack-app.ps1`（第 5~8 条补丁 + 组装 `.app`，固定时间戳可复现）。
6. **版本号**：1.0.1(1001) → **1.3.0(1004)**，避免与手表上可能已装的 1.2.0(1003) 冲突（降级会安装失败）。
7. **shelf 列表高度修正**：原 `.list` 高 360px 会让底部约 72px 落到安全区（456）之外、被屏幕圆角裁掉；改为 280px 高 + 56px 行高，正好 5 行整行显示，`empty` 态同步改为 280px。

本轮打包后各页面 bundle 体积（`intermediates/lite_source` 编译产物）：reader 45.3 KB、shelf 26.4 KB、settings 21.8 KB、links 20.8 KB、index 19.9 KB、diag 10.9 KB、app 8.5 KB —— 全部远低于 112 KB 上限。

## 五之二、1.3.1 → 1.4.0 改动

### 1.3.1（真机已验证）
- 诊断页可返回（页头 `‹` + 底部按钮 + 右滑 + 返回键）；全局右滑返回；reader 取消左右翻页、只留上下滑动 + 上下半屏点击兜底；swipe 与触摸轨迹双通道（300ms 去重）。
- 真机诊断结果：**fetch / gzip / 手势全部通过；表冠检测失败（key 事件不派发）**。

### 1.4.0（本机验证 + 待真机）
1. **表冠控制设计取消**：各页删除 `onkey` 绑定与 `onKey` 方法；`gesture.js` 删除 key 通道（`keyStep`/`keyCodeOf`/`isBack`/`NAME_TO_CODE`）；诊断页自检行改为只观察 swipe/touch。
2. **搜索功能**（新页面 `pages/search/search`）：
   - 自绘搜索框（`input type=text`）+ 自绘搜索按钮（div）；
   - 提取前 10 条网页结果（标题 / 摘要 / 站点），list 滚动展示，点击结果进 reader 打开直链；
   - 手势：右滑返回；失败态可重试；空态提示换关键词。
3. **搜索引擎选型**（用户放开引擎限制，按"轻量 + 省流量"重选，本机抓包实测同一关键词）：

   | 引擎 | 响应体积 | 结果区位置 | 结论 |
   |---|---|---|---|
   | **cn.bing.com RSS** | **6~7 KB** | 全文即结果 | **采用**：10 条 `<item>`、直链无跳转、摘要纯文本 |
   | m.sogou.com | 240~470 KB | 17K~136K 波动 | 结果区偏移不稳，128KB 截断可能全切掉 |
   | m.baidu.com | 1.9 MB | 1.28 MB | 不可用 |
   | so.toutiao.com | 1.8 MB | 无固定结构 | 不可用 |
   | m.so.com（360） | 340 KB | 230 KB | 太重 |

   必应 RSS 比搜狗省 **97%** 流量、比百度省 **99.6%**；响应小于通用 128KB 截断，无需放宽任何上限。5 个关键词（轻小说/鸿蒙开发/北京天气/python 教程/设备名）实测均返回 10 条直链结果。解析器 `common/search.js` 纯函数、无正则字面量、支持实体解码与百分号编码兜底，smoke 5 条用例覆盖。
4. **首页**：地址栏增加搜索兜底（输入不含点/冒号/斜杠或含空格 → 进搜索页）；「最近阅读」区块改为「搜索」入口。
5. **jerry-snapshot 工具坑**：构建工具 `jerry-snapshot.exe` 自身堆只有 **64KB**，编译产物过大时报 `ERR_OUT_OF_MEMORY`、`.bc` 快照缺失（运行时退回解析 .js，功能正常但每次进该页慢 0.3~0.8s）。**阈值不是纯源码字节数**（与字符串池构成相关）：45,276B 失败过、47,334B 通过过。**现状（1.9.1）：reader.js 50,764B 超限，reader.bc 长期缺失**（功能正常，进阅读页慢 ~0.5-1s；已试过 config 瘦身/词表合并/url 拆分均无效，恢复快照需拆 html.js，见五之九）。其它页（≤29KB）快照正常。**改 reader.js 后确认构建日志无 `Failed to convert the reader.js file to a snapshot` 变化即可**。
6. **版本号**：1.3.1(1005) → **1.4.0(1006)**。

本轮 bundle 体积：reader 43.7 KB（含 reader.bc 37.5 KB）、shelf 24.8、search 23.6、settings 20.2、index 19.4、links 19.2、diag 9.4、app 8.6 —— 全部远低于 112 KB 上限。

## 五之三、1.4.0 → 1.5.0 改动（本机验证 + 待真机）

1. **应用图标更换**：用户提供的 92×92 蓝底书本图替换三处 media（`entry/.../icon_small.png`、`entry/.../icon.png`、`AppScope/.../app_icon.png`），构建产物内已确认新图与新名。
2. **应用更名**：「轻鸿蒙浏览器」→「**轻鸿浏览器**」，运行时文案全改（两份 string.json、index.hml 标题、reader 默认标题、install.md）；spec/plan/tasks 历史存档保留原名。
3. **搜索结果 20 条**：`SEARCH_MAX_RESULTS` 10→20。实测 `count=20` 参数无效、**`first=11` 取第二页有效**，搜索页并发请求两页（各 ~6KB）后 `Search.mergeResults` 按 url 去重合并（总量 14KB，仍省流量）。
4. **结果控件改版**：每条控件只显示**主标题 + 副标题**两行（50px/条），不再显示网址；副标题 = 摘要截断（`SEARCH_SUBTITLE_CHARS` 28 字）。
5. **新页面 `pages/detail/detail`（网页摘要）**：
   - 展示主标题、副标题、**完整摘要**（`SEARCH_SUMMARY_FULL_CHARS` 260 字，外层 `overflow: scroll` + 内层 text 高度按行数动态计算）与**网址**；
   - **访问**控件 → reader 打开该网址；**返回**控件 → 回搜索结果页；
   - 返回带 `restore: 1` 标记，搜索页从缓存恢复结果**不重新搜索**。
6. **`common/searchcache.js`（新）**：搜索结果跨页缓存，globalThis（同步）+ `@system.storage`（异步兜底）双通道，载荷 `{query, items}`。摘要页缓存为空时给「结果已失效」空态。
7. **搜索结果分页**：20 条按 `LIST_PAGE_SIZE` 10 条/页分 2 页（`‹ 1/2 ›` 分页器），点击条目传**全量索引**（`pageStart + index`）给摘要页。
8. **版本号**：1.4.0(1006) → **1.5.0(1007)**。

本轮 bundle 体积：reader 43.7 KB（快照 37.6 KB）、search 27.8、shelf 24.8、settings 20.2、index 19.8、links 19.3、detail 10.5、diag 9.4、app 8.9 —— 全部远低于 112 KB 上限；8 页快照（.bc）全部生成，jerry-snapshot 无告警。

## 五之四、1.5.1 真机故障修复：搜索卡「正在搜索」

**真机现象**（1.5.0）：点击搜索后永远停在「正在搜索…」，无结果也无失败提示。

**根因**：1.5.0 为取 20 条并发发起了两个 `fetchText`（第一页 + `first=11` 第二页），而 `common/net.js` 的**序号令牌是单请求语义**——每次调用自增 `seq`，回调里 `mySeq !== seq` 直接丢弃。第二个请求一发起，第一个请求的响应被静默吞掉，`finish()` 永远等不到 `page1`，加载态永不结束。`count=20` 参数实测无效才是被迫双请求的原因。

**修复**（按需求回退 10 条）：
1. `SEARCH_MAX_RESULTS` 20→**10**，`buildUrl` 去掉分页参数，删除 `mergeResults`；
2. 搜索页 `doSearch` 回到**单请求单回调**（parse → 缓存 → 渲染），网络失败/解析失败都会落到失败态或空态，不会再无限加载；
3. `restoreFromCache` 加防重入（takeSync/takeAsync 双通道可能各触发一次）；
4. 新控件设计（双行控件、网页摘要页、访问/返回、结果保留）全部保留，10 条一页分页器自动隐藏；
5. 约束固化到第三节运行时约束表（**禁止并发 fetchText**）与 `Config` 注释，防止后续会话重蹈覆辙。

冒烟 52 条全绿（删 merge 用例），8 页快照齐全。

## 五之五、1.6.0：「结果已失效」修复 + 黑底蓝字改版（本机验证 + 待真机）

**真机现象**（1.5.1）：点击结果条目显示「结果已失效 搜索结果缓存不存在」。

**根因**：1.5.x 的 `searchcache.js` 把 10 条结果（~4KB JSON）存 `@system.storage`——**storage 单 value 硬限制 128 字节**（技能文档明确），写入静默失败；`globalThis` 通道也不可靠（Lite JerryScript 无 ES2020 globalThis）。两条通道全断，摘要页读不到缓存。而路由参数（几十字节）一直正常，所以问题只出在"大数据跨页"。

**修复（消灭跨页数据传递）**：摘要页改为 **search 页内的第二视图**（同页 `if/elif` 切换）：
- 点击条目 → 同页切摘要视图（数据直接取页面内存，零传递零请求）；
- 「返回」→ 同页切回列表视图，**结果与页码原样保留**（比任何缓存都可靠）；
- 「访问」→ 跳 reader；
- 删除 `common/searchcache.js` 与 `pages/detail/detail`（8 页 → 7 页）。

**黑底蓝字改版**（Apple Watch / 华为手表系统应用风格）：
- 全局：纯黑背景 `#000000`、蓝色文字 `#64B5FF`、苹果蓝 `#0A84FF`、深灰卡 `#1C1C1E`、苹果红 `#FF453A`；`DEFAULT_THEME: 'dark'`（reader 走主题色系统，settings 可切回浅色）；
- search 页大字重构：搜索框 48px 高、按钮 48px、结果条目 60px（主标题 19px 蓝 + 副标题 13px 灰，不显示网址）、**每页条目 10→4 条**（`SEARCH_PAGE_SIZE`）保证可读性、分页按钮 48×40 大命中区；
- 摘要视图：主标题 20px 白（2 行）、副标题 14px 蓝、完整摘要 16px/24px 可滚动、网址 13px 灰、**访问/返回胶囊按钮 52px 高**；
- index/shelf/links 静态 CSS 同步黑化；所有可点控件 ≥44px 命中区。

版本 1.6.0(1009)。冒烟 51 条全绿，7 页快照齐全。

## 五之六、1.7.0：主题统一 + 华为风大控件 + 去主题切换

1. **主题统一（唯一一套）**：`Config.THEMES` 双主题删除，改为单一 `Config.COLORS`（黑底 #000000 / 蓝字 #64B5FF / 白标题 #FFFFFF / 苹果蓝 #0A84FF / 深灰卡 #1C1C1E / 苹果红 #FF453A）；`DEFAULT_THEME` 删除。
2. **去除主题切换**：settings 页删除「深色主题」开关与 `onThemeToggle`；`store.js` 的 prefs 去掉 `theme` 字段（历史数据中的 theme 直接忽略）；reader `applyTheme()` 固定用 `Config.COLORS`。settings 只保留字号/行距调节。
3. **控件全面增大（华为手表系统应用风格）**：
   - 页头统一 52px（返回键 52×52、标题 22px 白）；
   - 按钮统一 52px 高、16px 圆角、19~21px 字（搜索/打开/访问/返回/重试/翻页）；
   - 输入框 52px 高、18px 字、16px 圆角；
   - 列表项统一 72px（主标题 21px + 副标题 15px，16px 圆角，命中区大）；
   - 分页按钮 56×48；设置页选项 58px 高、18px 字。
4. **字号档上调**：`FONT_SIZES` [16,18,20,22] → **[18,20,22,24]**（默认档 20）；`store.js` 默认 fontSize 18→20。
5. **每页条目数统一 3**：`LIST_PAGE_SIZE` 10→**3**（大字单屏全显），搜索/shelf/links 全部走同一常量（`SEARCH_PAGE_SIZE` 删除）。
6. **首页改华为风大列表**：4 个 section + foot 改为 5 项 72px 大菜单（搜索网页/我的书签/浏览历史/内置测试站/环境诊断），list 滚动浏览；地址栏 52px + 「打开」大按钮。
7. **阅读页尺寸重排**：hdr/ftr 各 52px、正文区 292px、上下翻页热区 130px、「下一章」胶囊 44px。
8. **版本号**：1.6.0(1009) → **1.7.0(1010)**。

冒烟 51 条全绿（分页用例改显式页宽并补默认 3 条/页断言），7 页快照齐全（reader.js 44.3KB 未触 jerry-snapshot 红线），审计无 ERROR。

## 五之七、1.8.0：去环境诊断 + 过渡动画 + 界面美化

1. **环境诊断功能移除**：删 `pages/diag/`（页/样式/逻辑），config.json 注册移除，首页菜单「环境诊断」项删除（菜单 5→4 项）。gzip/联网/手势的真机验证结论已固化在第三节，诊断工具完成使命。
2. **过渡动画**（Lite 无 CSS transition——SDK styleMap 白名单里没有 transition/transform/animation，已核对）：新增 `common/fade.js`，**3 步 opacity 淡入**（0.25 / 0.6 / 1.0，45ms/帧，单次过渡 <100ms，只写一个数字字段不阻塞交互）。接入点：
   - 首页菜单进入、搜索结果加载/失败/空态、列表↔摘要视图切换；
   - 阅读页每次翻页（正文换页淡入）；
   - shelf/links 每次加载与翻页、settings 进入；
   - 全部页面 `onDestroy` 里 `Fade.cancel` 清定时器（技能要求生命周期清理）。
3. **界面美化**（华为手表系统应用风格细节）：
   - 列表条目统一加**左侧 6px 苹果蓝强调色条**（圆角 3px）+ **右侧 › 箭头**（26px 蓝）；
   - 搜索状态行改为**居中胶囊徽章**（深灰底圆角 12）；
   - 条目内部结构统一：色条 + 文本列（主标题白/蓝 21px + 副标题灰 15px）+ 箭头；
   - 首页菜单、搜索结果、书架、链接四类列表卡片样式完全一致。
4. **版本号**：1.7.0(1010) → **1.8.0(1011)**。

冒烟 53 条全绿（新增 fade 2 条），6 页快照齐全（diag 已移除），审计无 ERROR。**注意 reader.js 已到 45,017B（jerry-snapshot 红线约 45.3KB），余量仅约 250B**——已手动验证快照可生成，后续改 reader 需盯这个数。

## 五之八、1.9.0：本地缓存 + 分批读取

1. **`common/cache.js`（新）**：基于 `@system.file` 的本地缓存层——
   - **分批写入**：`writeText(append)` 逐批追加（3000 字/批），append 语义可靠无切片风险；
   - **分批读取**：`readText(position, length)` 分片（2500 字/片）拼接整文件；`loadRange(from, len)` 按字符区间读一片（长文本翻页用）；
   - **语义探测**：readText position 是字节还是字符官方未验证 → `probe()` 用写入样本在「字符偏移≠字节偏移」的中文位置自校验一次，结论存 storage（`lwb_cm`，跨页共享），`load` 按语义推进（字符偏移用返回长度、字节偏移用 UTF-8 字节计数）；`loadRange` 仅字符语义下启用，否则返回空；
   - **容量管理**：LRU 6 组，key 列表存 storage（短 ASCII key 逗号拼接 ≤128B），超限删最旧文件；
   - **全链路降级**：file API 失败/语义探测失败/文件缺失一律回调空串，调用方走内存路径，功能零回退。
2. **reader 接入**：
   - **HTML 缓存**：抓取成功后台写缓存（分批）；二次打开同 URL **命中缓存免流量免等待**；「重试」按钮强制走网络并刷新缓存；
   - **正文缓存**：install 后写入并探测语义；翻页 `renderAt` 在字符语义下**按页从缓存文件提取**（一次只读 2KB 片段），读不到自动降级内存切片——「长文本从本地缓存分批提取」的真实路径。
3. **config.js 拆分减重**（为 cache.js 腾体积）：`SEARCH_*` → `searchcfg.js`、`TXT`/`TEST_*` → `txt.js`（reader 自留 5 条短文案字面量）；app.js 也连带变小。
4. **jerry-snapshot 红线认识修正**：阈值与**字符串池构成**相关而非纯字节数——TXT 大表拆出后 reader.js 47,334B 反而快照成功（40,538B .bc），旧的「45.3KB 红线」不准确，已在风险清单更正。
5. **版本号**：1.8.0(1011) → **1.9.0(1012)**。

冒烟 **59 条全绿**（新增 cache 6 条：keyOf/分批写/字符语义/字节语义/分片读/容量淘汰），6 页快照齐全（reader.bc 40.5KB 手动复验通过），审计无 ERROR。

## 五之九、1.9.1：真机问题三连修（假超时 / 缓存加固 / 小说站阅读流）

**真机现象**：① 没有秒开；② 打开 `https://luoxiadushu.com/longzu/` 显示「加载失败 服务器响应超时」；③ 电子书站只能停在书名页，无法进入阅读。

1. **假超时根因（①②同源）**：cache.js 的 `file.*` 调用没包 try/catch——`@system.file` 在真机调用抛异常时，`Cache.save` 把 fetch 的 `onBody` 炸掉，8 秒后超时计时器兜底显示「超时」，实际服务器早已返回。**修复**：cache.js 全部 file 调用 try/catch、`once()` 一次性回调、`load/loadRange` 600ms 兜底计时，异常一律降级空值——缓存故障再也不可能拖垮抓取/阅读主链路（smoke 新增「file exceptions never break callers」用例锁死）。
2. **缓存语义补课（①）**：HTML 缓存此前从未 `probe`（语义只在正文 save 后探测）——改为 **save 成功后语义未定时自动 probe**（save 拥有原文，是探测的唯一可靠时机），`load` 推进不再依赖猜测；显式 probe 改为总是重测（可复核真机语义）。
3. **超时与大页面（②）**：`FETCH_TIMEOUT` 8s→**20s**（表端 TLS 握手 + 45.5KB/s 对小说站大页面太紧）；超限响应从「判失败」改为**截断放行**（解析器天然容忍残缺页面，至少能看到目录/前几段）。
4. **小说站阅读流（③）**：
   - 新增 `common/navrule.js`：识别「开始阅读/立即阅读…」类文本与「第x章/节/回/话/卷」类章节标题（无正则，indexOf/charAt）；
   - `html.js` 提取 `startHref`（「开始阅读」链接）与 `chapters`（章节链接 ≤30 条）；
   - **reader 书名/目录页专用视图**（判定：有 startHref，或章节 ≥3 条且正文 <1000 字）：显示书名 + 简介 + **「开始阅读 ›」大按钮**（直达第一章，startHref 优先、否则首条章节）+ **「目录」按钮**（进链接页）；「上一章/下一章」走原有 NEXT/PREV 词表续读；
   - **links 页章节置顶**：「第x章」类链接排最前，目录直达阅读更顺手。
5. **词表合并**（快照抢救尝试）：NEXT/PREV/NOISE/START 48 个短词表改「单串 + split」，snapshot 字符串池对象数 48→4（效果有限，仅 52B）。
6. **版本号**：1.9.0(1012) → **1.9.1(1013)**。

**已知状态：reader.js 50,764B 已超 jerry-snapshot 工具堆承受范围，reader.bc 长期缺失**——功能完全正常（JS 运行时解析），代价是每次进阅读页慢约 0.5~1s。已排除的抢救方案：config 死常量清理（省 166B）、词表合并（52B）、url.js 拆分（`resolve` 5 处依赖 `normalize`，拆不动）。若未来要恢复快照：把 html.js 拆成「正文最小核 + 富文本处理」两层，或砍噪声剔除/实体解码功能（均不建议）。

冒烟 **64 条全绿**（新增 navrule 2 条、html 导航 2 条、cache 异常兜底 1 条），审计无 ERROR。

## 五之十、2.0.0：视觉与动效重构（本机验证 + 待真机）

**设计依据**：`交付-手表动效逆向设计-v1.0`（微信手表版 1.1.0 FIT4 / 华为创新研究 1.0.2.404 GT4 逆向）。
**设计原则**：严格模仿华为创新研究 UI；动效参考微信 + 华为；动画流畅连贯优先。详见 `docs/design-v2.md`。

1. **图形重构**（华为创新研究令牌原值）：黑底 `#000000` + 青绿强调 `#00A5AD`/`#00BCC5` + 玻璃胶囊卡 `#26FFFFFF` + 白字层级 `#FFFFFF`/`#A8A8A8` + 危险 `#F15B58`；全控件胶囊化（radius=高/2）；去掉 v1.x 苹果蓝系与左侧色条。六页 CSS/HML 全部重写。
2. **动效系统三通道**（同曲线同时序，`Config.MOTION` 令牌）：
   - CSS 入场 `lwb-in`（280ms ease-out，opacity+translateY 12px）：`if` 插入状态/视图节点自动播放；
   - CSS 翻页 `lwb-turn`（160ms 纯淡入）：reader **A/B 双缓冲**文本层，`if` 切换重插即重播——每页翻动都是 CSS 动画，比 JS 补间更流畅；
   - JS 补间 fade.js（5 步 ×32ms ease-out）：列表翻页等同节点内容换页场景；
   - 加载旋转环：纯 CSS 圆环 + `border-color` 四段 + rotate 1500ms linear（零素材、零 $refs）。
   - 右滑返回阈值 44→**100px**（LW-BACK-01 微信实证防误触）；禁弹簧/回弹。
3. **字号档位上移**（对齐华为创新研究正文尺度）：`FONT_SIZES` 18/20/22/24 → **20/24/28/32**，`LINE_HEIGHTS` 1.5/1.7/1.9 → **1.4/1.55/1.7**；store.js 按**档位序号**迁移旧偏好（18→20、22→28、1.5→1.4、1.9→1.7；重叠值 20/24/1.7 保持）。
4. **设置页去 radio**：胶囊选项卡（选中青绿实心 + 白字），点按即选；书架分段控件同款。
5. **快照问题自愈**：reader.js 50,935B（较 1.9.1 略增）但 **reader.bc 42,742B 生成成功**——移除 Fade 依赖改变了字符串池构成，印证「阈值与字符串池构成相关而非纯字节数」。**6 页快照全部齐全**，冷启动慢的问题消失。
6. **冒烟 66 条全绿**（新增 legacy prefs 迁移 1 条、swipe distance 阈值 1 条，fade/gesture/prefs 断言更新）。
7. **版本号**：1.9.1(1013) → **2.0.0(2000)**。

构建产物（`dist/unsigned/`）：hap 161,032 B `C5A36107…`、app 153,008 B `D07975F9…`（25 条目）。
各页 JS：reader 50.9、search 29.7、shelf 26.3、links 21.0、index 19.4、settings 16.8、app 7.6 KB——全部远低于 112 KB。

**待真机**：CSS 动画帧率（入场/翻页/旋转环）、新字号档位观感、胶囊控件命中区手感、右滑 100px 阈值手感、旧偏好迁移。

## 五之十一、2.1.0：真机显示修复 + 配色回蓝 + 首页双页

**真机反馈**（v2.0 截图）：搜索详情内容从 y≈0 起渲染、压在"网页摘要"页头下；加载旋转环约 1 秒后停止。

1. **条件节点叠压根因与修复**：`if/elif/else` 节点不参与父级 flex 流，渲染在父容器原点。修复方式：
   - 搜索/链接/书架改为**整屏视图容器**（`.view` 自带页头，408×480，if 切换）；
   - 列表/空态、搜索状态区改放进 `<stack>`，条件块作为层叠子节点；
   - 旋转环放进固定 52×52 的 `.spin-box`（否则会被居中文本压住）；
   - 书架"清空"按钮放进 `.act-right` 容器。
2. **配色回退**：恢复 v1.x 黑底蓝字语言，强调色改为**应用图标背景蓝 `#2D6CFF`**；正文/箭头 `#64B5FF`、卡面 `#1C1C1E`、次级 `#8E8E93`、危险 `#FF453A`。布局语言（胶囊、大字号）保留。
3. **旋转环常驻**：CSS 动画被 `setData` 重渲染打断（`Store.init` 1.2s 兜底回调触发 applyTheme/applyLayout 重渲染）。修复：①`Store.init` 回调加"加载中/偏好未变即跳过"守卫；②每 **1500ms 交换 A/B 旋转环节点**（`spinA`，360°≡0° 无缝重播），加载结束 `stopSpinner()`。搜索页同款 `startSpin/stopSpin`。
4. **首页横向 swiper 双页**（参考 FIT4 微信）：`swiper index/duration=300/onchange`，页 0 = 软件信息、页 1 = 主页（默认页 1，右滑看信息、左滑回主页），胶囊分页点定位在 y=452；`swiper` 不能含 `list`，首页菜单改为 4 个固定胶囊行。
5. **软件信息页**：纯 CSS 复刻应用图标（96 圆底 `#2D6CFF` + 白色书本描边 + 书脊条）、名称「轻鸿浏览器」、版本 `2.1.0`、作者「豚鼠」。
6. **408×480 预算逐页校准**：首页 450、阅读 460、链接 476、书架 476、设置 472、搜索 472（详见 `docs/design-v2.md` §2.2）。
7. **版本号**：2.0.0(2000) → **2.1.0(2001)**。

冒烟 66 条全绿；6 页快照齐全。**待真机**：swiper 初始 index 是否被尊重（若从信息页启动需调整页序）、旋转环连续性、各页 408×480 无裁切。

## 五之十二、2.2.0：首页页序修正 + 关于页/条目对齐华为 + 搜索页全绝对定位

1. **首页页序**：改为 页 0 = 主页、页 1 = 关于（v2.1 方向反了）；自右向左滑出关于页，右滑回主页；分页点 y=464。
2. **关于页**：按华为创新研究「关于」页重排——30px 标题、76 圆图标、三张 376×88 双行卡（标签 26px / 取值 18px 灰），总高 454。
3. **主页条目**：按华为「更多」页——52 圆图标（纯 CSS 线框：放大镜/书本/时钟/靶心）+ 22px 标题 + 14px 副题 + 灰色箭头，行高 84。
4. **搜索页真机仍叠压**：v2.1 的「整屏 view + flex」不够。v2.2 改为 **root stack → view(stack) → hdr/内容全部 `left/top` 显式定位**，详情内 title/sub/sum/url/foot 与列表内 bar/status/area 全部定坐标。**结论升级：条件分支内不要依赖 flex 布局。**
5. **版本**：2.1.0(2001) → **2.2.0(2002)**。冒烟 66 全绿，6 页快照齐全。

## 五之十三、2.3.0：交互修复 + 离线网页

1. **搜索页状态行删除**：真机裁切，按用户要求整行移除；结果区上移。
2. **加载指示改白色放大镜**：36px 图标 + 64px 容器（旋转不裁切），1500ms linear 旋转 + A/B 换节点保活。
3. **阅读页去掉底部常驻按钮**：正文 292→320；左滑从右侧滑出操作页（translateX 280ms），内含 链接/收藏/保存离线/设置；右滑返回阅读。
4. **摘要加长可滚动**：上限 600 字；摘要区改 `list` 原生滚动（376×190）；全站 padding 溢出修正（宽度=目标−padding）。
5. **离线网页**：新增 `common/saved.js` + `pages/offline/offline`；操作页「保存离线」写入 `internal://app/saved/`，主页「离线网页」列表可打开/删除；打开时不经网络与解析。文件接口按 cache.js 的分批+探测+一次性回调模式实现（`system.file` 12 方法真机已实证，见技能 fit5pro-real-device-capability.md）。
6. **版本**：2.2.0(2002) → **2.3.0(2003)**；冒烟 66 全绿（摘要用例输入加长到 800 字以匹配 600 上限）。
7. **代价**：reader.js 57.4 KB 再次超出快照阈值，`reader.bc` 缺失（功能正常，冷启动略慢）。

## 五之十四、2.4.0：离线修复 + 摘要修复 + 下载进度显示

真机反馈两处「不可用」（v2.3 新增功能首测），按 FIT5 Pro 能力检测与 SDK d.ts 逐层归因：

1. **离线保存/打开重做（`common/saved.js` v2 分片文件格式）**：
   - v1 用同一文件 position/length 分片推进，字节/字符偏移靠 cache.js 探测兜底——**SDK `@system.file.d.ts` 明文 position/length 为字节**，未探测时按字符推进，>833 汉字正文读回必错位（乱码/断尾）；
   - v2 改为**每片 ≤1200 字符（≤3600 字节）一个独立小文件**（`<key>.<n>`），单次 writeText 写、单次 readText(length:4000) 读，**不用 position**，对两种语义免疫；
   - mkdir 改**链式**（v1 并行 mkdir+write 是竞态，技能明文禁止）；URI 用 `internal://app/saved`（无尾斜杠，对齐 shalu2 音频方案）；
   - 清单 `list.txt` ≤12 条（标题 ≤22 字、URL ≤100 字符），单次读回 <4KB；同 URL 覆盖、超量挤出删旧分片；全部回调恰好一次、异常全降级。
2. **路由参数通道修复（`common/route.js`）**：storage 单值 128B 超限**静默失败**（1.5.x 已坐实的机制），`{offline,key,title,parts}` 长标题必超限 → 离线打开拿不到参数。新增 **`@system.file` 文件主通道**（`internal://app/lwb_route.txt`），storage 降为兜底；写失败先清旧文件再跳转，杜绝旧参数。
3. **摘要显示修复（search 页）**：v2.3 把摘要区换 `list` 时 `list-item` 没给高度——**Lite width/height 未设置默认 0**，条目坍缩、摘要整块裁掉。修复：list-item 与 text 双显式高度绑定（text 高度绑定模式 v1.6 起真机已实证），行数估算留 1 行余量。
4. **网页下载进度显示（新）**：操作页「保存离线」行内进度条 + 「正在保存… N%」百分比，逐分片推进；完成「已保存到离线」1.4s 复位；失败红字可重试。**`system.prompt` 在 FIT5 Pro 为 undef（模块不存在），toast 永不可见**——保存反馈以行内状态为主通道，toast 仅留旧设备兼容。进度行用 stack+显式坐标（条件分支内不依赖 flex 的硬规则）。
5. **删除竞态修复（offline 页）**：删除回调内再刷新列表（v1 立即刷新会读到旧清单，删掉的条目闪回）。
6. **版本**：2.3.0(2003) → **2.4.0(2004)**；冒烟 **79 全绿**（+saved v2 九例：双语义往返/进度/覆盖/容量/清单 4KB 预算/异常降级；+route 文件通道四例）；构建产物 v2.4.0，`reader.bc` 缺失仍为已知项。
7. **知识修正**：cache.js/saved.js「file 真机待验证」风险标记正式撤销（能力检测实证 12 方法全在）；readText position/length **字节语义**以 SDK d.ts 为准（真机行为待复核，但 v2 设计对两种语义免疫）。

## 五之十五、2.5.0：UI 优化设计（大胶囊首页 / 高清图标 / 公转加载 / 收藏星标）

真机截图反馈 4 项 + 未展示 2 项，全部实施（设计规格见 交付-轻鸿浏览器-v2.5.0/交付说明.md）：

1. **首页重做**：删「网址/关键词」输入栏（网址直达并入搜索页 `Url.looksLikeUrl`）；顶部「轻鸿浏览器」蓝色标题（#2D6CFF，left 28/top 36 避死区）；胶囊 66→100px 高、单屏 3.5 条可滚动、图标 64px 圆底 + 40px 图形、27px 主标题居中于**图标右侧空余面积**（中心 x=226）、删全部副标题；**swiper → if/elif 双视图 + 手势**（SDK：swiper 不支持嵌套 list，目录要 list 滚动）。
2. **高清图标体系**：10 张 PNG（80×80 @2x 白色线框，Pillow 4× 超采样，`tools/gen_icons.py` 可复现）入 `common/`；**放大镜几何修正**——手柄沿半径方向（过圆心），与接触点切线垂直（旧版竖直手柄几何错误）；搜索/阅读加载共用 `ic_search.png`。
3. **公转加载动画**：整体自转 → **图标方向恒定的圆周平移**（双层反向旋转：外层 rotate360 公转 + 内层 rotate-360 抵消朝向，轨道半径 10px），A/B 保活沿用；搜索页旧加载环同步替换。
4. **收藏星标**：摘要页/阅读页右上角 = 白色镂空星（未收藏）↔白色实心星（已收藏）PNG，接 store 书签互通；★ 字符弃用（真机字形/对比度风险，截图显示为空）。
5. **摘要页死区修复**：「访问/返回」s-foot top 306→286（绝对 y 394..450，安全线 y≤455 按 r≈64 角圆核算）。
6. **搜索栏**：214→242px，与按钮间隙 50→22px。
7. **工具页（右滑）**：与首页完全同款大胶囊（链接/收藏/保存离线/设置，高清图标）；保存进度条（240px 轨道）收进胶囊底部；条件分支内全 stack+坐标。
8. **版本号三处一致性**：关于页 2.3.0 漏更新（真机反馈）→2.5.0；smoke 新增三处一致性用例（index.js/app.json5/config.json）防回归。
9. **版本**：2.4.0(2004) → **2.5.0(2005)**；冒烟 **81 全绿**（+looksLikeUrl、+版本一致性）；审计通过（12 图片 ASCII 命名、14 处 /common 引用解析、图片池 0.31MiB）；hap 46 条目（+10 图标）；`reader.bc` 缺失仍为已知。

## 五之十六、2.6.0：微信 v1.1 逆向移植（原生连贯翻页 / 底部 shader / 指示器）

真机反馈（v2.5 首测）：首页 if/elif 切换「无过渡」开倒车、放大镜公转仍有自转瑕疵、胶囊字小；附「研究微信 v1.1 并支持其列表+翻页共存与底部高斯模糊」。**已拆解微信 v1.1.0(FIT4提取).hap 还原其实现**（SHA256 与逆向交付件证据一致，383 条目；分析脚本 `_re-wechat\analyze_*.py`）：

1. **翻页与滚动共存**：微信 = `swiper(loop:false, indicator:false) > div > list`（SDK「swiper 不支持 list」仅限直接子节点，套 div 即解）+ **手势消歧**：list 的 touchstart 读 `e.direction`，竖向立即 `stopPropagation()`（护 swiper 不被竖滑带动），横向 `list.SetDraggable({draggable:false})` 冻结列表防抖，抬手恢复；右滑>100px 是其退应用手势（不采用）。本作 1:1 移植该结构与手势（守卫调用，缺失优雅降级）。
2. **底部「高斯模糊」实为渐变贴图**：`common/image/shader.png` 408×48 @top:436 固定叠加；像素实测纯黑 + **alpha 线性 α(y)=min(255,3+6.55y)**，40px 处全实。本作 `tools/gen_icons.py` 生成 `shader.png` 复刻曲线（408 原生无缩放）。**微信/华为均不用 blur 滤镜或渐变 CSS——用预渲染 alpha 贴图分层**（与逆向规范"层次靠透明度分层"一致）。
3. **页面指示器**：微信 `pageBreak` 38×10 @(185,452)、active 20×10 + inactive 10×10 (#808080) 间距 8、`if` 静态切换。本作同几何，颜色用本作蓝 #64B5FF/#4A4A4C。
4. **v2.5 首页结构回退**：if/elif 手动切换 → 原生 swiper 双页（连贯滑动）；标题/大胶囊保留；列表尾部 64px 留白条目让末条可滚离 shader 保证点按。
5. **胶囊大字**：27→32px + letter-spacing 5px（用户"字体过小，增加字距"）；工具页同步；保存行文案精简适配。
6. **加载动画改 sway**：公转双层旋转真机内层失效表现为自转 → 改**水平 ±8px 往复**（translateX，图标方向恒定），1200ms ease-in-out 一循环，A/B 保活交换周期同步 1200ms；搜索/阅读统一。
7. **版本**：2.5.0(2005) → **2.6.0(2006)**；冒烟 81 全绿；审计通过（13 图片 ASCII、15 处 /common 引用）；hap 48 条目；`reader.bc` 缺失仍为已知。
8. **知识固化**：swiper+list 共存结构、`SetDraggable` 隐藏方法、shader.png alpha 曲线、pageBreak 几何——证据链见 交付-轻鸿浏览器-v2.6.0/交付说明.md 第二节。

## 五之十七、2.7.0：表冠列表滚动（微信 rotateFocus 模式）

用户需求「微信的列表同时支持旋转表冠控制上下滑动，我们也实现这个」。微信 v1.1 包逆向结论：**表冠滚动不是事件处理而是焦点机制**（其 JS 无表冠事件代码；本机表冠 key 事件也不派发）：

1. **核心接口** `list.rotation({focus:boolean})`（SDK Lite 方法白名单）——焦点在列表上时表冠旋转**原生驱动该列表滚动**；微信另带 `rotationvibrate` 属性（段落振动）。
2. **微信 rotateChange 管理器模式**：状态切换时先对所有列表 `focus:false` 再给唯一活跃列表 `focus:true`（排他移交）；onShow 重申、onHide/onDestroy 全释放、swiper 翻页焦点跟随。微信自身也守卫 `if (el.rotation)`。
3. **本作实现**：新模块 `common/crown.js`（apply/applyLater/cancel；条件分支内列表延时 150ms 重申挂载后聚焦，单定时器双路清理）。**七个列表全部接入**（ref+id 双通道 + rotationvibrate）：首页目录（翻页跟随）、搜索结果/摘要（视图切换移交）、工具页（开关移交）、离线/链接/书架（渲染后聚焦）；全部页面补齐 onHide+onDestroy 双路释放。
4. **构建**：`rotationvibrate` 为微信生产包实证属性、本 SDK 白名单未收录 → 7 处「use customize attr」提示（非错误）；`line-height` 告警为历史存量。
5. **版本**：2.6.0(2006) → **2.7.0(2007)**；冒烟 81 全绿；hap 48 条目；6 个页面包均编译入 rotation 调用；`reader.bc` 缺失仍为已知。

## 五之十八、2.8.0：手势轴向互斥 / 工具页补齐 / 胶囊视觉统一

v2.7 真机反馈四项，全部修复：

1. **斜向运动根因坐实**：轴锁判定 `event.direction ? String(...)` 比对字符串——gesture.js 早记载「少数固件给 **0/1/2/3 数字方向**」，**数字 0（up）是 falsy 被整体丢弃**、1/2/3 不匹配分支 → 轴锁从未生效 → 列表与 swiper 双动。修复：`Gesture.dirOf`（无距离门槛归一化，显式比较防 falsy 0）+ **严格轴向互斥**：主通道（touchstart 带方向，微信同款）竖向 stopPropagation 封死翻页、横向 SetDraggable(false) 封死滚动+原生跟手翻页；兜底通道（无方向字段）起手即 stopPropagation 防双动，5px 主轴锁定，横向用 `swipeTo` **300ms 原生动画翻页**（杜绝无过渡跳变）。smoke 固化 dirOf 回归用例（含 falsy 0 断言）。
2. **工具页补 shader + 表冠**：shader.png 渐隐贴图补入（主页同款 y436）；表冠 v2.7 接线但真机缺失——**条件分支内列表挂载时序**问题（立即聚焦时未挂载、单档 150ms 重申落在 280ms 滑入动画窗口内）→ `Crown.applyLater` 改**双档重申**（150ms+450ms）；尾部留白 64px（末条可滚离遮罩、滚动行程 60→124px）。
3. **工具页文字对齐主页**：v2.6 的"同款同步"漏改 reader.css（27px 无字距）→ 逐值统一 32px + letter-spacing 5px。
4. **胶囊图标加大 + 留白对齐**（两页同步）：圆底 64→**72**、图形 40→**52**、文本盒 284@x88..372（中心 230 = 图标右侧空余面积中轴，两侧 4px 对称留白）、进度条轨道中心同步 230。
5. **版本**：2.7.0(2007) → **2.8.0(2008)**；冒烟 **82 全绿**（+dirOf 回归）；hap 48 条目。

## 五之十九、2.9.0：顶部渐隐帘（黑条 → 与底部对称的类高斯模糊）

v2.8 真机反馈：「轻鸿浏览器」标题下方一条黑色遮罩割裂。修复：

1. **新增 `common/shader_top.png`**（408×48）：底部 shader.png 的**严格镜像朝向**——α(y)=min(255, 3+6.55×(47-y))，**实心端在上（y=72 紧贴文字底缘）、向下渐隐**。双向渐隐曲线同源 `tools/gen_icons.py` 可复现。
2. **文字底部零模糊**：字形底缘 y≈66，实心段 72..80 纯黑（非模糊），渐变自 ~80 起——文字底部 6px 全清。
3. **割裂消除**：标题与首条胶囊间的 30px 硬黑带 + 硬边 → 胶囊上缘随渐隐溶入标题区，滚动内容自下而上渐隐（与底部对称）。
4. **结构**：主页容器 flex 列 → `stack + 显式坐标`（标题 (28,30)/列表 (16,94)/帘 (0,72)，视觉位置不变）；渐隐帘 z 序压列表之上、与标题无重叠，随主页滑动（关于页图标区不受染）。
5. **版本**：2.8.0(2008) → **2.9.0(2009)**；冒烟 82 全绿；hap 50 条目（+shader_top.png）。

## 五之二十、3.0.0（正式版）：三项修复 + 全面审核

1. **工具页「操作」标题** 22px 白 → **28px 品牌蓝 #2D6CFF**（与首页标题同语言）。
2. **工具页顶部渐隐**：shader_top.png 镜像帘铺入 y 100..148（实心端贴「操作」底缘，几何关系与首页一致；文字底部零模糊）。
3. **加载动画连续化**：真机反馈三关键帧 sway「到右端瞬跳回左」——**本平台 CSS keyframes 仅有双关键帧真机证据**（微信 Go/Voice 均 2 帧），三关键帧/alternate 动态未证实，退化症状吻合「按 0→50% 段循环」。修复：**`common/sway.js` JS 补间驱动**（32ms 余弦往复更新 left 绑定，fade.js 同 cadence 真机机制）——按定义连续、无节点交换、无动画重启。搜索/阅读统一。
4. **全面审核**（27 模块/7 页/7 CSS/工具链/知识条目）：语法纪律、定时器配平、once 回调、内存上限、112KB 门槛、资源引用、微信移植证据链均核查无恙；输出 **20 项可优化清单**（A 正确性 4/B 性能 3/C 清理 5/D UX 4/E 工程 3/F 兼容 1，含优先级建议）待用户决策——见 交付-轻鸿浏览器-v3.0.0/交付说明.md 第四节。高优先：A1 书签 storage 溢出、A2 route 长 URL、E1 构建锁自愈。
5. **版本**：2.9.0(2009) → **3.0.0(3000)**；冒烟 82 全绿；hap 50 条目。

## 五之二十一、3.1.0：审核采纳项实施（A 组 4 项 + C 组 5 项）

用户批复「采纳全部 A 项和 C 项」，全部实施：

1. **A1 书签/历史/偏好迁出 storage**：新模块 **`common/fsutil.js`**（分片原语：once/splitText/ensureDir/writeSmall/readSmall/quietDelete/writeParts/readParts/readPartsRange，回调恰好一次、读取不用 position、writeParts 含尾部旧片清理）；store.js 持久化改 `internal://app/data/{bm,hs,pf}.<n>` 分片文件 + **v1 storage 自迁移**（文件空→读旧键→写回并清理，老数据无损）。128B 静默丢失风险根除。
2. **A2 setCurrent/getCurrent 文件化**：`internal://app/lwb_cur.txt` 主通道，长 URL 恢复（链接页返回不再错误回首页）。
3. **A3 cache.js 分片小文件**：`internal://app/c/<key>.<n>`，**探测机制整体删除**；区间读=固定片长定位+内存切片（reader 懒翻页，双语义精确）；reader 的 `modeOf()==='c'` 守卫移除。
4. **A4 cache 链式 mkdir**（fsutil.ensureDir）。
5. **C1 死字段**：search statusText/hdrBackIcon、reader 主题 7 字段+applyTheme（含 install 内漏网的第 4 处调用）、config.COLORS。**C2** 死文案 4 条。**C3** i18n 目录删除。**C4** search.css 86 规则级联合并为单层最终值（废弃类全清）+ reader/links/shelf 死类 4 条。**C5** index.css lwb-in。
6. **教训**：清理类改动的漏网引用 grep 必须覆盖「方法调用」而不只字段名（applyTheme 第 4 调用点、Cache.probe 残留、statusText 第 5 赋值都是复扫抓出的运行时炸弹）；CSS 注释里不能出现 `xx*/` 形式（会闭合注释块）。
7. **版本**：3.0.0(3000) → **3.1.0(3001)**；冒烟 82 全绿（cache 段重写 + 迁移/双语义回归）；hap 48 条目（i18n 删除）。

## 五之二十二、3.2.0：3.1 崩溃修复 + 首条胶囊遮挡修复 + 信息页存储管理

1. **3.1 黑屏根因定案**：崩溃场景（摘要「访问」/加载示例站）都走 reader `install()`——3.1 的 `Cache.save`（writeParts 异步写分片）与紧随的首屏 `loadRange`（readPartsRange）**并发读写同一批文件** → 嵌入式 FS 竞态黑屏。3.0 无恙：旧 `modeOf('c')` 门控天然把读排在写/探测之后（串行）+ 单文件 append 无删除洪峰。**用户实证 3.0 离线保存可用** → saved.js 的 mkdir/删除模式真机无恙 → 崩溃点收敛到缓存写读并发（saved.js 原样保留未动）。
2. **fsutil v3.2 稳固化（四层）**：①**按基名读写互斥锁**（写持锁/读排队；writeSmall/readSmall 3s 守卫防锁悬挂）；②尾部清理**串行 + [n..last) 绝对区间增量**（稳态零删除；根治上轮自查出的「从 0 起删误删新片」遗留 bug）；③mkdir **access 探测 + 会话一次**（杜绝对已存在目录 mkdir）；④缓存驱逐 quietDeleteRange 串行。回归锚点：`read waits for in-flight write`（延迟写回调模拟真机异步）+ `shorter rewrite cleans stale tail`。
3. **首条胶囊遮挡**：列表引导留白（home 24px/工具页 36px）——首条胶囊落在渐隐帘透明端外（126/152），未滑动零遮挡；滚动渐隐观感不变（列表裁切边仍在帘的实心段下）。
4. **信息页存储管理（新）**：关于页改可滚动卡片列表（swiper>div>list、表冠/轴锁同主页）；`common/space.js`（file.list 统计 + Fs.deleteList 串行清理 + formatBytes）；**应用缓存**（c/，单击清）、**本地文件**（saved/ 离线正文，二次确认红钮清）；**书签/历史/设置（data/）不计入永不清除**。
5. **版本**：3.1.0(3001) → **3.2.0(3002)**；冒烟 **89 全绿**（+2 回归 +5 space）；hap 48 条目。


## 五之二十三、3.3.0：崩溃根治（缓存删除）+ 搜索页三改 + 目录识别 + 三键导航 + 离线标题

1. **崩溃（与 3.1 表现完全一致）根因定案 + 网页缓存功能整体删除**（用户决策：实际作用感知不大，离线网页保留）：3.2 互斥锁自身残留死锁面——`quietDeleteRange`/`deleteList` **无守卫**，`file.delete` 回调一步丢失即永久悬挂（writeParts 尾清持锁路径卡死后续同基名读写，renderAt 回调永不返回）。修法：**cache.js 删除**，reader fetch 直连网络、**renderAt 纯内存切片**（Paginate.pageText），阅读/翻页热路径零 `@system.file`；fsutil 删除链**逐步 600ms 守卫**（回调丢失也推进，锁绝不悬挂）；`readPartsRange` 死代码随删；旧 `internal://app/c/` 启动一次性回收（Space.purgeLegacyCache）；信息页「应用缓存」行移除。回归锚点：fsutil 互斥排队（移植）、删除链守卫（伪定时器）、reader 零文件通道断言。
2. **盒模型实证（真机截图定案，修正 4.2 条旧口径）**：**width 即绘制裁切盒、padding 计入 width 内部**（bar 输入 242/按钮 112 有间隙、右缘 392；胶囊 332 居中 38..370 与截图吻合）——「宽=目标−padding」旧口径会把带 padding 元素画窄（搜索胶囊缩进 22px 的根因）。新布局一律 stack+显式坐标，不再依赖 padding 语义。
3. **搜索页三改**：①结果胶囊 332→**376 全宽**与搜索框左缘/按钮右缘（16..392）对齐，内部显式坐标（标题 288@36、箭头右内 20）；②10 条**一次入列 list 滚动**，分页器/`Paging` 逻辑删除；③**首页同款上下渐隐帘**（shader_top@168 实心端贴搜索栏底缘 + shader@436）+ 30px 引导留白（首条胶囊 222 在帘透明端 216 外 6px，零遮挡）+ 64px 尾部留白。
4. **目录章节识别（navrule v2）**：旧 len≤20+必须「第」开头漏判长章节标题（>20 字，小说站常态）与数字编号条目 → 四类前缀：第x章/节/回/话/卷（副题不限长 ≤60 字）、纯数字编号（12. / 012、3章，点号后非数字防「3.14」误判）、卷首语（楔子/序章/前言/引子/后记/番外/尾声/终章/大结局）、装饰括号（【第十二章】）容忍。
5. **章末三键导航行**：「‹ 上一章 / 目录 / 下一章 ›」118×48 三胶囊（hasPrev/hasNext 条件显隐，下一章主行动蓝），替代单键 next-hint 浮标；stack+显式坐标（条件块不入 flex 流）。
6. **离线标题识别**：`Navrule.offlineTitle(title, body)`——章号取网页标题或正文首行（保留原形态：第十二章/第12章；数字编号归一为「第N章」）；书名取《书名》→ 章节标记前缀段 → 分隔段（排除站点名特征词与「最新章节」类尾噪）；输出「书名 第n章」，任一识别不出 → 空串回退原标题。saved.js 标题上限 22→28（清单预算仍 <4KB）。
7. **版本**：3.2.0(3002) → **3.3.0(3003)**；冒烟 **90 全绿**（navrule +8、缓存删除回归 6、space 精简 5、saved 上限更新）；hap 48 条目（217,510 B）。


## 五之二十四、3.4.0：浏览崩溃真正根因定案（I/O 风暴）+ 目录跨页数据通道

> ⚠️ **本节推翻五之二十二的"崩溃根因=缓存写读竞态"结论**（v3.3 删缓存后崩溃与 3.1/3.2 完全一致，实证证伪）。

1. **真根因（逐 bundle 实证）**：Lite **每页独立 bundle、模块级变量不跨页共享**（globalThis 不存在；route.js 头注释 + FIT5 Pro 能力检测双证）→ store.js 随页重建、每翻章重跑 init。v3.1 大 JSON 分片格式使**每次翻章 ≈ 65 次 @system.file 操作**（init 3 条 readParts 链约 33 次 readText + addHistory 整表重写 15~17 写 + 尾部删除洪峰 + setCurrent 2 写 + 参数写）；持续浏览必崩。v3.0 仅约 3 次轻操作（storage kv + 单文件 append）故稳定。v3.2 互斥锁/v3.3 删缓存只各削一角（v3.3 后仍约 60 次）。
2. **store.js v3.4 单小文件持久化**：`data/{bm,hs,pf}.txt` JSON 单串、单次 readText/writeText；UTF-8 字节预算 3900B 自截断（旧条目整条丢弃、URL 不截断）；同址重复访问纯内存不落盘；**零删除洪峰**；一次性迁移 v3.1~3.3 分片与 v1 storage → 单文件（空库写空表标记）。每翻章 store I/O：**3 读 + 1 写**（原 ~50）。完整性优于 v3.0（无 128B 丢失）。
3. **route.js setCurrent**：同值去重（fetch/install 双调 → 单次生效）+ 短 URL 走 storage kv（翻章期文件写 2 → 0）；长 URL 落文件并清 storage 旧值。Route.go 参数文件（v2.4 写成功才跳转）保留。翻章期总账 **≈ 5 次小操作（v3.0 等级）**。
4. **目录真根因（#6 补课）**：links.js 的 Session 是本页空副本 →「目录」永远拿不到文档（显示"本页无可用链接"）。新增 **`common/linkpass.js`**：阅读页「目录/链接」→ 链接表序列化落盘（fsutil 分片 ≤10 片）→ 目录页取回；navrule v2 章节置顶随之生效。
5. **回归锚点（冒烟 96）**：store 单文件往返/分片迁移/v1 迁移/字节预算/同址免写（fileCalls 断言）、route 短 URL kv 化+去重、linkpass 往返/空态/损坏。
6. **已知限制（待批复）**：阅读页右滑返回=回首页（跨页浏览栈受"模块不跨页共享"限制）；章节跳转用「上一章/下一章/目录」三键行。
7. **版本**：3.3.0(3003) → **3.4.0(3004)**；冒烟 **96 全绿**；hap 48 条目（222,186 B）。


## 五之二十五、3.5.0：大站加载崩溃（堆峰值）定案 + 目录章节优先

1. **精确复现定案**（创世中文网 `chuangshi.qq.com/read/933334/1` 连续读到第三章加载崩溃）：三章原始 HTML 实测 103K/105K/**115K 字符**（ch3 最大 158KB），**正文都在前 31K**，31K 后是 419 章巨型目录+评论 ≈70K 死重。崩溃算术：解析只用前 64K 但抓取上限 131K → ch3 峰值 = 响应 115K + 截断副本 64K + 分块 30K + 拼接 30K ≈ **240K** + MAX_DOCS=2 常驻 90K + 旧页 VM 残留 → 越 698K 上限；ch1/ch2 常驻少故存活。
2. **修复（峰值 240K+ → ~125K，功能零损失）**：①reader 抓取上限 = MAX_HTML_CHARS 64K（`Net.fetchText` opts.maxChars；Range 同步收窄、传输减半）②**MAX_DOCS 2→1**（返回旧页按需重抓）③**`Session.dropDocs()`**：fetch() 开抓前清空全部文档驻留，加载峰值独占堆 ④响应 ≤64K 后 parse 的 src=raw 免截断副本。
3. **目录章节优先**：`Linkpass.mergeLinks(chapters, links)`——章节链接优先 + href 去重 + ≤40（大站目录在 HTML 后段，前 40 条链接会被页头导航灌满）；html.js 章节上限 30→40。
4. **回归锚点（冒烟 98）**：session 单文档语义、dropDocs（ch3 崩溃防回归）、mergeLinks 三性。
5. **版本**：3.4.0(3004) → **3.5.0(3005)**；冒烟 **98 全绿**；hap 48 条目（222,662 B）。


## 五之二十六、3.6.0：堆峰值二次治理（CJK×3 堆账 + 采集期截断 + 原始响应释放）

> v3.5 仍崩（ch2 开目录崩、ch2→ch3 崩、ch3 成功一次后浏览全崩=毒化态）。

1. **堆账重算（关键教训）**：JerryScript 串按 UTF-8 类字节存，**CJK 每字 3 字节**——按"字符数"估堆低估三倍。30K 字文本 = chunks 90K + join 90K + strip 副本 90K + 常驻 90K。
2. **真 bug**：MAX_TEXT_CHARS 在 join 后才截断 → 评论/巨型目录标题灌满 chunks 瞬时区（采集期无界）。
3. **原始响应持有**：net.js 回调中 response 引用原始大响应（115K 字符≈160KB），与截断副本叠进解析峰值。
4. **修复四项**：①MAX_TEXT_CHARS 30000→**12000**（≈26 屏/章；管线 270K→108K、常驻 90K→36K）②emit **采集期截断**③截断后 **response.data=null 立即释放**再回调④paginate charAt→charCodeAt（零串churn）。**加载峰值 ~400K→~230K、常驻 ~247K→~195K**。
5. 「目录加载崩溃」为同一堆问题的另一触发点（毒化堆上小分配压垮），非 linkpass 缺陷。
6. **版本**：3.5.0(3005) → **3.6.0(3006)**；冒烟 **98 全绿**；hap 48 条目（222,701 B）。


## 五之二十七、3.7.0：全局文件串行（崩溃并发面定案）+ 屏幕常亮设定

1. **全局并发面定案（I/O 形态逐版本对账）**：v2.4~v3.0 文件调用**全程回调串行**（任一时刻至多 1 个在飞）→ 稳定；v3.1~v3.6 每次翻页 init 有 **3~6 个并行** file 调用（store 多链 + 路由参数 + 离线读取）→ 崩溃贯穿。**v3.2 互斥锁只按基名串行，跨基名并发从未被堵**；v3.5/v3.6 堆治理必要但不充分。
2. **修复**：fsutil **全局 FIFO 队列**——所有 @system.file 调用（writeText/readText/delete/access/mkdir/list）同一时刻只在飞 1 个，每调用带守卫；route.js（参数/当前网址）、saved.js（离线）、space.js（统计）全部直调点改走队列。"参数写成功才跳转"有序语义保留。回归锚点：暂扣回调断言第二调用不提前起飞（冒烟）。
3. **屏幕常亮设定（新）**：`@system.brightness.setKeepScreenOn`（FIT5 Pro 实证「5 方法全在」，`@reserved ["liteWearable"]`，仅阻止不活动超时自动息屏）——加载大站息屏→切后台→进程被回收是"应用关闭"混杂因素。设置页新增「屏幕常亮」行（紧凑内联开/关胶囊），**默认开启**、立即生效、prefs.keepScreenOn 持久化（旧数据默认开）；app 启动 + reader.onInit 幂等重申。
4. **版本**：3.6.0(3006) → **3.7.0(3007)**；冒烟 **102 全绿**（+串行锚点 +keepScreenOn +screen）；hap 48 条目（229,984 B）。


## 五之二十八、3.8.0：点「链接」崩溃根治（幽灵删除）+ 图标居中/返回钮/加载进度/信息页遮罩

1. **崩溃根治**：`Linkpass.save`（点「链接」即执行）的 writeParts **首次保存删幽灵分片**（尾清 [n..MAX) 不存在文件 9 连发 delete）——v3.7 串行化后仅存的删除并峰点。linkpass 改**单小文件**（store v3.4 同款）：1 写 1 读、零分片零删除、3900B 预算从尾部（非章节）整条丢弃。**全应用无任何批量/幽灵删除路径**（saved.js 只删真实文件）。
2. **图标居中**：绘制包围盒偏心根因（ic_search 墨迹中心 (32.75,32.75)、ic_clock (36,36) ≠ 画布 40,40，恰为用户点名两个）——gen_icons.py **alpha 包围盒自动居中**，11 图标重生成（几何居中 ≠ 视觉居中，固化为工具行为）。
3. **返回钮**：28px ‹ 字形（偏小偏心）→ 新绘 **ic_back.png chevron** 42px 居中，6 页统一（含工具页）。
4. **阅读页加载进度**：@system.fetch 无传输事件 → 时间估值进度条（0→95%）+ 真实秒数（setInterval 250ms，onBody/onFail/onDestroy 停表）。
5. **信息页顶部遮罩**：shader_top@66（「关于」标题底缘）+ 列表 top=帘顶+22 + 24px 引导留白（首条零遮挡），与主页同构。
6. **版本**：3.7.0(3007) → **3.8.0(3008)**；冒烟 **103 全绿**（+linkpass 预算/零分片锚点）；hap 50 条目（233,336 B）。


## 五之二十九、3.9.0：解析卡死根治（cur+=ch 逐字拼接）+ 旧页堆释放 + 信息页胶囊化

1. **卡死根治（用户观察即定位）**："进度条/动画卡住数秒后大多正常完成" = 主线程被同步解析长任务阻塞（区间定时器饿死）；"第五章/目录后崩" = 阻塞期分配洪峰挤爆堆的尾部事件。**真因**：html.js 逐字符 `cur += ch`——JerryScript 每次 += 整串复制，64K 源 ≈ **6MB 复制 + 数万次小串分配**。**修复**：emitText 段扫描（charCodeAt 零分配）+ emitRun **整段追加**（substring+拼接），分配量降 ~50 倍；13 例 html 语义用例全绿。
2. **旧页堆释放**：reader.onDestroy 清空 pageText 三缓冲/starts + `Session.dropDocs()`——框架延迟回收旧页 VM 时的逐章堆累积消除（renderAt 自愈降级兜底）。
3. **信息页 UI**：条目 = 首页同尺寸胶囊（376×100 r50 同底色、文字居中）；应用图标居中 + **2x**（76→152，字形同比）；清除按钮移胶囊右缘内。
4. **版本**：3.8.0(3008) → **3.9.0(3009)**；冒烟 **103 全绿**；hap 50 条目（233,432 B）。


## 五之三十、3.10.0：目录页崩溃实测定案（419KB 整包序列化）+ 堆峰值再降 + 进度估值 2x + 信息页改版

1. **目录页崩溃实测定案**：`https://chuangshi.qq.com/chapter/933334` 实测 **376,827 字符 / 419,195 字节 / 853 链接**；**Range 被无视**（200 全量、无 Accept-Ranges）；**HEAD 被拒**（500/502）；@system.fetch 仅 url/header/method/responseType（无 maxSize/无流式）。→ 响应必被整包序列化进 698KB 堆、序列化发生在 JS 回调之前 → **必崩且 JS 无法提前截断**。**修复两防线**：①`Url.looksLikeToc` 地址防护（路径两段 + 次段纯数字 + 首段 chapter/chapters/list/toc/catalog/catalogue/directory → 直接给可读失败态「无法打开整本目录…用「目录」按钮浏览章节」，**不发请求**；`/read/<书号>/<章号>` 三段章节地址不受影响）②`Navrule.isTocNavText` + linkpass.mergeLinks 清洗（目录/返回目录/全部章节条目剔除，长标题含「目录」不误伤）。
2. **连读崩溃（5/6 章）堆峰值再降**：ch5=119,524 字符、ch6=117,178（≈159KB 字节）；解析/截断窗口 **65536→48000**（正文 ≤31K，余量 17K）→ 截断副本 −25KB、解析扫描 −27%；**stripNoise 数组收集 + 一次 join**（旧逐行 `out += line` 为兆字节级整串复制）。
3. **卡住物理原因（如实）**：冻结在响应到达瞬间——fetch 主线程序列化整包（120~160KB），定时器全部饿死（平台行为，JS 不可规避）。**进度估值提速一倍**（0→95%：8s→4s，用户要求），冻结发生在更高百分比、解冻即满。
4. **信息页改版**：删除应用图标行；取消卡内「清除」小按键；新增**「清除数据」大胶囊**（376×100 r50，与条目同尺寸；两次点击确认、转红「确认清除数据」、完成闪「已清除」）。
5. **版本**：3.9.0(3009) → **3.10.0(3010)**；冒烟 **105 全绿**（+looksLikeToc +mergeLinks 清洗）；hap 50 条目（235,207 B）。


## 五之三十一、Release V1.0 定版：启动动画 + 清除数据居中 + 表冠滚动补齐 + 版本更替

> v3.10.0 真机确认完美运行；本轮只做四项收尾，架构与既有功能零改动。

1. **启动动画（新入口页 `pages/splash/splash`，`config.json` pages 首位）**：纯黑底 + 居中 160×160 应用图标；图标 160ms 淡入（0.35→1）→ 停留 900ms → 整屏 140ms 淡出 → `router.replace(首页)`（首页 280ms 入场 = "淡入到首页"）；返回键不回闪屏；定时器 onDestroy 全清。图标为**自有图标高清重绘**：`common/ic_launcher.png`（蓝底 r=满幅圆 #2D6CFF + 白书本轮廓/顶带，按 media/icon.png 92px 设计 4× 超采样重绘 160px）——**截图示例图标（其它软件）未采用**。
2. **清除数据胶囊垂直居中**：旧 `height/line-height:100px` 真机只有水平居中（行盒按字体度量偏上）→ 文本盒 40px + 行高 40px + top=(100−40)/2=30。
3. **表冠补齐**：①搜索页根因 = `showList()` 建表前申请焦点、applyLater 档位在结果返回前全部过期 → **结果到达后重新 `armCrown('result')`** + `onShow` 按当前视图重申；②操作页根因 = 面板重挂载（含 4 图标 PNG）晚于 450ms 档 → **`crown.applyLater` 重申由 2 档扩为 4 档（150/450/1000/1600ms）**，`cancel` 全清；阅读页 `onShow` 面板仍开时重申。共用 crown.js → 链接/离线/书签页一并受益。
4. **版本定版**：`app.json5` versionCode **1000** / versionName **1.0.0**；`config.json` code **1000** / name **1.0.0**；关于页 `APP_VERSION = 'Release V1.0'`；冒烟版本用例适配"展示名带前缀"（取数字段与清单比对）。
5. **产物**：hap 54 条目（256,527 B，+启动页 3 文件 +ic_launcher.png）；冒烟 **105 全绿**。


### 五之三十一·修订 1（真机反馈：启动动画未生效、操作页表冠仍未修复；版本号不变）

1. **启动动画根因**：真机**入口页固定 `pages/index/index`**，`config.json` pages 首位不生效——首版独立 splash 页从未显示（已删除 `pages/splash/*`，pages 回到 7 项）。改为**首页内嵌全屏遮罩**：根 stack 最后一层 `<stack class="splash" if="{{splashOn}}" style="opacity: {{splashO}};">` + 居中 160×160 `ic_launcher.png`；`startSplash()` 五步淡入（160ms）→ 停留 900ms → `endSplash()` 五步淡出（140ms）→ `splashOn=false`；**1.8s 硬移除保险**（`__splashKill`）防黑屏卡死；四组定时器 onDestroy 全清。`opacity` 平台依据：Lite 通用样式（5+，默认 1）。
2. **操作页表冠根因**：左滑打开面板走 `applySwipe('left')`，**直接 `panelOpen = true` 绕过 `onOpenPanel()`**——焦点申请在 `onOpenPanel` 内，故从未执行。修复：左右滑动改调 `onOpenPanel()`/`onClosePanel()`（焦点申请/释放都在真实路径），重复打开亦重申焦点。
3. **产物**：hap **52 条目**（248,866 B）；冒烟 105/105；打包核验 `pages[0]=pages/index/index`、7 页、首页 bundle 含 `splash-ico`/`ic_launcher`。


### 五之三十一·修订 2（按要求删除启动动画；版本号不变）

1. **删除范围**：`index.hml` 闪屏遮罩节点、`index.css` 的 `.splash`/`.splash-ico`、`index.js` 的 `splashOn`/`splashO` 数据与 `startSplash()`/`endSplash()`/`onDestroy` 定时器清理（`onInit` 恢复为空）、`common/ic_launcher.png`（失去引用）。
2. **行为**：冷启动直接进入首页，与 v3.10.0 一致；**保留结论**——真机入口页固定 `pages/index/index`，`config.json` pages 首位不生效，将来若需启动画面只能做在首页内部。
3. **产物**：hap **50 条目**（235,853 B）；冒烟 105/105；打包核验无 splash/ic_launcher 残留。


### 五之三十一·修订 3（首页标题字号放大；版本号不变）

1. **`.app-title`「轻鸿浏览器」：font-size 28 → 36px**；`height 42→48`、`top 30→24` → **底缘仍 y=72**（顶部帘实心端对齐关系不变）；`line-height 48` 令墨迹在行盒内居中（上缘≈30、左缘 28）。
2. **左上角死区（圆角 r≈64）**：标题墨迹左上角距圆心 (64,64) ≈ **49.5px < 64**，安全区内余量≈14px，放大后不被圆角裁切；宽度 352（右缘 380）+ `text-overflow: ellipsis` 兜底。
3. **产物**：hap **50 条目**（235,857 B）；冒烟 105/105。


## 五之三十二、v1.0.1：离线保存崩溃修复（分片数组内存尖峰）

1. **现场**：阅读 `https://chuangshi.qq.com/read/933334/3`（最长章）点「保存离线」直接崩溃。
2. **根因**：`Saved.save()` 旧实现先 `splitText(text)` 建**分片数组**——12,000 汉字 ≈ 10 片、副本 ≈ **36KB**（CJK 3 字节/字），发生在"点保存那一瞬"，叠加已加载阅读文档（正文 36KB + 链接表 16KB + 解析/响应残留）→ 顶破 698KB 堆。短章片数少故不崩。
3. **修复三层**：①**逐片现场切片**（不再预建数组，每次只 `substr` 一片 ≤3.6KB，尖峰 36KB→3.6KB）②**延后一拍启动**（点击后 `setTimeout 60ms` 再进 file 调用）③**全程 try/catch**（`onSaveOffline` + `Saved.save` 各段，异常只显示「保存失败·重试」）。分片/清单格式与进度语义（`total = 片数 + 1`）不变；删除已无引用的 `splitText`。
4. **产物**：versionCode **1001** / versionName **1.0.1** / 关于页 **Release V1.0.1**；hap **50 条目**（236,045 B）；冒烟 **106 全绿**（+「12,000 字 → 10 片、每片 ≤1200、进度 1/11→11/11、逐字节往返一致」锚点）。


## 五之三十三、v1.0.2：离线保存"完成即崩"修复（原生回调重入 + 完成态 UI）

1. **新现场**：v1.0.1 后崩溃仍在，但**重开应用网页已成功离线保存** → 分片与清单全部写盘成功，崩溃发生在**最后一个写（清单）成功后的收尾**（内存尖峰已排除）。
2. **修复一：文件调用之间插入一拍宏任务**（`common/fsutil.js`）——全局 FIFO 放行下一个操作时，若当前不在同步调用链内（刚从原生回调返回）改走 `setTimeout(pumpOps, 0)`，**不再从文件服务回调里重入文件服务**；同步链（含冒烟 mock）仍内联续跑。新增开关 `setDeferBetweenOps`（真机默认开、冒烟显式关），`thunkDepth` 深度计数替代布尔量（嵌套 pump 不会提前复位）。
3. **修复二：完成态 UI 挪出文件回调栈**（`reader.onSaveOffline`）——「已保存到离线/保存失败」的 setData + toast + 1400ms 复位定时器移到 `setTimeout(…, 120)` 并整段 try/catch。
4. **产物**：versionCode **1002** / versionName **1.0.2** / 关于页 **Release V1.0.2**；hap **50 条目**（237,125 B）；冒烟 **106 全绿**。


## 五之三十四、v1.0.3：离线保存——把连续文件调用次数压回浏览同级

1. **新现场**：点保存 → **0% 卡死 → 崩溃**；重开后离线条目**已存在**（写盘全部成功）。v1.0.1（内存尖峰）、v1.0.2（回调重入 + 收尾 UI）均排除，崩溃不变。
2. **杠杆**：现象并列 → 真机文件服务对**连续调用次数**敏感（浏览每页 3~6 次长期稳定；保存旧实现 11~13 次连发即崩）。①**离线正文按 4,600 字封顶**（片 ≤1200 字 → ≤4 片）→ 一次保存总调用 **≤6 次**（首次另加 access/mkdir 各 1）；超长章节末尾追加「（离线内容已截断，完整内容请联网阅读）」。②**文件调用间隔 0→16ms**（每次保存约 +100ms，文件服务/UI 呼吸）。
3. **产物**：versionCode **1003** / versionName **1.0.3** / 关于页 **Release V1.0.3**；hap **50 条目**（237,372 B）；冒烟 **106 全绿**（锚点改为「12,000 字 → 封顶 4,600 → 恰好 4 片、进度 1/5→5/5、前 4,600 字逐字节一致、末尾截断提示」）。


## 五之三十五、v1.0.4：离线正文封顶 4,600 → 5,800 字（用户指定）

1. **唯一改动**：`common/saved.js` 的 `SAVE_CAP` **4,600 → 5,800**（≈12 屏）→ 分片 ≤**5** 片、一次保存文件调用 **≤7 次**（清单读 1 + 片写 ≤5 + 清单写 1；首次会话另加建目录 2 次）。进度语义随之变为 1/6→6/6。
2. **不变**：分片/清单格式、逐片现场切片、逐片 try/catch、完成态 UI 出回调栈、全局 FIFO 串行 + 16ms 调用间隔、超长章节截断提示。
3. **产物**：versionCode **1004** / versionName **1.0.4** / 关于页 **Release V1.0.4**；hap **50 条目**（237,373 B）；冒烟 **106 全绿**（锚点改为「12,000 字 → 封顶 5,800 → 恰好 5 片、进度 1/6→6/6、前 5,800 字逐字节一致、末尾截断提示」）。


## 五之三十六、v1.0.5：回退离线封顶到 4,600 字（真机实测出 6 次调用的稳定边界）

1. **真机实测（用户反馈）**：5,800 字（5 片 / ≤7 次调用）**仍崩**；4,600 字（4 片 / ≤6 次）稳定 → `SAVE_CAP` 回退 **5,800 → 4,600**（分片 ≤4、进度 1/5→5/5）。其余全部沿用 v1.0.3。
2. **稳定边界结论（重要）**：该机文件服务**一次连续操作的安全上限约 6 次调用**——浏览每页 3~6 次故长期稳定，保存 7 次即卡死崩溃。后续"多文件批量读写"功能必须控制在此上限内。
3. **版本号**：1004 → **1005**（内容等价回退；同 bundleName 降级安装会被拒，故递增版本号以便覆盖安装）。
4. **产物**：versionCode **1005** / versionName **1.0.5** / 关于页 **Release V1.0.5**；hap **50 条目**（237,372 B）；冒烟 **106 全绿**。
5. **后续方向**（若想保存更长正文）：①`writeText` 单次写全文（36KB）+ 读端按字节分块；②清单常驻内存 + 延迟落盘省 1~2 次调用。均需单独立项验证。


## 五之三十七、2026-11-07：回归 v1.0.3 主线 + 构建环境修复 + 安装包格式定案

1. **版本回退**：用户确认 v1.0.4（5,800 字 / 5 片 / ≤7 次）与 v1.0.5（仅递增版本号）真机仍崩、弃用 → 主工程三处版本号回退 **1.0.3(1003)**、`SAVE_CAP=4600`；重建产物与历史 v1.0.3 逐字节一致（hap 237,372 B / `D92F78…938EEA5`，app 225,187 B / `85D1D9…583DB`）。
2. **构建故障**：`11204003 File Resource Error: Failed to delete ...\icon.png` = `entry/build` 残留文件带 ReadOnly 属性；清只读 + 删 `entry/build` 重建即恢复。
3. **签名**：用户已在 DevEco 配置手动签名（`fit5pro.p12` alias `fit5pro`、`fit5pro.cer`、`fit5proDebug.p7b`，SHA256withECDSA）；`app.signingConfigs` **未绑定 product**，hvigor 报 `No signingConfig found for product default`。
4. **安装包格式定案（重要）**：
   - 50 条目 ZIP HAP（ZIP 级签名、`hap-sign-tool verify-app` 显示 success）在手表上**装不上**；
   - 可用包为 **Lite bin 格式 HAP**：外层仅 1 条目 `signed.bin`（头 `BE 00 00 00` + 包名 + 文件表，尾部 `…signed app   1000` + 签名块 ≈6.6 KB）；
   - 正确链路：`release HAP → haptobin_tool（HAP→bin）→ hap-sign-tool sign-app -inForm bin（签 bin）→ app_packing_tool --mode hap --bin-path（封 HAP）`；
   - 参考包 `dist\signed-bin\LiteHarmonyBrowser-v1.0.3-signed-bin.hap`（991,082 B / `595D4F…F5F60`），**待真机验证**。
5. **交付**：`交付-轻鸿浏览器-v1.0.3-开发分支\开发分支交付说明.md`（构建/签名/包格式/故障/待验）；桌面未签名 `.app` 225,187 B。
6. **下一步**：bin 包真机安装 → v1.0.3 功能回归 → 后续版本从 **1.0.6(1006)** 起编号。

## 五之三十八、v1.0.6：GT 466×466 圆屏 / FIT 408×480 方屏双屏适配 + 低 fetch 机型优化

> 交付日期 2026-11-07；版本 **1.0.6（1006）**；冒烟 **115/115**；HAP 247,977 B（`207493…EF4A2`）/ APP 235,887 B（`3B3245…4098`）。
> 方屏视觉零改动（几何绑定值与原 CSS 完全一致）；圆屏为新增纵向压缩布局。**GT 真机未验证**。

1. **新增 `common/layout.js`**：`@system.device.getInfo` 判定 `screenShape`（circle/rect）→ `windowWidth===windowHeight` → model 含 GT/FIT → 600ms 兜底方屏；导出 `Layout.page('<page>')` 七页几何表、`Layout.net()` 网络档位、`Layout.init()`/`syncConfig()`。
2. **圆屏几何**：根 466×466；内容列宽保持 376（466 圆屏 y≈96..370 可容纳 376 宽）；页头 y=48→100、正文 320→210、底部元素上移；首页标题居中；shader 宽 408→466；操作页滑入起点 408→466。
3. **方屏保持**：所有 HML 新增 `{{g.*}}` 内联 style，方屏值逐项等于原 CSS（408×480），不改颜色/字号/结构/事件。
4. **低 fetch 优化**：`Layout.net()` 三档——FIT 20s/48K/12K/131K；GT 圆屏 45s/40K/10K/110K；API<12 老机型 60s/32K/8K/90K。`net.js` 按档位超时/响应上限，网络类型守卫 1.5s→3s（慢档）；阅读进度按 `loadMs` 爬升（4s/30s/45s），慢档显示“慢速网络”；超时文案显示实际等待秒数。
5. **页面改造**：index/reader/search/links/shelf/offline/settings 全部接入 `Layout.init`；reader 分页高度改用 `geo.bodyH`，`netFetch` 用 `Layout.net().maxHtml`；settings 圆屏用 `show` 隐藏“预览/提示”两行以保留全部功能控件。
6. **测试**：新增 9 条 layout 用例（FIT/GT 几何、比例/型号兜底、三档网络、圆屏分页更多、HML 字段覆盖、init 流程），共 **115/115**；审计 API6/64KB 无新增阻断项。
7. **已知**：reader.bc / search.bc 快照缺失（reader 自 v1.0.3 已知；search 本机基线即失败），功能正常、冷启动略慢；GT 真机需确认 `getInfo` 的 `screenShape/windowWidth/apiVersion` 字段，并逐页截图验圆屏死区。
8. **下一步**：GT 466 真机冷启动/阅读/搜索/设置/慢网验收；FIT5 Pro 方屏截图逐页比对；若 GT 老机型仍 OOM，再下调 `MAX_TEXT_CHARS` 或圆屏内容列缩至 340。

## 五之三十九、v1.0.7：圆屏独立页面适配（2026-11-07）

> 版本 **1.0.7（1007）**；冒烟 **116/116**；HAP 412,791 B（`16F3E5…8CEA`）/ APP 398,727 B（`B254EC…046B`）。
> 方屏保持 v1.0.6 原布局；**GT 466×466 真机仍未验证**。

1. **架构**：新增 `pages/round/{reader,search,links,shelf,settings,offline}` 六套独立 HML/CSS；圆屏页 JS 用 `import Base from '../../<page>/<page>.js'; export default Base;` 复用业务逻辑。`common/route.js` 的 `targetUri()` 在 `Layout.isRound()` 为 true 时把 `pages/xxx/xxx` 映射到 `pages/round/xxx/xxx`；首页固定 `pages/index/index`，内部 `if="{{g.round}}"` 选择 `rd-home` / `fit-root`。
2. **首页圆屏**：取消固定置顶大标题；`轻鸿浏览器`/`关于` 改为列表首条随内容滚动；列表 340px（x=63，视口高 466px）；上下 466×110 弧形遮罩 `common/round_mask_top.png` / `round_mask_bottom.png`（RGBA 黑色渐变 + 圆形裁切）；页面指示器 38×10 @ (214,414)。**GT6 首帧残影修复**：形态判定前只渲染 boot 黑底，`g.layoutReady` 与 `g.round` 一次性 setData，最终只构建 rd-home 或 fit-root 一棵树。
3. **子页**：统一 466 根、340 内容列、页头 y=56、列表 y=116..390、上下弧遮罩。reader 正文 340×264（`Layout.page('reader').textW/bodyH`；方屏 376×320）；操作页列表 340×274；search/links/shelf/offline/settings 独立静态布局。
4. **网络档位阈值**：按用户要求，老机型从 `API<12` 改为 **`API<24`**：API<24 一律 60s/32K/8K/90K；API≥24 的 FIT 20s/48K、GT 45s/40K。
5. **验证**：冒烟 116/116（新增 Route 映射用例、API<24 断言）；release 构建成功；HAP 63 条目；审计仅有既有 `rotationvibrate` 与注释可选链警告；圆屏页 JS 均 <112KB（reader 79,388 B）。
6. **已知**：方屏/圆屏两套 HML/CSS 需同步；两张遮罩的 `.bin` 各约 205KB，HAP 增至 412KB；reader/search `.bc` 仍缺失（方屏+圆屏共 4 个快照失败）；GT 真机 `getInfo` 字段与视觉为发布阻塞项；GT2 454/390 不在范围。

## 五之四十、v1.0.8 → v1.1.1：P2/P3、小说搜索与 GT 紧急回退（2026-11-08～09）

> 版本 **1.1.1（1101）**，关于页 `Release V1.1.1`，发布页时间 2026-11-09 12:12:08。
> 冒烟 **133/133**；HAP 482,932 B（67 条目，`885B66FB…CC75F`）/ APP 468,480 B（3 条目，`71EDC3F5…5222`）。
> 本机无 Git；v1.0.7 基线备份：`DevEcoStudioProjects\_backup_LiteHarmonyBrowser_v107_preP2P3_20261108-170419`。

1. **v1.0.8（内部，2026-11-08 21:47）**：新增 P1 网络双口径（`respCapBytes` 字节 / `parseWindowChars` 字符，`layout.js` + `net.js`）；新增 P2 `common/pagesink.js` 单遍流式分页、P3 `common/pagestore.js` 章文件+页表、`common/scheduler.js` 突发预算/内存闸门；新增 `pages/novel` 与 `pages/round/novel` 小说搜索（Bing RSS）；首页/关于页增加设备能力（屏幕形态/性能体验）、强开完整模式、清除全部数据；`store` 增加 `forceFull`。HAP 63→67 条目。
2. **v1.0.9（内部，2026-11-08 21:55）**：只改 `pages/novel/novel.js`，`onQueryChange` 兼容 Lite `input change` 的三种回调形态（字符串 / `{value}` / `{text}`），`onSearch` 延迟 80ms 读取。
3. **v1.1.0（发布，2026-11-08 22:47）**：把 P3 `@system.file` 章文件落盘正式接入 reader（首帧后异步 `PageStore.save`，翻页优先 `PageStore.loadPage`，失败回退内存），以降低设备内存压力；小说搜索关键词/排除域名扩充；发布页另有设备能力/清除全部数据说明。
4. **v1.1.1（发布，2026-11-09 12:12）**：紧急修复 GT 误支持新特性。`reader.isFullMode()` 定义：`forceFull` 为 true 时全功能；否则圆屏（`p.round`）或 `apiVersion<=0/<24` 一律受限。受限档不创建 `PageSink`、不落盘/读盘、`Sched.scheduleFileOp` 的 burstLimit=1；使用整串 `Html.parse` + `Paginate.paginate` + `Paginate.pageText` 纯内存路径。圆屏 `respCapBytes` 从 64KB 回退 **40KB**，解析窗口 **32K 字符**。`apiVersion` 防御解析（number 直接用 / string 取首段 / 0·NaN·缺失按最慢档）。
5. **v1.1.1 其它改动**：`html.js` 新增 `stripHtmlFragments`（清理畸形标签/属性残片）、`skip` 保护（script/style 内文本不再当正文）、`isPuaEncrypted`（U+E000~U+F8FF >10 提示字体加密），实体表扩充；`NOISE_WORDS` 扩充小说站 UI 词；`pages/round/novel/novel.hml/.css` 改独立 466×466 布局（340 内容列、页头 y=56、上下弧形遮罩），不再复用方屏动态几何。
6. **改动文件**：新增 `common/pagesink.js` / `pagestore.js` / `scheduler.js`、`pages/novel/*`、`pages/round/novel/*`；修改 `common/html.js`（+171/-19）、`pages/reader/reader.js`（+93/-6）、`pages/index/index.js`（+64/-7）、`pages/index/index.hml`（+51）、`common/layout.js`（+35/-8）、`common/net.js`（+15/-13）、`common/store.js`（+9/-5）、`common/config.js`、`config.json`、`app.json5`、`tools/smoke.js`（+192，133 条）。
7. **验证**：`node tools/smoke.js` 133/133；2026-11-09 12:06:07、12:08:01 两次 BUILD SUCCESSFUL；HAP 67 条目 / APP 3 条目。`reader.bc`、`round/reader.bc`、`search.bc`、`round/search.bc` 缺失（jerry-snapshot 64KB 堆限制），功能正常、冷启动慢 0.5~1s。
8. **已知缺口**：`scheduler.memoryGate/degrade` 与优先级队列只在 `smoke.js` 单测中使用，未接入 reader 主链路；P3 只服务完整档；`forceFull` 在弱设备上可能复现 1.1.0 崩溃；GT7/GT6/FIT4/GTR2 本机无真机，1.1.1 修复依据为发布说明与代码逻辑，仍需社区回归。
9. **1.0.8 P2/P3 真机待验清单**：`轻鸿蒙开发\交付-真机待验清单-v1.0.8-P2P3.md`（22 项 + P0 探针 5 项），当前仍建议逐项补测。

## 六、待办（按优先级）

> **2026-11-26 更新**：当前优先项已变为 **v1.1.1 GT 受限档真机回归 + FIT5 完整档 P2/P3 回归**（见五之四十第 8~9 条与 `交付-真机待验清单-v1.0.8-P2P3.md`）。以下 0~6 为 v1.0.3/v1.0.7 历史待办，除 bin 安装链路外多数已被后续版本覆盖，保留作背景。

0. **真机验证 bin 格式包（最重要，见 `交付-轻鸿浏览器-v1.0.3-开发分支/开发分支交付说明.md`）**：
   - 用 `dist\signed-bin\LiteHarmonyBrowser-v1.0.3-signed-bin.hap`（991,082 B）经应用调测助手安装，确认**可安装、可启动**；
   - 失败请记录错误码（40 配置 / 10 内部 / 31 / 解压失败）与发生阶段；
   - 装前先卸载手表旧版（不同证书或更高 versionCode 会被拒）。
1. **真机回归 v1.0.3**：长章 `read/933334/3` 保存离线（4,600 字 / 4 片 / ≤6 次调用）不卡死不崩；离线列表可见可打开；超长章节末尾截断提示；重复保存覆盖不重复；常规回归（翻页/目录/表冠/屏幕常亮/清除数据）。





1. **真机验证 Release V1.0（修订 3：标题放大，见 交付-轻鸿浏览器-Release-V1.0/交付说明.md 第七节）**：
   - **首页标题**：36px 观感、左上角未被圆角裁切、与帘/列表间距不变；
   - **表冠（核心）**：左滑打开操作页 → 表冠上下滚动工具列表；关闭后再开仍可滚；搜索结果页结果列表可滚；
   - **清除数据**：胶囊文字上下左右严格居中；
   - **冷启动**：直接进入首页（无闪屏），与 v3.10.0 一致；
   - 常规回归：阅读/搜索/离线/屏幕常亮。
1. **真机验证三连修（1.9.1）**：
   - **超时修复**：打开 `https://luoxiadushu.com/longzu/` 应能正常显示（20s 超时 + 超限截断放行 + cache 异常不再炸 onBody）；
   - **小说站阅读流**：书名页应出现「开始阅读 ›」「目录」控件 → 点「开始阅读」直达第一章 → 章节末尾三键导航行（上一章/目录/下一章）→ 「目录」里章节链接置顶；
   - ~~缓存秒开~~：**网页缓存已于 3.3 删除**（连同「重试」的强制刷新语义），同一篇二次打开走网络属预期。
2. **书签/历史 storage 128B 风险**：~~迁移 file~~ **v3.1 已迁移到 @system.file（A1）**，此条仅余真机复验「多条保存跨重启不丢」；
2. ~~真机验证本地缓存语义（1.9.0）~~：**缓存功能 3.3 已删除**，该验证项作废；
2. **真机验证搜索全链路**（1.6.0，v3.3 语义更新）：搜索 → 10 条大字结果（**一次入列上下滑动，无翻页**）→ 点条目进摘要视图（同页）→ 「返回」回列表**结果原样保留** → 「访问」进 reader；
2. **真机验证黑蓝新 UI**：各页文字可读性、控件命中区、摘要区 `overflow: scroll` 触摸滚动是否生效（不可滚则长摘要末尾裁切，可接受降级）；
3. **真机验证手势回归**：右滑返回（摘要视图回列表、列表回首页）、上下滑动翻页；
4. **真机验证联网链路**：确认 gzip 自动解压、`Range` 与压缩共存时正文正常；
5. **正文提取继续增强**：目录页识别（章节列表页直接给「章节列表」入口）、正文段间距、`<pre>` 保留缩进；
6. **`docs/install.md` 回改**：文中「48KB 限制」「字段补丁手工流程」等历史结论已被推翻，应以本文与 `tools/pack-app.ps1` 为准；

## 七、构建与打包（一条命令）

```powershell
pwsh -File tools/build.ps1
```

等价的手工三步：

```powershell
$env:NODE_HOME="C:\Program Files\Huawei\DevEco Studio\tools\node"
$env:DEVECO_SDK_HOME="C:\Program Files\Huawei\DevEco Studio\sdk"
$env:PATH="C:\Program Files\Huawei\DevEco Studio\jbr\bin;$env:NODE_HOME;$env:PATH"
Set-Location "<repo>"

# 1) 冒烟测试（纯函数模块）
node tools\smoke.js

# 2) 构建 release hap
& "C:\Program Files\Huawei\DevEco Studio\tools\hvigor\bin\hvigorw.bat" `
  --mode module -p product=default -p buildMode=release assembleHap --no-daemon

# 3) 打补丁包 + 组装 .app（产物在 dist/unsigned/）
pwsh -File tools\pack-app.ps1
```

签名命令见 `docs/install.md` 第 5 节（`hap-sign-tool sign-app`，密码与别名按本地材料填写）。

## 八、已知风险与坑

- **卡死后必须重启手表**（安装器进程残留会导致后续安装全部失败）；
- **jerry-snapshot 工具堆只有 64KB**：构建时单页编译产物超过约 45KB 源码会报 `ERR_OUT_OF_MEMORY`、`.bc` 快照缺失（运行时退回解析 .js，功能正常但冷启动慢）。**改 reader.js / html.js / store.js 等大模块后必须确认 `reader.bc` 重新生成**（构建日志出现 `Failed to convert the reader.js file to a snapshot` 即中招），瘦身方向参考 1.4.0：把只被单页用的辅助函数移出 common；
- 构建前若 `entry/build` 里残留调试文件（如模拟器字体 `config/SourceHanSansSC-Regular.otf` 17MB）会被打进 hap，**定期清理 `entry/build`**；
- 模拟器手动启动（`Simulator.exe` 直启）时页面停在 `current state(2) is invalid`，`onShow`、`setTimeout` 和点击事件都不派发，只能验证 init 阶段的渲染；
- 调试用的模拟器字体路径：SDK 的 `previewer\liteWearable\bin\config\`（工作目录设为 bin 才能加载）；
- 分页与 `list` 组件同时使用时，**页面只渲染当前页切片**（`data.items` / `data.links` 是切片，不是全量），`onOpen(index)` 的 `index` 是切片内下标，不要拿它去索引全量数组。

## 九、相关文档

- `docs/device-fit5pro.md`：设备实测参数与推导结论
- `docs/install.md`：安装流程与签名命令（部分历史结论已过时，见第六节第 4 条）
- `spec/lite-web-reader/{spec,plan,tasks}.md`：需求/设计/任务（Phase 1~9 全部完成）
- 技能规范：`memory-and-runtime.md`（性能基线 + JS 体积边界）、`device-compatibility.md`（FIT 5 Pro 实测档案）









