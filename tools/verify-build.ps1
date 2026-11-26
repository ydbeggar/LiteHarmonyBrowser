<#
.SYNOPSIS
  构建后检查 HAP：BIN-only、双端页面齐全、页面 JS 体积。
.DESCRIPTION
  由 tools/build.ps1 在 pack-app 之后调用；也可以手工：
    pwsh -File tools/verify-build.ps1
#>
[CmdletBinding()]
param(
  [string]$Hap = "dist\unsigned\LiteHarmonyBrowser-v1.1.2-unsigned-final.hap",
  # v1.1.3：正式产物默认不含 jerry-snapshot 字节码 .bc（运行时解析同名 .js）。
  # 只有在做 -KeepBytecode 对照构建时才加 -AllowBytecode。
  [switch]$AllowBytecode
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$hapPath = if ([System.IO.Path]::IsPathRooted($Hap)) { $Hap } else { Join-Path $root $Hap }
if (-not (Test-Path $hapPath)) { throw "找不到 HAP：$hapPath" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($hapPath)
$fail = 0
try {
  $entries = @{}
  foreach ($e in $zip.Entries) { $entries[$e.FullName] = $e.Length }

  $png = @($entries.Keys | Where-Object { $_ -match '\.(png|jpg|jpeg|bmp)$' })
  Write-Host "HAP 条目数 : $($entries.Count)"
  Write-Host "PNG 条目数 : $($png.Count)"
  if ($png.Count -gt 0) {
    Write-Host "PNG 残留：" -ForegroundColor Red
    $png | ForEach-Object { Write-Host "  $_" }
    $fail += 1
  }

  $required = @(
    'assets/js/MainAbility/pages/ai/ai.js',
    'assets/js/MainAbility/pages/round/ai/ai.js',
    'assets/js/MainAbility/pages/rss/rss.js',
    'assets/js/MainAbility/pages/round/rss/rss.js'
  )
  foreach ($r in $required) {
    if (-not $entries.ContainsKey($r)) {
      Write-Host "缺少页面：$r" -ForegroundColor Red
      $fail += 1
    }
  }

  $pageJs = @($entries.Keys | Where-Object { $_ -match '^assets/js/MainAbility/pages/.+\.js$' })
  $over = @()
  foreach ($p in $pageJs) {
    if ($entries[$p] -gt 112KB) { $over += $p }
  }
  if ($over.Count -gt 0) {
    Write-Host "页面 JS 超过 112KB：" -ForegroundColor Red
    $over | ForEach-Object { Write-Host "  $_ ($([math]::Round($entries[$_] / 1KB, 1)) KB)" }
    $fail += 1
  }

  $bc = @($entries.Keys | Where-Object { $_ -match '\.bc$' })
  Write-Host "字节码 .bc : $($bc.Count) 个"
  if ($AllowBytecode) {
    $bcMissing = @($pageJs | Where-Object {
      $bin = $_.Substring(0, $_.Length - 3) + '.bc'
      -not $entries.ContainsKey($bin)
    })
    Write-Host "无 .bc 的页面（信息，-AllowBytecode）：$($bcMissing.Count)"
  } elseif ($bc.Count -gt 0) {
    Write-Host "正式产物不应包含 .bc（运行时统一解析 .js）：" -ForegroundColor Red
    $bc | ForEach-Object { Write-Host "  $_ ($([math]::Round($entries[$_] / 1KB, 1)) KB)" }
    $fail += 1
  }
} finally {
  $zip.Dispose()
}

if ($fail -gt 0) {
  throw "构建检查失败（$fail 项）"
}
Write-Host "构建检查通过：BIN-only / 无字节码 / 双端页面齐全 / 页面 JS 体积合规" -ForegroundColor Green
