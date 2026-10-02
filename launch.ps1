<#
.SYNOPSIS
  Launches Toyota EVBE Charger Dashboard (Angular Edition) and opens your browser automatically.
#>
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Launching Toyota EVBE Charger Dashboard (Angular)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

python launcher.py
