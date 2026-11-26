# Implementation Plan: 轻鸿蒙浏览器（Lite Wearable 正文阅读浏览器）

**Input**: Feature specification from `spec/lite-web-reader/spec.md`

**Note**: 本计划基于 2026-11-03 对目标平台与本机工具链的实测结论编写；所有路径为绝对路径。**首要约束是 JerryScript 800KB JS 堆**，所有数据结构、缓存与渲染策略均以此为上限反推。

## Summary

在 WATCH FIT 5 系列（Lite Wearable / ArkUI.Lite）上，用 **FA 模型 + 兼容 JS 的类 Web 范式（HML + CSS + ES5 子集 JS）** 实现一个正文阅读型浏览器：抓取网页 → 抽取标题/正文/链接 → 按 408×480 分页 → 逐页阅读，并支持链接跳转、书签、历史、阅读设置与离线示例。

四条硬约束决定了全部设计：

1. **JerryScript JS 堆上限 800KB** —— 不是"建议"，是红线。原文、正文、分页结果、导航栈必须共享同一份字符串，禁止复制；
2. **Lite Wearable 组件白名单只有 22 个标签**，且**没有 `scroll`、没有 `button`、没有 `span/textarea`** —— 因此翻页必须自己做，容器必须显式宽高；
3. 平台无 WebView/ArkWeb、无 `@ohos.net.http`，因此"浏览"只能是**文本抽取 + 重排 + 分页**；
4. 模块内**禁止正则字面量**、不支持 Promise/async、单页 JS ≤ 48KB。

## Technical Context

**Language/Version**: JavaScript（ES5.1 语法子集，ArkUI.Lite 兼容 JS 范式）+ HML + CSS；构建工具链 API 26（本机 SDK `26.0.0.38`）

**Primary Dependencies**: 仅平台内置模块 —— `@system.fetch`（网络）、`@system.storage`（持久化）、`@system.router`（路由）、`@system.device`（屏幕信息）、`@system.network`（网络类型）、`@system.prompt`（轻提示）；**零第三方库**

**State Management**: N/A（非 ArkTS 工程）。页面用 `data` + 事件驱动；跨页共享状态由模块级单例 `common/session.js` 承载，且**最多同时保留 2 份完整文档**

**Storage**: `@system.storage` 键值持久化，3 个键：`lwb_bookmarks`、`lwb_history`、`lwb_prefs`（JSON 字符串，总量控制在 20KB 内）

**Testing**: 三层——(1) Node 冒烟脚本直接 `require` 纯 JS 公共模块做解析/分页断言；(2) headless Lite Simulator 逐页启动 + WebSocket 帧截图 + 日志断言；(3) 真机人工验收

**Target Platform**: WATCH FIT 5 系列，`deviceType: ["liteWearable"]`，408×480 竖屏矩形屏（四角圆角），64MB RAM，64GB 存储，HarmonyOS 7.0.0 / API 26

**Project Type**: HarmonyOS FA 模型 Lite Wearable 应用（非 Stage / 非 ArkTS）

**Performance Goals**: 单页翻页 ≤ 300ms（纯字符串切片，应 < 20ms）；冷启动到首页可交互 ≤ 3s；5 万字正文一次分页 ≤ 1.5s；128KB HTML 解析 ≤ 800ms

**Constraints**:
- **JerryScript JS 堆 ≤ 800KB**（全应用共享，含代码、字符串、对象）
- 单页打包 JS ≤ 48KB；禁止正则字面量；禁止 Promise / async / await
- 组件必须落在 Lite 白名单内（见 D13）
- 无文本测量 API，分页靠字宽估算
- 目标设备不支持 hdc 无线调试，自动化无法驱动真机
- 构建走 `devecocli build --modules entry`，产物需为 **signed** HAP

**Scale/Scope**: 5 个页面 + 8 个公共模块 + 1 个 Node 冒烟脚本 + 1 个帧抓取脚本

### Memory Budget（800KB 硬约束）

