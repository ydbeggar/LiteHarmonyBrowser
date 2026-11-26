<#
.SYNOPSIS
  把 hvigor 产出的 entry-default-unsigned.hap 打成可交给签名工具 / 应用调测助手使用的成品包。

.DESCRIPTION
  hvigor（API 26）在 Lite 合并阶段会主动删掉一组「旧版调测助手」依赖的字段，
  直接拿 entry-default-unsigned.hap 去签名会在安装时提示「解压hap失败」。
  本脚本按 docs/install.md 记录的补丁表逐项补回，并组装 .app 包：

    config.json  : app.apiVersion.compileSdkType / compileSdkVersion、
                   app.appEnvironments、module.mainAbility、module.package，
                   deviceConfig 置 {}，abilities[] 去掉 skills / visible
    manifest.json: 删除 compatibleSdkVersionStage
    pack.info    : 删除 modules[].apiVersion
    .app         : entry-default.hap + pack.info + pac.json

.EXAMPLE
  pwsh -File tools/pack-app.ps1
  pwsh -File tools/pack-app.ps1 -CompileSdkVersion "6.1.1.125"
#>
[CmdletBinding()]
param(
  [string]$Hap = "entry\build\default\outputs\default\entry-default-unsigned.hap",
  [string]$OutDir = "dist\unsigned",
  [string]$CompileSdkType = "HarmonyOS",
  [string]$CompileSdkVersion = "6.1.1.125",
  [string]$MainAbility = ".MainAbility",
  # 固定条目时间戳，让同样的输入产出同样的字节（便于记录 SHA256 做回归比对）
  [string]$Timestamp = "2026-01-01T00:00:00+08:00",
  # v1.1.2：默认移除页面 PNG，只保留 DevEco 生成的 .png.bin（BIN-only 产物）
  [switch]$KeepAppIcon
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$fixedTime = [DateTimeOffset]::Parse($Timestamp)

$root = Split-Path -Parent $PSScriptRoot
$hapPath = if ([System.IO.Path]::IsPathRooted($Hap)) { $Hap } else { Join-Path $root $Hap }
if (-not (Test-Path $hapPath)) {
  throw "找不到 hap：$hapPath（先执行 hvigor assembleHap）"
}
$outPath = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir }
New-Item -ItemType Directory -Force -Path $outPath | Out-Null

