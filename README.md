# 轻鸿浏览器（LiteHarmonyBrowser）

> 运行在华为 Lite Wearable 手表上的纯 JS 文本浏览器 / 小说阅读器。
> 当前版本：**1.1.1（versionCode 1101）** ｜ 包名：`com.example.litewearbrowser`
> 目标设备：HUAWEI WATCH FIT 5 Pro（408×480 方屏）+ GT 系列（466×466 圆屏）

## 一、这是什么

- 输入网址或关键词抓取网页正文，按手表屏幕自动分页阅读。
- 支持书签、历史、离线网页、字号/行距、屏幕常亮。
- 支持小说搜索：输入书名 → 必应 RSS → 自动打开第一条结果。
- 无 WebView，全部由 `@system.fetch` + 自研 HTML 解析 + 分页渲染实现。

## 二、目录

```text
AppScope/                 应用级配置（版本号、图标）
entry/src/main/           页面与公共模块（核心源码）
docs/                     HANDOVER 开发史、设计、设备实测、安装说明
spec/                     需求/设计/任务文档
tools/                    构建、打包、冒烟测试、Git 保存脚本
dist/                     历史构建产物（HAP/APP）
```

## 三、构建

```powershell
cd <repo>
pwsh -File tools\build.ps1
```

流程：冒烟测试（133 条）→ hvigor release 构建 → `pack-app.ps1` 打包到 `dist/unsigned/`。

## 四、Git 使用（非开发人员版）

本仓库已初始化为本地 Git 仓库，默认分支 `main`，并已打 `v1.1.1` 标签。

### 查看当前状态

```powershell
git status
```

### 保存一次版本（最常用）

```powershell
git add -A
git commit -m "说明这次改了什么"
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

> 日常只需要记住：**改完代码 → `git add -A` → `git commit -m "说明"`**。
> DevEco Studio 自带 Git 面板，也可以在左下角「Git」里点“提交”。

### 注意

- `build-profile.json5` 含本机签名证书配置，**已设置为不进入 Git**；当前文件仍在工程根目录，构建不受影响。
- 换电脑重建仓库时，可复制 `build-profile.example.json5` 为 `build-profile.json5`，再在 DevEco 里配置签名。
- 构建产物 `dist/` 会进入 Git（体积约 10 MB），方便找回历史版本；`entry/build/`、`.hvigor/` 不进入 Git。

## 五、发布新版本时

版本号三处必须同步：

1. `AppScope/app.json5` → `versionCode` / `versionName`
2. `entry/src/main/config.json` → `app.version.code/name`
3. `entry/src/main/js/MainAbility/pages/index/index.js` → `APP_VERSION`

`tools/smoke.js` 的 `[version consistency]` 用例会自动校验三处一致。

## 六、更多文档

- `docs/HANDOVER.md`：完整开发史与关键坑
- `docs/design-v2.md`：视觉/动效设计
- `docs/device-fit5pro.md`：FIT5 Pro 实测性能
- 工作区恢复档案：`内部恢复档案（不随仓库发布）`
