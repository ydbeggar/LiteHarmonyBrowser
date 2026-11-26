# 轻鸿浏览器 · 安装与构建说明

> **版本提示（2026-11-26 更新）**：本文前半部分是 1.0.1 时期排查「解压 hap 失败 / error 40」的历史记录，
> 结论仍然有效，但**产物名、版本号与补丁流程已过时**。当前版本为 **1.1.2(1102)**，
> 补丁与打包已由 `tools/pack-app.ps1` 自动完成，一条命令：`pwsh -File tools/build.ps1`。
> 最新状态、产物 SHA256 与待办请看 `docs/HANDOVER.md` 的「五之四十一」。

## 1. 产物

| 项 | 值 |
|----|----|
| 包名（bundleName） | `com.example.litewearbrowser` |
| 应用名 | 轻鸿浏览器 |
| 设备类型 | `liteWearable`（WATCH FIT 5 Pro 真机：408×480 / 195 dpi / rect / JS heap 715000 B ≈ 698 KB / fetch 45.5 KB/s，详见 `docs/device-fit5pro.md`） |
| 签名产物 | `dist/LiteHarmonyBrowser-v1.0.1-final.hap`（推荐安装） |
| 构建产物 | `entry/build/default/outputs/default/entry-default-signed.hap`（**不含字段补丁**） |
| 未签名产物 | `entry/build/default/outputs/default/entry-default-unsigned.hap` |
| 版本 | versionCode `1000001` / versionName `1.0.1` |
| API 声明 | compile `26.0.0`、compatible `5.0.0(12)`、target `5.0.0(12)` |

### 最终产物（已用修复后的签名配置重建 + 补齐模范工程字段）

| 文件 | 大小 | SHA256 |
|---|---|---|
| **`dist/LiteHarmonyBrowser-v1.0.1-final.hap`** | 285,045 B | `22371898CFC3AE8A24F2B552914CE2AC3A826B63AD06D7492045E904826D6C47` |
| `dist/LiteHarmonyBrowser-v1.0.1-final-signcode1.hap` | 289,404 B | `34078D630AE6F24EDB4A09EE34A23CD0CA008F359E6772D85B7AC4D9FBD6FC72` |

- 签名材料：`<用户目录>\fit5pro.p12`（alias `fit5pro`）、`<下载目录>\com.example.litewearbrowser.cer`、`<下载目录>\轻鸿浏览器Debug.p7b`
- Profile 绑定 UDID：`<设备UDID>`（1 个）
- `config.json` 已补回 `module.mainAbility` / `module.package` / `apiVersion.compileSdkType` / `apiVersion.compileSdkVersion` / `app.appEnvironments`，`deviceConfig` 改为 `{}`，`pack.info` 与 `AiChatPro` 同构
- 两个包 `hap-sign-tool verify-app` 均通过

> 注意：`devecocli build` 的原始输出（`entry/build/.../entry-default-signed.hap`）**不包含这组字段补丁**——hvigor 每次构建都会重新剥离。`dist/*final*` 是补丁后重新签名的成品；如需每次构建自动产出，需要在构建后追加补丁脚本。

> **构建时请关闭 DevEco Studio 的自动构建**：IDE 打开工程后会改写 `build-profile.json5`（例如把 `compatibleSdkVersion` 改成与 target 相同的值），并在后台以 debug 方式重打包，覆盖 `entry/build/.../entry-default-signed.hap`。取包只从 `dist/` 取。

> **关于 target 版本**：本机只有 OpenHarmony SDK `26.0.0`，`"7.0.0(26)"` 会被 hvigor 以 `00303082` 拒绝；写 `"26.0.0"` 会编码成 `260000026`（版本 26.0.0），高于设备的 7.0.0 会被拒装。当前与模范工程保持一致，使用 `compatible = target = 5.0.0(12)`（编码 `50000012`），既是最保守的 Lite 基线，也不损失任何功能（项目使用的 `@system.*` 能力均 ≤ API 9）。

构建命令（工程根目录执行）：

```bash
# 调试包（未压缩 JS，便于排查）
devecocli build --modules entry

# 发布包（压缩 JS + JerryScript 快照，体积与启动性能最优）
devecocli build --modules entry --build-mode release
```

首次构建前如签名材料缺失，执行：