**堆占用预算表（最坏情况）**

| 项 | 预算 | 说明 |
|----|------|------|
| 当前页 JS 代码 + 框架胶水 | 60KB | 单页 bundle ≤ 48KB，含运行时胶水 |
| 原始 HTML | ≤ 128KB | 硬截断；解析完成后立即置空 |
| 抽取后的正文 | ≤ 150KB | 5 万字中文按 CESU-8 约 3 字节/字 |
| 解析临时数组（片段引用） | ≤ 40KB | 只存源串的切片引用，join 一次成文 |
| 分页结果 | ≤ 6KB | **只存页起始偏移的数字数组**，不存页面字符串 |
| 当前页渲染文本 | ≤ 3KB | 每次只 `substr` 一页 |
| 链接列表 | ≤ 20KB | ≤ 40 条 ×（锚文本 ≤ 60 字 + 地址 ≤ 200 字） |
| 会话栈 | ≤ 300KB | 最多同时保留 **2 份**完整文档 |
| 书签/历史/偏好 | ≤ 20KB | 各上限 50 条，单条标题 ≤ 40 字 |
| 其它对象与事件 | ≤ 60KB | 页面 data、事件参数、错误对象 |
| **合计峰值** | **≈ 660KB** | 预留约 140KB 余量，避免触发堆上限 |

**强制规则**

1. **单一字符串原则**：正文只保存一份；分页只记录偏移；渲染只切片当前页。
2. **原文即弃**：`html.parse` 返回后立刻把原始 HTML 变量置 `null`，让引擎可回收。
3. **禁止深拷贝**：不使用 `JSON.parse(JSON.stringify(x))` 做复制；书签/历史只保存最小字段。
4. **禁止整篇渲染**：不把整篇文章塞进一个 `text` 节点，也不为每一页创建节点。
5. **列表上限**：任何 `for` 渲染的数组长度 ≤ 50；超出部分分页加载。
6. **导航栈降级**：只保留最近 2 份文档；更早的帧退化为"地址 + 页码 + 标题"，返回时按需重新抓取并跳回原页码。
7. **构建期校验**：构建后统计各页 bundle 体积；单页 > 40KB 视为风险，> 48KB 直接失败。

## Project Structure

### Documentation (this feature)

```text
<repo>\spec\lite-web-reader\
├── spec.md              # 需求规格
├── plan.md              # 本文件
└── tasks.md             # 任务拆解（Phase 3 产出）
```

### Source Code (repository root)

```text
<repo>\
├── AppScope\
│   └── app.json5                                  # bundleName 等应用级配置（devecocli 需要）
├── build-profile.json5                            # 产品配置 + signingConfigs（default）
├── hvigorfile.ts                                  # legacyAppTasks（FA 模式）
├── oh-package.json5
├── hvigor\
│   └── hvigor-config.json5
├── tools\
│   ├── smoke.js                                   # Node 冒烟：url/html/paginate/sample 纯函数
│   └── capture-frame.js                           # 连接 Simulator 的 -lws 端口，落帧为 JPEG
└── entry\
    ├── build-profile.json5                        # apiType: "faMode"
    ├── hvigorfile.ts                              # legacyHapTasks
    ├── oh-package.json5
    └── src\main\
        ├── config.json                            # app + module + js pages + deviceType: liteWearable
        ├── resources\
        │   └── base\
        │       ├── element\string.json            # 应用名"轻鸿蒙浏览器"、页面文案
        │       ├── element\color.json
        │       └── media\icon.png                 # 复用模板图标资源
        └── js\MainAbility\
            ├── app.js                             # 生命周期；初始化偏好
            ├── common\
            │   ├── config.js                      # 尺寸/字号/上限/存储键/文案常量
            │   ├── url.js                         # 地址规范化、协议补全、host 提取、相对地址解析
            │   ├── html.js                        # 标题/正文/链接抽取（无正则单遍扫描）
            │   ├── paginate.js                    # 字宽估算；输出**页起始偏移数组**
            │   ├── net.js                         # fetch 封装：序号令牌、超时、失败分类
            │   ├── store.js                       # 书签/历史/偏好的读写与裁剪
            │   ├── sample.js                      # 内置离线示例文章（约 1.2 千字）
            │   └── session.js                     # 会话单例：当前文档、页码、导航栈（≤2 份文档）
            └── pages\
                ├── index\    index.hml / index.css / index.js
                ├── reader\   reader.hml / reader.css / reader.js
                ├── links\    links.hml / links.css / links.js
                ├── shelf\    shelf.hml / shelf.css / shelf.js
                └── settings\ settings.hml / settings.css / settings.js
```

