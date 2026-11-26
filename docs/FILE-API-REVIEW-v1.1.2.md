# @system.file 审查与缓存能力评估（v1.1.2）

> 依据：`huawei-lite-watch-development` skill 的 `references/file-and-storage-on-lite-wearable.md`、本机 SDK `@system.file.d.ts`、项目源码静态审查、冒烟与构建结果。
> 结论分级：**已修复** = 本版源码已改并有冒烟覆盖；**待真机** = 需要签名 HAP 上表验证；**建议** = 方案评估，未实施。

## 一、目标设备档案

| 字段 | 值 | 证据状态 |
|---|---|---|
| 型号 | HUAWEI WATCH FIT 5 Pro（方屏） / GT 系列（圆屏） | 项目实测/资料 |
| 屏幕 | 408×480 方屏；466×466 圆屏 | 实测/资料 |
| target / compatible | target 5.0.0(12)；compatible 4.0.0(10) | `config.json` |
| JS heap | FIT 5 Pro 实测约 698 KB；GT 档未知，按 64/256/512 KB 保守评估 | 实测 + 未知 |
| `@system.file` | since 3；SDK 标记 API 10 起不再维护；Lite 仍保留 | SDK 声明 |
| `@system.storage` | since 3；SDK 标记 API 6 起不再维护；单值 <128B | SDK/技能资料 |

## 二、发现与修复

### 1. 高：按字符分片会在 4 字节 UTF-8 字符上超 4KB（已修复）

- 源码：`common/fsutil.js:153`（`splitText`）、`common/saved.js:179`（`save`）。
- 场景：正文含 emoji、生僻字或补充平面字符时，1200 个字符最多 4800 B；`readText({length:4000})` 返回 302，离线网页/AI 正文读回不完整。
- 修复：`splitText` 同时限制 **1200 字符 + 3600 UTF-8 字节**；`saved.save` 改用该切片函数，不再用 `substr(index*1200)` 估算片数。
- 验证：新增冒烟 `splitText caps each part at 1200 chars and 3600 UTF-8 bytes`，146 条通过。

### 2. 高：`readSmall` 把“读取失败”当成“空文件”（已修复）

- 源码：`common/fsutil.js:342`（`readSmall`）、`common/store.js:246`（`loadDataset`）。
- 场景：文件服务超时/302/300 时返回空串；`store` 会把空串当成“没有书签/历史”，随后写空表覆盖原文件，或进入迁移分支删除旧数据。
- 修复：`readSmall` 增加 `done(text, ok, code)`；`store` 只有 `301`（不存在）才进入迁移/初始化，其他读错误保留内存值、不写空表；`saved.list` 也区分 `301` 与真实读错误。
- 代价：所有旧调用方仍可只接收第一个参数，兼容；新增错误状态不占常驻内存。

### 3. 高：迁移时“先删旧数据、后写新文件”（已修复）

- 源码：`common/store.js:246` 的 `loadDataset`。
- 场景：v3.1~v3.3 分片迁移到单文件时，旧实现并行发起 `writeSmall` 和 `quietDeleteRange`；写失败会留下“旧分片已删、新文件没有”的空数据。legacy storage 迁移同样先 `storage.delete` 后写文件。
- 修复：单文件写成功后才删旧分片/旧 storage key；写失败保留旧数据，下次启动重试。
- 验证：冒烟 146 条通过；真机需验证迁移路径。

### 4. 高：离线清单读失败时保存会覆盖整个清单（已修复）

- 源码：`common/saved.js:148`（`list`）、`common/saved.js:179`（`save`）、`common/saved.js:323`（`remove`）。
- 场景：`list.txt` 读取超时返回空清单，`save` 把新条目写成唯一一条，原有离线网页全部从清单消失。
- 修复：`list` 回调增加 `ok`；非 301 读错误时 `save/remove` 直接失败，不写清单；`remove` 改为“先写清单、后删分片”，清单写失败时旧条目仍可打开。

### 5. 中：AI 首次写分片会先发 24 次 delete（已修复）

- 源码：`common/fsutil.js:510`（`writeParts`）、`common/aistore.js:36`。
- 场景：`writeParts` 首次写某 base 时按 `maxParts` 清尾部旧片；AI 正文 `MAX_PARTS=24`，首次保存会先排队 24 个 `file.delete`（即使文件都不存在），增加文件服务压力。
- 修复：`writeParts` 支持 `{ terminate: true }`，在正文末尾写一个空终止片；`readParts` 读到空片即停。AI 首次保存从“24 delete + N write”降为“N write + 1 终止片”。
- 代价：每个 AI 正文多 1 个小文件；不改变读取语义。

### 6. 中：`ensureDir` 把所有 access/mkdir 失败都当成功（已加固）