function Read-ZipText {
  param($Entry)
  $reader = New-Object System.IO.StreamReader($Entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Get-Utf8Bytes {
  param([string]$Text)
  $enc = New-Object System.Text.UTF8Encoding($false)
  return $enc.GetBytes($Text)
}

# ---------------------------------------------------------------- 读取并补丁
$zip = [System.IO.Compression.ZipFile]::OpenRead($hapPath)
try {
  $entries = @{}
  $order = New-Object System.Collections.Generic.List[string]
  foreach ($e in $zip.Entries) {
    if ($e.FullName.EndsWith("/")) { continue }
    $ms = New-Object System.IO.MemoryStream
    $s = $e.Open()
    try { $s.CopyTo($ms) } finally { $s.Dispose() }
    $entries[$e.FullName] = $ms.ToArray()
    $order.Add($e.FullName)
  }
} finally {
  $zip.Dispose()
}

foreach ($required in @("config.json", "pack.info", "assets/js/MainAbility/manifest.json")) {
  if (-not $entries.ContainsKey($required)) { throw "hap 内缺少必需条目：$required" }
}

# --- config.json
$configText = [System.Text.Encoding]::UTF8.GetString($entries["config.json"])
$config = $configText | ConvertFrom-Json

$apiVersion = $config.app.apiVersion
$apiVersion | Add-Member -NotePropertyName compileSdkType -NotePropertyValue $CompileSdkType -Force
$apiVersion | Add-Member -NotePropertyName compileSdkVersion -NotePropertyValue $CompileSdkVersion -Force
$config.app | Add-Member -NotePropertyName appEnvironments -NotePropertyValue @() -Force
$config.module | Add-Member -NotePropertyName mainAbility -NotePropertyValue $MainAbility -Force
$config.module | Add-Member -NotePropertyName package -NotePropertyValue $config.app.bundleName -Force
$config.deviceConfig = [pscustomobject]@{}

$abilityCount = 0
foreach ($ability in @($config.module.abilities)) {
  if ($null -eq $ability) { continue }
  foreach ($drop in @("skills", "visible")) {
    $prop = $ability.PSObject.Properties[$drop]
    if ($null -ne $prop) { $ability.PSObject.Properties.Remove($drop) }
  }
  $abilityCount += 1
}

$configJson = $config | ConvertTo-Json -Depth 30 -Compress
$entries["config.json"] = Get-Utf8Bytes $configJson

# --- manifest.json
$manifestText = [System.Text.Encoding]::UTF8.GetString($entries["assets/js/MainAbility/manifest.json"])
$manifest = $manifestText | ConvertFrom-Json
$stage = $manifest.PSObject.Properties["compatibleSdkVersionStage"]
if ($null -ne $stage) { $manifest.PSObject.Properties.Remove("compatibleSdkVersionStage") }
$entries["assets/js/MainAbility/manifest.json"] = Get-Utf8Bytes ($manifest | ConvertTo-Json -Depth 30 -Compress)

# --- pack.info（hap 内与 .app 根目录共用同一份）
$packText = [System.Text.Encoding]::UTF8.GetString($entries["pack.info"])
$packInfo = $packText | ConvertFrom-Json
$apiDrop = 0
foreach ($module in @($packInfo.summary.modules)) {
  if ($null -eq $module) { continue }
  if ($null -ne $module.PSObject.Properties["apiVersion"]) {
    $module.PSObject.Properties.Remove("apiVersion")
    $apiDrop += 1
  }
}
$packJson = $packInfo | ConvertTo-Json -Depth 30 -Compress
$entries["pack.info"] = Get-Utf8Bytes $packJson

# v1.1.2 BIN-only：应用图标也改为 .bin。
# resources.index 里的路径必须从 icon.png 改为 icon.bin（等长替换，不破坏二进制结构），
# 同时把 icon.png.bin 复制成 icon.bin 供资源索引查找。
function Replace-AsciiEqualLength {
  param([byte[]]$Data, [string]$From, [string]$To)
  $fromBytes = [System.Text.Encoding]::ASCII.GetBytes($From)
  $toBytes = [System.Text.Encoding]::ASCII.GetBytes($To)
  if ($fromBytes.Length -ne $toBytes.Length) { throw "索引路径替换长度不一致：$From -> $To" }
  for ($i = 0; $i -le $Data.Length - $fromBytes.Length; $i++) {
    $match = $true
    for ($j = 0; $j -lt $fromBytes.Length; $j++) {
      if ($Data[$i + $j] -ne $fromBytes[$j]) { $match = $false; break }
    }
    if ($match) {
      for ($j = 0; $j -lt $toBytes.Length; $j++) { $Data[$i + $j] = $toBytes[$j] }
      $i += $fromBytes.Length - 1
    }
  }
  return $Data
}

$iconPairs = @(
  @{ Png = 'assets/entry/resources/base/media/icon.png'; Bin = 'assets/entry/resources/base/media/icon.bin'; Old = 'entry/resources/base/media/icon.png'; New = 'entry/resources/base/media/icon.bin' },
  @{ Png = 'assets/entry/resources/base/media/icon_small.png'; Bin = 'assets/entry/resources/base/media/icon_small.bin'; Old = 'entry/resources/base/media/icon_small.png'; New = 'entry/resources/base/media/icon_small.bin' }
)
$patchedIcons = 0
$indexBytes = $entries['assets/entry/resources.index']
if ($null -ne $indexBytes) {
  foreach ($pair in $iconPairs) {
    if ($entries.ContainsKey($pair.Png) -and $entries.ContainsKey($pair.Png + '.bin')) {
      $entries[$pair.Bin] = $entries[$pair.Png + '.bin']
      if (-not $order.Contains($pair.Bin)) { $order.Add($pair.Bin) }
      $indexBytes = Replace-AsciiEqualLength -Data $indexBytes -From $pair.Old -To $pair.New
      $patchedIcons += 1
    }
  }
  $entries['assets/entry/resources.index'] = $indexBytes
}

$versionName = $config.app.version.name
$versionCode = $config.app.version.code
$baseName = "LiteHarmonyBrowser-v$versionName-unsigned-final"

# ------------------------------------------------------------- 写补丁后的 hap
$hapOut = Join-Path $outPath "$baseName.hap"
if (Test-Path $hapOut) { Remove-Item $hapOut -Force }
$outZip = [System.IO.Compression.ZipFile]::Open($hapOut, [System.IO.Compression.ZipArchiveMode]::Create)
$written = 0
$droppedPng = 0
try {
  foreach ($name in $order) {
    $isImage = $name -match '\.(png|jpg|jpeg|bmp)$'
    $isAppIcon = $name -match '^assets/entry/resources/base/media/icon'
    if ($isImage -and -not ($KeepAppIcon -and $isAppIcon)) {
      $binName = $name + '.bin'
      if (-not $entries.ContainsKey($binName)) {
        throw "BIN-only 打包失败：$name 没有对应的 $binName"
      }
      $droppedPng += 1
      continue
    }
    $entry = $outZip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $fixedTime
    $stream = $entry.Open()
    try { $stream.Write($entries[$name], 0, $entries[$name].Length) } finally { $stream.Dispose() }
    $written += 1
  }
} finally {
  $outZip.Dispose()
}

# ----------------------------------------------------------------- 组装 .app
$appOut = Join-Path $outPath "$baseName.app"
if (Test-Path $appOut) { Remove-Item $appOut -Force }
$hapBytes = [System.IO.File]::ReadAllBytes($hapOut)
$pacJson = '{"dataProcess":[],"specialAPIs":[]}'

$appZip = [System.IO.Compression.ZipFile]::Open($appOut, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in @(
      @{ Name = "entry-default.hap"; Bytes = $hapBytes },
      @{ Name = "pack.info"; Bytes = $entries["pack.info"] },
      @{ Name = "pac.json"; Bytes = (Get-Utf8Bytes $pacJson) }
    )) {
    $entry = $appZip.CreateEntry($item.Name, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $fixedTime
    $stream = $entry.Open()
    try { $stream.Write($item.Bytes, 0, $item.Bytes.Length) } finally { $stream.Dispose() }
  }
} finally {
  $appZip.Dispose()
}

# --------------------------------------------------------------------- 报告
$hapInfo = Get-Item $hapOut
$appInfo = Get-Item $appOut
$hapHash = (Get-FileHash $hapOut -Algorithm SHA256).Hash
$appHash = (Get-FileHash $appOut -Algorithm SHA256).Hash

Write-Host ""
Write-Host "版本        : $versionName ($versionCode)"
Write-Host "config.json : compileSdkType=$CompileSdkType compileSdkVersion=$CompileSdkVersion mainAbility=$MainAbility package=$($config.app.bundleName) abilities=$abilityCount"
Write-Host "pack.info   : 移除 modules[].apiVersion 共 $apiDrop 处"
Write-Host "BIN-only    : 移除页面 PNG $droppedPng 个（保留 .png.bin）"
Write-Host "hap 条目数  : $written"
Write-Host ""
Write-Host ("hap : {0}  ({1:N0} B)" -f $hapOut, $hapInfo.Length)
Write-Host ("      SHA256 {0}" -f $hapHash)
Write-Host ("app : {0}  ({1:N0} B)" -f $appOut, $appInfo.Length)
Write-Host ("      SHA256 {0}" -f $appHash)
Write-Host ""
Write-Host "下一步：用 hap-sign-tool 对 hap 签名（命令见 docs/install.md 第 5 节），"
Write-Host "        或直接对 .app 执行 sign-app。"