**Structure Decision**: 新工程，选择 **Light 层**（页面 + 单一 `common` 目录），不采用 MVVM 目录。理由：

- JS FA 模型没有 ArkTS 的 `viewmodel/` 概念，套用只增加目录噪声；
- 业务复杂度集中在 4 个纯函数模块（解析、分页、地址、存储），无跨页复杂状态机；
- **48KB/页 + 800KB 堆** 决定了文件越多、重复打入的公共代码越多，Light 层是体积最优解；
- 页面职责已清晰分离，满足"页面只管装配、算法只在 common"的边界要求。

## Complexity Tracking

| 项目 | 为何必要 | 更简单的方案为何不可行 |
|------|----------|------------------------|
| 会话单例 `session.js` | 路由切页会重建页面，阅读位置与导航栈必须跨页保活 | 用 router 参数传整篇正文会撑爆参数与 800KB 堆，且每页重建都会重新解析 |
| 分页输出偏移而非字符串 | 5 万字正文若切成分页字符串会再复制 150KB，直接逼近堆上限 | 存字符串数组最直观，但内存翻倍，长文必崩 |
| 手写无正则扫描器 | Lite 模块含正则字面量会导致**加载即失败** | 用正则最省代码，但会让页面白屏，属平台级硬限制 |
| 独立的帧抓取脚本 | 自动化验收需要在无窗口模拟器上取证 | 无输入通道、无 hdc，常规 UI 测试框架不可用 |

## Research & Decisions

### D1. 工程形态：手写 FA + Lite JS 工程，不使用 `devecocli create`

- **Decision**: 手工创建 FA 模型 Lite Wearable 工程骨架（`entry/src/main/config.json` + `entry/src/main/js/MainAbility/`），不依赖脚手架生成。
- **Rationale**: 实测 `devecocli create --help` 的 `--device-types` 仅支持 `phone/tablet/2in1/car/wearable/tv`，**没有 `liteWearable`**；它生成的是 Stage/ArkTS 工程，与本平台不兼容。DevEco `[Lite]Empty Ability` 模板确认落盘布局为 `src/main/config.json` + `src/main/js/<abilityName>/`（`command.xml.ftl` 的 dest 路径）。
- **Alternatives considered**: (a) 用 `devecocli create --device-types wearable` 再改造 —— 会产出 Stage 工程，改造量大于手写；(b) 复制 DevEco 模板目录 —— 模板是 `.ftl` 片段而非完整工程。

### D2. SDK 与版本号：compile 26 / target `"6.1.0(23)"` / compatible `"5.0.0(12)"` / runtimeOS HarmonyOS

- **Decision**: 根 `build-profile.json5` 使用 `"compileSdkVersion": "26.0.0"`、`"targetSdkVersion": "6.1.0(23)"`、`"compatibleSdkVersion": "5.0.0(12)"`、`"runtimeOS": "HarmonyOS"`；模块级 `entry/build-profile.json5` 设 `"apiType": "faMode"`。
- **Rationale**: 本机仅安装 OpenHarmony SDK `26.0.0`（另有 20/23），没有 HarmonyOS `7.0.0(26)` SDK，因此 `"7.0.0(26)"` 会被 hvigor 以 `00303082` 拒绝。而 `"26.0.0"` 会被编码为 `target: 260000026`（版本 26.0.0 + API 26），安装器按版本 26.0.0 解析、判定高于设备 7.0.0，直接拒绝安装（现场表现为“解压失败”）。改成 `"6.1.0(23)"` 后编码为 `60100023`（6.1.0 + API 23），低于设备的 7.0.0(26)，可安装；本项目使用的 `@system.*` 能力均 ≤ API 9，target 23 不损失任何功能。
- **Alternatives considered**: `"26.0.0"`（编码错误，装不上，已实测）；`"7.0.0(26)"`（SDK 不存在，构建失败，已实测）；安装 HarmonyOS SDK（离线不可行）。