```bash
devecocli signature generate --type debug
```

该命令会把证书、profile、`storePassword` / `keyPassword` 自动写入根目录 `build-profile.json5` 的 `app.signingConfigs`。

## 2. 真机安装（WATCH FIT 5 系列）

Lite Wearable 不支持 hdc 无线调试，安装需要借助 HarmonyOS NEXT 之前的华为手机：

1. 在电脑上完成构建，确认 `entry/build/default/outputs/default/entry-default-signed.hap` 存在且为最新。
2. 把 `entry-default-signed.hap` 拷贝到手机（数据线、蓝牙文件传输或手机侧文件管理均可）。
3. 在手机上打开「运动健康」，完成与手表的蓝牙配对，确认设备已连接。
4. 在手机上打开「应用调测助手」（华为提供的穿戴应用调试工具），选择已配对的手表。
5. 在应用调测助手中选择本地 HAP 文件，安装第 2 步拷贝的 `entry-default-signed.hap`。
6. 安装完成后，在手表应用列表中找到「轻鸿浏览器」并打开。

> 若手表上已存在同包名的旧版本，请先在应用调测助手中卸载旧包，再安装新包。

### ⚠️ 安装前必看：两种“hap”完全不是一回事

Lite Wearable 在 **debug 构建**下会把产物打成「一个 `.bin` 包在 `.hap` 壳里」的调试包，文件名同样是 `entry-default-signed.hap`，**但不能安装到手表**，应用调测助手会直接报 **「解压hap失败」**。

| 判据 | 可安装的 release HAP | 不可安装的 debug 包装 |
|---|---|---|
| 文件大小 | ≈ **289 KB** | ≈ **480 KB** |
| 压缩包条目数 | **19** 个 | **1** 个（只有一个 `entry-default-signed.bin`） |
| 是否含 `config.json` | 有 | 无 |
| 构建命令 | `devecocli build --modules entry --build-mode release` | `devecocli build --modules entry` 或 IDE 直接 Run |

**因此请只安装 `dist/LiteHarmonyBrowser-v1.0.1-release.hap`**。若在 DevEco Studio 里点过 Run/Debug，IDE 会用 debug 产物覆盖 `entry/build/...`，所以不要从 `entry/build` 取包，直接从 `dist/` 取。

校验命令（在电脑上执行）：

```powershell
$hap = "<repo>\dist\LiteHarmonyBrowser-v1.0.1-release.hap"
(Get-Item $hap).Length                      # 应为 289420
(Get-FileHash $hap -Algorithm SHA256).Hash   # 应为 53678C4C2D260B592266C859191B2223C6E0E295A7667CB6DCA36BB6625D5978
Add-Type -AssemblyName System.IO.Compression.FileSystem
([System.IO.Compression.ZipFile]::OpenRead($hap)).Entries.Count   # 应为 19
```

### 签名与包名一致性（已核验）

| 检查项 | 实际值 |
|---|---|
| HAP `config.json` 的 bundleName | `com.example.litewearbrowser` |
| Profile 的 `bundle-name` | `com.example.litewearbrowser` |
| Profile 的 `type` / `apl` / `app-feature` | `debug` / `normal` / `hos_normal_app` |
| Profile 的 `device-ids` | 与旧工程 Profile 完全相同（2 个 UDID） |
| 签名证书链叶子 | SHA256 `97:D5:1E:...:2D:A8:41` |
| Profile 内 `development-certificate` | 同一张叶子证书（指纹一致） |
| `hap-sign-tool verify-app` | `verify-app success` |

> 结论：签名文件与包名**是匹配的**。而且“解压 hap 失败”发生在签名校验之前，即便签名不匹配也只会报签名/证书类错误，不会报解压失败。

### 与可运行模范工程的差异（根因）

对照 `AiChatPro` 与 `PymChat_api24`（两者同样是 `faMode` + `liteWearable`）后发现：**API 26 的 hvigor 会在 Lite 合并阶段删掉一组字段**，而这两个模范工程的 HAP 里这些字段是存在的。

