# 轻鸿浏览器（LiteHarmonyBrowser）

> 运行在华为 Lite Wearable 手表上的纯 JS 文本浏览器 / 小说阅读器。
> 当前版本：**1.1.2（versionCode 1102）** ｜ 包名：`com.example.litewearbrowser`
> 目标设备：HUAWEI WATCH FIT 5 Pro（408×480 方屏）+ GT 系列（466×466 圆屏）

## 一、这是什么

- 输入网址或关键词抓取网页正文，按手表屏幕自动分页阅读。
- 支持书签、历史、离线网页、字号/行距、屏幕常亮。
- 支持小说搜索：输入书名 → 必应 RSS → 自动打开第一条结果。
- **v1.1.2 新增增强搜索**：手动保存 DeepSeek API Key（本地持久化）→ Search 找网页 → Fetch 抓取全文 → 纯文本阅读；Key 不写死、不进日志、不进 Git。
- **v1.1.2 新增 RSS 新闻**：5 个公共 RSS 源，列表/频道/详情三视图，支持阅读原文。
- 无 WebView，全部由 `@system.fetch` + 自研 HTML/RSS 解析 + 分页渲染实现。
- 最终 HAP 为 **BIN-only**：页面图片和应用图标均为 `.bin`，安装包内 0 个 PNG（源文件开发阶段仍保留 PNG）。

## 二、下载

每个版本的**未签名 `.app`** 可在仓库的 [Releases](https://github.com/ydbeggar/LiteHarmonyBrowser/releases) 页面下载，文件名形如 `LiteHarmonyBrowser-v1.1.2-unsigned-final.app`。

未签名包需使用 DevEco Studio 配置本机签名后再安装或上架；仓库内 `dist/unsigned/` 同时保留了历史未签名 `.hap` / `.app`。

## 三、目录

```text
AppScope/                 应用级配置（版本号、图标）
entry/src/main/           页面与公共模块（核心源码）
docs/                     HANDOVER 开发史、设计、设备实测、安装说明
spec/                     需求/设计/任务文档
tools/                    构建、打包、冒烟测试、Git 保存脚本
dist/                     历史构建产物（HAP/APP）
```

## 四、构建

在工程根目录执行：

```powershell
pwsh -File tools\build.ps1
```

流程：冒烟测试（146 条）→ hvigor release 构建 → `pack-app.ps1` 打包到 `dist/unsigned/` → `verify-build.ps1` 检查 0 PNG、双端页面齐全、页面 JS <112KB。

## 五、Git 使用

默认分支 `main`，已有标签 `v1.1.1`、`v1.1.2`，当前开发分支 `feat/v1.1.2`。

```powershell
git clone https://github.com/ydbeggar/LiteHarmonyBrowser.git
cd LiteHarmonyBrowser
```

### 保存一次版本（最常用）

```powershell
git add -A
git commit -m "说明这次改了什么"
git push
```

或者用封装脚本：

```powershell
pwsh -File tools\git-save.ps1 -Message "说明这次改了什么"
```

### 查看历史

```powershell
git log --oneline --graph --decorate -20
```

### 回到某个历史版本（谨慎）

```powershell
git tag                 # 看有哪些版本标签
git checkout v1.1.1     # 查看 v1.1.1 的代码（只读状态）
git checkout main       # 回到最新主线
```

> 日常只需要记住：**改完代码 → `git add -A` → `git commit -m "说明"` → `git push`**。
> DevEco Studio 自带 Git 面板，也可以在左下角「Git」里点“提交”。

### 注意

- `build-profile.json5` 含本机签名证书配置，**不进入 Git**；首次克隆后可复制 `build-profile.example.json5` 为 `build-profile.json5`，再在 DevEco 里配置签名。
- 构建产物 `dist/` 会进入 Git（体积约 10 MB），方便找回历史版本；`entry/build/`、`.hvigor/` 不进入 Git。
- 仓库不包含签名证书、密钥或 API Key。

## 六、发布新版本时

版本号三处必须同步：

1. `AppScope/app.json5` → `versionCode` / `versionName`
2. `entry/src/main/config.json` → `app.version.code/name`
3. `entry/src/main/js/MainAbility/pages/index/index.js` → `APP_VERSION`

`tools/smoke.js` 的 `[version consistency]` 用例会自动校验三处一致。

## 七、更多文档

- `docs/HANDOVER.md`：完整开发史与关键坑
- `docs/design-v2.md`：视觉/动效设计
- `docs/device-fit5pro.md`：FIT5 Pro 实测性能
- `docs/install.md`：安装、签名与排错