### D3. "网页浏览"的技术定义：文本抽取 + 重排 + 分页

- **Decision**: 不追求网页原貌，抓取后抽取标题、正文纯文本、链接清单，按屏宽字宽估算重新折行分页。
- **Rationale**: 平台无 WebView/ArkWeb，也无 `@ohos.net.http`；`@system.fetch` 是唯一可用的网络入口。文本流是唯一能在 64MB 内存与 1.8 英寸屏上稳定呈现的形态，与 spec 的产品定义一致。
- **Alternatives considered**: 服务端渲染成图片（需自建后端，违反"不引入后台依赖"）；引入第三方 HTML 渲染库（体积与正则限制双重不可行）。

### D4. 解析实现：无正则单遍扫描器

- **Decision**: `html.js` / `url.js` 全部用 `indexOf` / `charAt` / 手写状态机实现，禁止出现任何 `/.../` 字面量。
- **Rationale**: 平台坑——被页面 `require` 的模块只要含正则字面量，模块 eval 前即抛 `TypeError: wrong type of argument`，表现为整页白屏且极难定位。
- **Alternatives considered**: `new RegExp('...')` 构造式（本平台同样不可靠）；引入解析库（体积 + 正则双重不可行）。

### D5. 网络：`@system.fetch` + 请求序号令牌 + 超时守卫 + 能力探测

- **Decision**: 统一走 `net.js`：GET、`responseType: 'text'`、携带可读 UA 与 `Accept-Language`；每次请求分配自增序号，回调时序号不匹配即丢弃；`setTimeout` 做客户端超时（默认 12s）；启动时 `canIUse('SystemCapability.Communication.NetStack')` 探测。
- **Rationale**: `@system.fetch` 的声明未标注 liteWearable 保留字，实际放行需实测；序号令牌满足 FR-004；平台无 AbortController，超时只能靠守卫 + 忽略迟到结果。
- **Alternatives considered**: `@ohos.net.http`（仅 Stage 模型）；`@system.request`（面向下载任务，Lite 支持更不确定）。

### D6. 编码处理：依赖平台解码 + BOM 清理 + 明示降级

- **Decision**: 以 UTF-8 为主路径：去除 BOM、记录 `Content-Type` 的 charset；对声明非 UTF-8 的页面仍按平台返回内容展示，并提示编码来源。不自建 GBK 码表。
- **Rationale**: 完整 GBK→Unicode 映射约 2.4 万字符，展开后远超单页 48KB 与 800KB 堆；平台 `fetch` 通常已按响应头完成解码。
- **Alternatives considered**: 内置 GBK 表（体积不可行）；非 UTF-8 直接报错（过度激进，会把可读页面变成失败页）。

### D7. 跨页状态：模块级会话单例（最多保留 2 份文档）

- **Decision**: `common/session.js` 持有 `current`（当前文档）、`pageIndex`、`frames`（导航栈）。每帧记录 `url / title / pageIndex / doc`；**全局最多保留 2 份 `doc`**，更早的帧释放 `doc`（置空），返回时按 `url` 重新抓取并恢复 `pageIndex`。
- **Rationale**: 800KB 堆下 3 份 5 万字文档即 ~450KB，加上原文与解析临时量会顶爆；保留 2 份可覆盖"A→B 来回"这一最高频路径，更深返回用一次重抓换内存安全。
- **Alternatives considered**: 全部帧保留文档（内存不可控）；全部帧只存 URL（返回必重抓，破坏体验）。