| `config.json` 字段 | 模范工程（可安装） | 我们的默认构建 | 处理 |
|---|---|---|---|
| `module.mainAbility` | `".MainAbility"` | **被删除** | 补回 |
| `module.package` | `"com.example.myapplication"` | **被删除** | 补回 |
| `app.apiVersion.compileSdkType` | `"HarmonyOS"` | **被删除** | 补回 |
| `app.apiVersion.compileSdkVersion` | `"6.1.1.125"` | **被删除** | 补回 |
| `app.appEnvironments` | `[]` | **被删除** | 补回 |
| `deviceConfig` | `{}` | `{"default":{}}` | 改为 `{}` |
| `abilities[].skills` / `visible` | 无 | 有 | 去掉 |
| `pack.info` 的 `modules[].apiVersion` | 无 | 有 | 去掉 |

> 旧版「应用调测助手」（1.2.1.600）在解析 HAP 时依赖 `module.package` / `module.mainAbility`，缺失即报 **「解压hap失败」**——这也解释了为什么华为自己的 `app_packing_tool --mode app` 会报 `config.json file does not contain 'package'`。

修复后的产物（已与模范工程的 `config.json`、`pack.info` 键结构逐项对齐）：

| 文件 | 大小 | SHA256 |
|---|---|---|
| `dist/LiteHarmonyBrowser-v1.0.1-fixed-signcode0.hap` | 285,064 B | `F1231603BCB3160236EB118628D8745BCAF2DE97A340D76E1687BE73780A4326` |
| `dist/LiteHarmonyBrowser-v1.0.1-fixed-signcode1.hap` | 289,420 B | `AAC0904B37FB2F1A82FC63C292246A74F43D31CB7615AC210559358CB9DE2D15` |

### 安装失败排查

| 现象 | 优先排查 |
|------|----------|
| **解压hap失败** | **最常见原因：装了 debug 产物**（≈480KB、压缩包内只有 1 个 `.bin`）。请改用 `dist/LiteHarmonyBrowser-v1.0.1-release.hap`（≈289KB、19 个条目、含 `config.json`）。其次：① 确认拷到手机的是签名包；② 用 USB「传输文件」方式拷贝，避免微信/QQ 二次压缩；③ 先卸载手表上的同包名旧应用 |
| **40.配置文件格式错误** | `compatibleSdkVersion` 必须是 `5.0.0(12)` 这种字符串格式 |
| **签名校验失败 / error 10** | Profile 未包含该手表 UDID，或误用 release 证书；调试包必须用 debug 证书 + debug Profile |
| **装上了但打不开 / 白屏** | 必须使用 `--build-mode release` 产物；debug 产物的 `reader` 页约 72KB，超过 Lite 单页 48KB 上限 |

## 3. 首次使用路径

- **有网**：首页地址栏输入网址 → 点击「打开」→ 阅读页展示标题与正文第 1 页 → 点击屏幕左右两侧或上下滑动翻页。
- **无网/演示**：首页点击「离线示例」，直接阅读内置长文，全程不发起网络请求。
- **收藏与历史**：阅读页页脚「收藏」；首页「我的书签」「浏览历史」进入列表，支持单条删除与清空历史。
- **阅读设置**：阅读页页脚「设置」，调整字号/行距/深色主题，返回后自动重新分页并保持阅读位置。

## 4. 已知限制（需真机确认）

| 项 | 说明 |
|----|------|
| 系统输入法 | 地址输入使用 `input type="text"` 唤起系统输入法；模拟器不提供输入法，属于平台限制。真机需确认输入法弹窗与 `change` 回调正常。 |
| `@system.fetch` | 代码已用 `canIUse('SystemCapability.Communication.NetStack')` 与 `@system.network.getType` 做能力预判；该接口在 liteWearable 上是否放行必须以真机为准。若被系统拦截，应用会进入「暂不支持该类型内容」失败态并保留离线示例入口。 |
| 明文 HTTP | FA 模型的 `config.json` 校验不接受 `deviceConfig.network.cleartextTraffic`，因此应用默认只保证 HTTPS 可访问；HTTP 站点失败时归入「目标不可达」。 |
| 非 UTF-8 页面 | 不做 GBK 转码，按平台返回内容展示；乱码时仍可读但可能影响理解。 |
| 圆角裁切 | 所有可点区域距屏幕边缘至少 12px，顶部另有安全间距；页码位于页脚中部，不贴边。 |

## 5. 未签名产物（用于二次签名 / 换设备验证）