- 源码：`common/fsutil.js:200`（`ensureDir`）。
- 场景：目录权限/IO 错误时旧实现仍 `end(true)`，调用方继续写文件；后续每个 writeText 都失败，且 `ensuredDirs` 本会话不再重试。
- 修复：access 只有 300/301 进入 mkdir；mkdir 明确失败时重置 `ensuredDirs` 并返回 false；回调丢失仍按原守卫推进，避免悬挂。
- 未完成：调用方大多忽略 `done(ok)`，失败最终仍由 `writeText` 的 fail 决定；完整的“目录失败态”需要页面层错误提示。

### 7. 中：`pagestore.exists` 只检查 `.txt`，不检查 `.idx`（待修）

- 源码：`common/pagestore.js:427`（`exists`）。
- 场景：章正文写完但页表写失败时，`exists` 返回 true，阅读页读页表失败，表现为“章节存在但打不开”。
- 建议：`exists` 依次 `access(txt)` + `access(idx)`；或在 `save` 的 `.idx` 写失败时回滚 `.txt`。后者需要 `delete` 确认成功，代价更高；优先前者。
- 状态：未改，避免额外文件调用影响浏览热路径；列入 v1.1.3。

### 8. 低：`space.clearSaved` 永远报告成功（待修）

- 源码：`common/space.js:54`（`clearSaved`）。
- 场景：`Fs.deleteList` 单步失败仍继续；`clearSaved` 最后无条件 `end(true)`，信息页会显示“已清理”但文件可能残留。
- 建议：`deleteStep` 传递每步 ok，`deleteList` 汇总失败数；页面按失败数提示。当前不影响阅读。

### 9. 低：`route.setCurrent` 长 URL 失败时旧值被清空（已修复）

- 源码：`common/route.js:183`（`setCurrent`）。
- 场景：URL >100 字符走文件通道；旧实现先清 storage 再写文件，文件写失败后返回时没有可恢复 URL。
- 修复：先写 `lwb_cur.txt`，成功后才清 storage；失败重置 `lastCurrent`，下次同 URL 重试。

### 10. 低：`rotationvibrate` 不在 Lite HML 白名单

- 位置：`pages/**/*.hml` 的多个 `<list rotationvibrate="true">`。
- Skill 审计将其标为白名单外属性；DevEco 构建只给 WARN，不阻断。项目历史上真机可用，但不能作为跨型号保证。
- 建议：要么在目标 FIT/GT 上复测并保留，要么删除该属性（列表仍可滚动）。不影响文件 API。

## 三、API 使用表

| API | 本项目用法 | 最低版本 | 权限/syscap | Lite 差异 | 状态 |
|---|---|---:|---|---|---|
| `file.readText` | 分片小文件 4000B；`pagestore` 按字节 position 读页 | 3 | 无特殊权限 | 单读 4KB 上限，302 | 静态通过；真机待验 |
| `file.writeText` | `store` 3.9KB 单文件；`pagestore` 章正文；`saved` 分片 | 3 | 无 | 文件不存在时创建 | 静态通过；真机待验 |
| `file.readArrayBuffer` | `pagestore` 页表/大页回退 | 3 | 无 | 必须给 `length` | 静态通过；真机待验 |
| `file.writeArrayBuffer` | `pagestore` 二进制页表 | 3 | 无 | 设备可能无此方法 | 已做能力检测 |
| `file.access` | 目录/章节存在性 | 3 | 无 | 不存在通常 301 | 已加固 |
| `file.mkdir` | `internal://app/data|saved|ai|read` | 3 | 无 | 递归最多 5 层 | 已加固 |
| `file.delete` | 旧分片/离线分片清理 | 3 | 无 | 只能删文件 | 串行 + 守卫 |
| `file.list` | 空间统计 | 3 | 无 | `fileList` 对象数组 | 静态通过 |
| `storage.get/set` | API Key、启用开关、RSS 源索引、路由短参数 | 3 | 无 | 单值 <128B | 已验证（本地 mock）；真机待验 |

## 四、能否用 `@system.file` 做更强的浏览与缓存

### 已有基础

`common/pagestore.js` 已经是一个正确的“大文本分页存储”样本：

- `internal://app/read/<key>.txt`：`writeText` 写整章；
- `internal://app/read/<key>.idx`：`writeArrayBuffer` 写字节偏移页表（无该能力时退回文本页表）；
- `readText({position, length})` 按页读取，页缓存 LRU 2 页；
- `readArrayBuffer` 只在页 >4096B 或 readText 失败时回退。

这说明 `@system.file` 不仅能存小文件，也能支撑“整章落盘 + 按页懒加载”，是比“把所有正文放 JS 堆”更强的浏览方式。