### D8. 持久化：`@system.storage` 三键 + 上限裁剪 + 失败降级

- **Decision**: `lwb_bookmarks` / `lwb_history` / `lwb_prefs` 三个 JSON 字符串键；书签与历史各上限 **50** 条，超出淘汰最旧；单条标题截断 40 字、地址 300 字；读写异常一律捕获并返回安全默认值。
- **Rationale**: `@system.storage` 是 Lite 上可用的键值能力，单值体积有限；50 条可在 20KB 内闭环，也避免列表渲染过多节点。
- **Alternatives considered**: 文件读写（`@system.file` 在 Lite 上可用性更不确定）；每条一个键（键数量膨胀，遍历成本高）。

### D9. 分页：字符宽度估算 + 固定行高 + **偏移数组**

- **Decision**: 按字号推导单字宽度（CJK/全角 ≈ 1.0×字号，ASCII ≈ 0.55×字号，标点按全角处理），逐字符累加折行；每页行数 = 正文区高度 ÷ 行高 取整；输出**每页起始字符偏移的数组**，渲染时对正文做一次 `substr` 取当前页。
- **Rationale**: 无文本测量 API，只能估算；估算须偏保守（宁可少放几个字）保证零横向溢出。偏移数组让分页结果从 ~150KB 降到 ~6KB，是 800KB 堆下的关键设计。
- **Alternatives considered**: 直接产出分页字符串数组（内存翻倍，长文必崩）；固定字数切分（中英混排会溢出或大量留白）。

### D10. 输入：`input type="text"` + 系统输入法，离线示例兜底

- **Decision**: 首页地址输入使用 `<input type="text" placeholder="..." value="{{addr}}">` 承担系统输入法，确认动作用同宽 `div` 或 `<input type="button">`；不实现自绘键盘。首页同时提供"离线示例"与书签/历史直达入口。
- **Rationale**: 用户明确选择"仅用系统输入法"；白名单中 `input` 支持 `type=text/password/button/checkbox/radio`、`value/placeholder/maxlength`、事件 `change`。模拟器无法唤起 IME 属已知限制，兜底入口既满足 FR-024，也让自动化验证可执行。
- **Alternatives considered**: 自绘 42 键键盘（用户已排除，且增加约 6KB 与一套按键布局）；仅输入法无兜底（模拟器完全不可验证，违反 FR-024）。

### D11. 验证策略：构建 + 帧取证 + 真机人工

- **Decision**: 三层取证——(1) `devecocli build --modules entry` 成功并产出 `entry-default-signed.hap`；(2) Node 冒烟脚本对纯函数模块跑断言（含内存风格的"分页只产出数字数组"检查）；(3) headless Lite Simulator 以 `-or 408 480 -cr 408 480 -shape rect -lws <port>` 启动，逐页用 `-url pages/<name>/<name>` 打开，抓帧落 JPEG 并检查日志无 `[JS Error]` / `[ACELite][ERROR]`，再用多模态识别核对页面结构。交互类断言由真机人工完成。
- **Rationale**: 真机不支持 hdc 无线调试；`devecocli run/ui/verify` 对 Lite 模拟器不适用（CLI 启动无命令通道，不接受点击）。
- **Alternatives considered**: 尝试 IDE 的 `-s` socket 通道模拟点击（协议未公开）；纯人工验证（回归成本过高）。

### D12. 包名：复用 `com.example.litewearbrowser`；签名材料重新生成

