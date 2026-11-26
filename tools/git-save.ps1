<#
.SYNOPSIS
  一键保存当前工程改动到本地 Git。
.EXAMPLE
  pwsh -File tools\git-save.ps1 -Message "修复阅读页翻页"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Message
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".git")) {
  throw "当前目录不是 Git 仓库：$root"
}

git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Host "没有需要保存的改动。" -ForegroundColor Yellow
  exit 0
}

Write-Host "本次将提交：" -ForegroundColor Cyan
$staged | ForEach-Object { Write-Host "  $_" }
git commit -m $Message
if ($LASTEXITCODE -ne 0) {
  throw "git commit 失败（退出码 $LASTEXITCODE）"
}

git log -1 --oneline
Write-Host "已保存到本地 Git（尚未推送到任何远程仓库）。" -ForegroundColor Green
