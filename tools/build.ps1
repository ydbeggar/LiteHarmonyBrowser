<#
.SYNOPSIS
  一条命令跑完「冒烟测试 → 构建 hap → 打补丁包 + 组装 .app」。

.DESCRIPTION
  固定使用 DevEco Studio 自带的 node / jbr / hvigor，避免本机全局 Node 版本干扰。
  产物落在 dist/unsigned/，签名的下一步见 docs/install.md 第 5 节。

.EXAMPLE
  pwsh -File tools/build.ps1
  pwsh -File tools/build.ps1 -SkipSmoke
#>
[CmdletBinding()]
param(
  [switch]$SkipSmoke,
  [switch]$SkipPack
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$devEco = "C:\Program Files\Huawei\DevEco Studio"
$nodeHome = Join-Path $devEco "tools\node"
$hvigor = Join-Path $devEco "tools\hvigor\bin\hvigorw.bat"
$env:NODE_HOME = $nodeHome
$env:DEVECO_SDK_HOME = Join-Path $devEco "sdk"
$env:PATH = (Join-Path $devEco "jbr\bin") + ";" + $nodeHome + ";" + $env:PATH

if (-not $SkipSmoke) {
  Write-Host "==> node tools/smoke.js" -ForegroundColor Cyan
  & node (Join-Path $root "tools\smoke.js")
  if ($LASTEXITCODE -ne 0) { throw "冒烟测试未通过，构建中止" }
}

Write-Host "==> hvigor assembleHap (release)" -ForegroundColor Cyan
& $hvigor --mode module -p product=default -p buildMode=release assembleHap --no-daemon
if ($LASTEXITCODE -ne 0) { throw "hvigor 构建失败（退出码 $LASTEXITCODE）" }

if (-not $SkipPack) {
  Write-Host "==> tools/pack-app.ps1" -ForegroundColor Cyan
  & pwsh -NoProfile -File (Join-Path $root "tools\pack-app.ps1")
  if ($LASTEXITCODE -ne 0) { throw "打包失败（退出码 $LASTEXITCODE）" }

  Write-Host "==> tools/verify-build.ps1" -ForegroundColor Cyan
  & pwsh -NoProfile -File (Join-Path $root "tools\verify-build.ps1")
  if ($LASTEXITCODE -ne 0) { throw "构建检查失败（退出码 $LASTEXITCODE）" }
}

Write-Host ""
Write-Host "完成。未签名产物见 dist/unsigned/，签名命令见 docs/install.md 第 5 节。" -ForegroundColor Green