- **Decision**: `bundleName` 固定为 `com.example.litewearbrowser`，应用显示名为"轻鸿蒙浏览器"；签名配置不再手工登记旧材料，改用 `devecocli signature generate --type debug` 自动生成并写入工程配置。
- **Rationale**: 本机 `~/.ohos/config/` 虽留有该包名的 debug `.p12/.cer/.p7b`，但 build-profile 所需的 **storePassword / keyAlias / keyPassword 是 DevEco 加密串且已随旧工程删除而丢失**，无法直接复用。`devecocli auth status` 显示开发者账号已登录，`signature generate` 可自动生成材料并写入 `build-profile.json5`，是当前唯一可复现的签名路径。保留包名可与手表上可能残留的同名包保持连续（安装前仍需卸载旧包）。
- **Alternatives considered**: 手工登记旧材料（密码不可得）；新包名（无额外收益，且需在 AGC 重新绑定）。

### D13. Lite 组件白名单：以 SDK 编译映射为准，优先于通用 ArkUI JS 文档

- **Decision**: 只使用以下 22 个标签：`div`、`text`、`image`、`list`、`list-item`、`stack`、`swiper`、`tabs`、`tab-bar`、`tab-content`、`progress`、`input`、`slider`、`switch`、`picker-view`、`marquee`、`chart`、`canvas`、`qrcode`、`image-animator`、`analog-clock`、`clock-hand`。常用事件：`click`、`longpress`、`touchstart`、`touchmove`、`touchend`、`swipe`、`key`。
- **Rationale**: 该清单来自本机 SDK `js/build-tools/ace-loader/lib/templater/lite_component_map.js` 的 `litewearableTag`（API 26 实际参与编译校验），比通用 ArkUI JS 组件文档更严格、更权威。通用文档中的 `button`、`scroll`、`span`、`textarea` **在 Lite Wearable 上不存在**，误用会编译失败或运行异常。
- **Alternatives considered**: 按通用 ArkUI JS 文档选型（会用到 `button`/`scroll`，直接失败）。
- **配套约束**：`if/elif/else` 必须是兄弟节点；`for` 渲染的数组元素必须有唯一 `tid` 字段；数组更新用 `splice` 触发刷新；嵌套容器必须显式 `width`/`height`（否则高度塌陷为 0）。

### D14. 翻页交互：点击热区为主，`swipe` 事件为辅

- **Decision**: 正文区左右各设 1/3 宽的透明点击热区（`div` + `click`），点击左/右翻页；同时监听容器的 `swipe` 事件做上下滑翻页，回调中对事件对象做存在性判断，取不到方向时静默忽略。
- **Rationale**: 白名单无 `scroll`，翻页必须自己实现；`click` 在 Lite 上最稳定（真机与模拟器均可触发），`swipe` 作为增强但不可作为唯一手段。不使用 `swiper` 承载上百页——会为每页建节点，直接击穿 800KB 堆。
- **Alternatives considered**: `swiper` 分页（节点数爆炸）；仅 `swipe`（事件对象结构在 Lite 上未文档化，风险高）。

### D15. 已知风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| `@system.fetch` 在 liteWearable 上被系统拦截 | 核心功能不可用 | 启动即 `canIUse` 探测；失败归入"网络不可用"失败态并引导离线示例；真机首轮验证优先确认此项 |
| `input` 无法唤起系统 IME | 无法输入地址 | 保留书签/历史/离线示例直达路径；真机确认后再决定是否补自绘键盘 |
| 5 万字正文 + 链接对象逼近 800KB | 堆溢出崩溃 | 见 Memory Budget；构建期与冒烟脚本双重校验；实测超限时下调正文上限并同步调整提示文案 |
| 单页 JS 超过 48KB | 构建失败 | 公共模块按需引入；离线示例控制约 1.2 千字；构建后检查各页 bundle 体积 |
| 明文 HTTP 被拒 | 部分站点打不开 | HTTPS 优先；失败归入"目标不可达"并提示 |
| 非 UTF-8 页面乱码 | 可读性下降 | 见 D6：明示编码来源，不承诺转码 |
| 圆角屏裁切 | 文字/页码被切 | 统一 12px 安全边距 + 顶部 8px 额外内缩；分页宽度按 408-2×12 计算 |

## Data Model

### 实体与字段