| 文件 | 大小 | 说明 |
|---|---|---|
| **`dist/unsigned/LiteHarmonyBrowser-v1.0.1-unsigned-final.hap`** | 263,196 B | 推荐：与 `AiChatPro` 的 `config.json` / `manifest.json` 键集合与取值逐项一致 |
| **`dist/unsigned/LiteHarmonyBrowser-v1.0.1-unsigned-final.app`** | 88,404 B | 同上 HAP 打成的未签名 App Pack |
| `dist/unsigned/LiteHarmonyBrowser-v1.0.1-unsigned-fixed.hap` | 263,228 B | 上一轮（缺 manifest 修复） |
| `dist/unsigned/LiteHarmonyBrowser-v1.0.1-unsigned-fixed.app` | 88,568 B | 同上 |
| `dist/unsigned/LiteProbe-unsigned.hap` | 73,644 B | 单页探针的未签名 HAP |

SHA256：

- `...unsigned-final.hap` = `57394A89CC31E7FFA9766F98B35705DDEE430901A34DA69E196D9C6396662CA3`
- `...unsigned-final.app` = `BE236AC171583822F747AD5CC94F3AF2CFE7BDE84AC0B6ABEC353DF6FD8A088A`

### 本轮修复（error 40 的真正来源）

| 项 | 模范工程 `AiChatPro` | 修复前 | 修复后 |
|---|---|---|---|
| `assets/js/MainAbility/manifest.json` 的 `compatibleSdkVersionStage` | **不存在** | `"beta1"`（compatible=12 时 hvigor 自动写入） | **已删除** |
| `manifest.json` 的 `appName` | `$string:app_name` | `.MainAbility`（ability 带 `skills` 时取 ability 名） | `$string:app_name`（已移除 `skills`） |
| `manifest.json` 的 `minPlatformVersion` | `10` | `12` | `10`（`compatibleSdkVersion` 改 `4.0.0(10)`） |
| `config.json` 的 `apiVersion` | `compileSdkType/compileSdkVersion/compatible/target` 四项 | 缺 `compileSdkType`/`compileSdkVersion` | 与模范工程完全一致 |
| `config.json` 的 `abilities[0]` | 无 `skills`/`visible` | 有 | 已移除 |

签名命令（在工程根目录执行，密码与别名按本地签名材料填写）：

```powershell
$java = "C:\Program Files\Huawei\DevEco Studio\jbr\bin\java.exe"
$jar  = "C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\lib\hap-sign-tool.jar"
& $java -jar $jar sign-app -mode localSign -keyAlias debugKey `
  -keyPwd <keyPassword> -keystoreFile "<...>.p12" -keystorePwd <storePassword> `
  -appCertFile "<...>.cer" -profileFile "<...>.p7b" `
  -inFile "dist\unsigned\LiteHarmonyBrowser-v1.0.1-unsigned.hap" `
  -outFile "dist\LiteHarmonyBrowser-signed.hap" `
  -signAlg SHA256withECDSA -compatibleVersion 12 -signCode 0
```

> ⚠️ 换设备前必须注意：调试 Profile 绑定了 `device-ids`（当前为 2 个 UDID）。**新设备不在该列表中时，即使签名正确也无法安装**，需要在 AGC 的调试 Profile 中登记新设备的 UDID 并重新生成 `.p7b`。

## 6. 体积基线

以 `--build-mode release` 产物为准（debug 产物不压缩，仅供调试）：

| 页面 | release JS |
|------|-----------|
| pages/index/index | 16,785 B |
| pages/reader/reader | 42,931 B |
| pages/links/links | 11,953 B |
| pages/shelf/shelf | 18,030 B |
| pages/settings/settings | 15,379 B |

约束：单页 JS ≤ 48KB。reader 页因包含 HTML 解析、分页、网络、会话与离线示例，是体积最大的页面；已通过精简实体表、共用字符串、缩短示例文本等方式压到 48KB 以内（42.9KB）。

> 说明：DevEco 的 Lite 工具链只在非 debug 构建（`hapMode=true`）时启用 Terser 压缩并生成 `.bc` 快照，debug 产物保留未压缩代码（reader 约 72KB），仅用于调试。验收体积以 `--build-mode release` 的打包产物为准。