### 建议的 `docstore`（v1.1.3）

```text
internal://app/doc/<hash>.txt   全文（writeText，仅写一次）
internal://app/doc/<hash>.idx   页起始字节表（writeArrayBuffer 优先，文本回退）
internal://app/doc/<hash>.meta  {url,title,ts,bytes,pages}（writeSmall，≤3900B）
internal://app/doc/list.txt     最近 N 篇索引（LRU，单文件）
```

流程：

1. 抓取/解析成功后写 `.txt`（完整纯文本，不存原始 HTML）；
2. `Paginate` 生成 starts，写 `.idx`；两者都成功后再写 `.meta` 和 `list.txt`；
3. 阅读时只 `readText(position,length)` 当前页，不把全文读进 JS 堆；
4. 列表/清理用 `file.list` + `.meta`，不递归、不 `JSON.stringify(fileList)`；
5. 最多保留 N 篇（按字节/条目双上限），超出按最旧删除；删除前先写 list，再删文件；
6. 所有写入走现有 `Fs.runOp` 串行队列；每步 fail 都上报，不把空串当成功。

### 可落地的增强点

| 能力 | 价值 | 风险/前置 |
|---|---|---|
| 自动文章缓存（最近 10 篇） | 回看免网络、断网可读 | 需要缓存失效/清理策略；只存正文，不存 HTML |
| RSS 源离线缓存 | 5 个源共约 80KB，断网可看标题/摘要 | 源更新频率、过期时间；`file.list` 配额 |
| AI 正文改用 docstore | 16K 字以上不占满 heap | 需要把 `aistore` 分片迁移到 `.txt+.idx`，兼容旧分片 |
| 原子写（`.tmp` + `move`） | 防断电/中断留下半文件 | `move` 覆盖行为必须真机验证；失败要回退 |
| 章节/文章 LRU | 控制磁盘与索引对象数量 | `file.list` 结果仍是对象数组，别一次列太多 |
| 压缩/二进制缓存 | 减少磁盘 | `readArrayBuffer` 会把字节读进 JS heap，不适合大文件；不建议 |

### 不建议做的事

- 不要把 `readArrayBuffer` 当“读大文件”的默认方式：它会把整个 buffer 放进 JS heap，和图片池/正文争内存。
- 不要用 `file.get({recursive:true})` 扫整棵目录；Lite 上对象数组峰值高。
- 不要把原始 HTML 缓存到文件再每次解析；解析峰值远高于纯文本缓存。
- 不要用 `storage` 存正文/JSON 大对象；128B 限制会导致静默失败。

## 五、验证结果

| 层级 | 环境 | 结果 | 未覆盖风险 |
|---|---|---|---|
| 静态审计 | skill `audit_lite_watch_project.ps1`，API 6 / heap 64KB 与 512KB | 完成；无 FAIL；有 `rotationvibrate` 白名单 WARN | 启发式，不替代源码审查 |
| 冒烟 | `node tools/smoke.js` | 146/146 通过 | 文件 mock 不等于真机 |
| DevEco 构建 | hvigor release / API 6.1.1.125 | BUILD SUCCESSFUL | 页面快照部分缺失（index/reader/ai/rss）为体积告警 |
| HAP 检查 | `tools/verify-build.ps1` | 0 PNG；双端 ai/rss 页面齐全；页面 JS <112KB | 应用图标 `.bin` 的启动器兼容性未上表 |
| Lite 模拟器 | 408×480 / pages/index、settings、ai | 手动 Simulator 卡在 `current state(2) invalid`，黑屏 | 模拟器不能证明 file API/rawfile/图片释放 |
| 真机 | FIT 5 Pro / GT | 未执行 | **发布阻塞项**：文件 API、rawfile、迁移、AI/RSS |

## 六、结论

- `@system.file` 在 Lite 上**可以**做比“读一个小文件”更强的浏览缓存：`pagestore` 的 `.txt + .idx + 按页 readText` 是可行骨架；建议 v1.1.3 抽成通用 `docstore`。
- 本版已修复 5 个高/中风险文件行为（UTF-8 分片、读失败空串、迁移删除顺序、离线清单覆盖、AI 删除洪峰），并加固目录错误处理与长 URL 恢复。
- 仍需真机验证：`readText` 的字节/字符语义、`writeText` 大文件、`writeArrayBuffer` 能力、`mkdir/access` 错误码、应用图标 `.bin`。
- 在真机验证前，不应把“模拟器能启动”当成 `@system.file` 通过。

## 七、Skill 安装位置

```text
<DSH_HOME>\.dsh\skills\huawei-lite-watch-development
```

已在当前会话加载；DSH 用户级 skill 根目录会自动发现，新会话无需重新安装。