| 实体 | 字段 | 说明 |
|------|------|------|
| Document | `url`、`title`、`text`、`links[]`、`fetchedAt`、`status`、`failReason`、`truncated` | 一次抓取的产物；`status` ∈ `loading / ok / empty / failed` |
| LinkItem | `text`、`href` | `href` 为已解析的绝对地址；`text` 为空时由 `href` 派生可读形式；最多 40 条 |
| Bookmark | `url`、`title`、`savedAt` | 以 `url` 去重；再次收藏视为更新 |
| HistoryEntry | `url`、`title`、`visitedAt` | 以 `url` 去重并前移；上限 50 |
| Prefs | `fontSize`、`lineHeight`、`theme` | `fontSize` ∈ {16,18,20,22}；`lineHeight` ∈ {1.5,1.7,1.9}；`theme` ∈ {light,dark} |
| SessionFrame | `url`、`title`、`pageIndex`、`doc`（可为空） | 栈元素；`pageIndex` 为 0 基；`doc` 为空表示需重抓 |
| PageIndex | `starts[]`（字符偏移）、`pageCount`、`layoutKey` | **不保存页面文本**；`layoutKey` = 字号+行距+宽度 |

### 状态流转

- **抓取**：`idle → loading → (ok | empty | failed)`；`failed` 细分 `offline / timeout / unreachable / unsupported`。
- **阅读**：`pageIndex` 在 `[0, pageCount-1]` 内钳制；字号变化触发重分页，并按"当前页首字符偏移 ÷ 正文总长"映射到新页，避免跳回第 1 页。
- **导航栈**：`push(url, doc, pageIndex)` / `pop()`；`pop` 出的帧若无 `doc`，先展示加载态并重新抓取，成功后定位到 `pageIndex`；栈空时返回首页。

### 校验规则

- 地址：去首尾空白 → 不含 `://` 则补 `https://` → 必须含主机名且不含空格；否则判定非法，不发起请求。
- 标题：`<title>` → 首个 `<h1>` → 主机名 → 原文地址。
- 正文：抽取后有效字符 < 20 → `empty`。
- 正文长度：超过 50000 字截断并置 `truncated = true`。
- 源文档：超过 131072 字节（128KB）截断后再解析，并置 `truncated = true`。
- 链接：超过 40 条截断；单条锚文本 60 字、地址 200 字截断。

### 存储键

| 键 | 值形态 | 上限 | 失败策略 |
|----|--------|------|----------|
| `lwb_bookmarks` | JSON 数组（Bookmark） | 50 条 | 读失败返回 `[]`；写失败提示"保存失败" |
| `lwb_history` | JSON 数组（HistoryEntry） | 50 条 | 读失败返回 `[]`；写失败静默 |
| `lwb_prefs` | JSON 对象（Prefs） | 1 条 | 读失败用默认值；写失败提示一次 |

## Contracts & Interfaces

### 页面路由契约

| 路由 | 入参 | 职责 | 无入参时的行为 |
|------|------|------|----------------|
| `pages/index/index` | 无 | 首页：地址输入、最近阅读、书签/历史入口、离线示例入口 | — |
| `pages/reader/reader` | `url`（字符串，可选） | 抓取并分页展示正文；翻页；收藏；进入链接/设置 | 回落到会话当前文档；会话为空则展示离线示例 |
| `pages/links/links` | 无 | 展示当前文档链接清单并跳转 | 会话为空 → 空态"暂无链接" |
| `pages/shelf/shelf` | `tab`（`bookmark` / `history`，可选） | 书签与历史列表、删除、清空 | 默认 `bookmark` |
| `pages/settings/settings` | 无 | 字号/行距/主题调整 | 使用当前偏好 |

**路由约束**：所有页面必须能**独立启动并渲染**（用于 headless 验证），不得依赖前一页传参才能出内容。

### 公共模块契约

| 模块 | 职责 | 关键契约 |
|------|------|----------|
| `config.js` | 常量 | 屏幕基准 408×480、安全边距 12、页头 44、页脚 46、字号档位、各类上限（128KB / 5 万字 / 40 链接 / 50 条存储）、存储键、文案 |
| `url.js` | 地址处理 | `normalize(input)` → 合法地址或空；`resolve(base, href)` → 绝对地址或空；`hostOf(url)`；`displayOf(url)` |
| `html.js` | 内容抽取 | `parse(rawHtml, pageUrl)` → `{title, text, links[], truncated}`；纯函数、无正则、单遍扫描、对畸形标签容错；内部不得长期持有 rawHtml |
| `paginate.js` | 分页 | `paginate(text, layout)` → `{starts[], pageCount}`；`pageText(text, starts, i)` → 当前页字符串；空文本返回 1 页 |
| `net.js` | 网络 | `fetchText(url, callbacks)` → `{seq}`；回调 `onSuccess(text, meta)` / `onFail(reason)`；`reason` ∈ `offline / timeout / unreachable / unsupported`；只认最新序号 |
| `store.js` | 持久化 | `loadBookmarks / saveBookmark / removeBookmark`、`loadHistory / addHistory / clearHistory`、`loadPrefs / savePrefs`；同步返回安全默认值 |
| `sample.js` | 离线内容 | `getSample()` → `Document` 形态对象（约 1.2 千字 + 3~5 条示例链接） |
| `session.js` | 会话 | `getCurrent / setCurrent / getPage / setPage / push / pop / reset / stackSize`；保证同时持有 `doc` 的帧 ≤ 2 |

**跨模块约定**：CommonJS 导出；不得引用 DOM/`window`/正则字面量；不得返回 Promise；字符串按 UTF-16 码元处理，遍历用下标而非 `for...in`；不得对正文做深拷贝。

### 页面 UI 契约（408×480）

| 区域 | 尺寸 | 约束 |
|------|------|------|
| 安全边距 | 左右各 12，顶部 8 | 四角圆角区域不得放置可点元素 |
| 页头 | 高 44 | 左返回热区 34×34、中标题单行截断、右操作 34×34 |
| 正文区 | 高 386 | 宽 384；单行折行；禁止横向溢出；上下各 1/3 宽透明翻页热区 |
| 页脚 | 高 46 | 4 个等宽入口（链接/收藏/设置/页码），命中区 ≥ 40×40 |
| 首页 | 全屏 | 地址输入 40 高；下方"最近阅读 / 书签 / 历史 / 离线示例"，每个区块**显式高度** |

**组件落位（全部在白名单内）**：容器 `div`、文本 `text`、图标 `image`、可滚动列表 `list` + `list-item`、底部导航 `stack`/`div`、进度 `progress`、地址输入 `input type="text"`、开关 `switch`、档位选择 `slider` 或 `picker-view`。

**已知渲染坑（实现必须规避）**：嵌套容器无显式高度会塌陷；页面方法不得命名为 `render`；HML 条件渲染使用布尔字段；`if/elif/else` 必须兄弟节点；`for` 需唯一 `tid`；数组更新用 `splice`。

### 验证契约

| 项 | 契约 |
|----|------|
| 构建 | `devecocli build --modules entry` 退出码 0，且 `entry\build\default\outputs\default\entry-default-signed.hap` 存在 |
| 体积 | 每个页面打包 JS ≤ 48KB（目标 ≤ 40KB） |
| 冒烟 | `node tools\smoke.js` 退出码 0，覆盖地址规范化、HTML 抽取、分页偏移、离线示例、存储裁剪；并断言 `paginate` 返回的是数字数组而非字符串数组 |
| 帧取证 | `tools\capture-frame.js` 连接 `-lws <port>`，切掉 40 字节头后落 `*.jpg`；每页至少 1 帧 |
| 日志断言 | 模拟器输出中不出现 `[JS Error]`、`[ACELite][ERROR]`、`Expected a function`、`wrong type of argument` |
| 真机 | 交付 `entry-default-signed.hap` + 安装步骤；用户人工验收交互流程 |
