# One-click build for the Wallbox Event Timeline Dashboard.
#
#   powershell -ExecutionPolicy Bypass -File build.ps1              # build + smoke test
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Launch     # build, test, then launch
#   powershell -ExecutionPolicy Bypass -File build.ps1 -Mode onefolder
#
# Delegates to build.py so there is a single build driver.

[CmdletBinding()]
param(
    [ValidateSet("onefile", "onefolder")]
    [string]$Mode = "onefile",

    [switch]$Launch
)

$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $AppDir "build.py"

$extra = @()
if ($Launch) { $extra += "--launch" }

Write-Host "Building via build.py (mode=$Mode)..."
Set-Location -LiteralPath $AppDir
& python $py --mode $Mode @extra
if ($LASTEXITCODE -ne 0) { throw "build.py failed with exit code $LASTEXITCODE" }
Write-Host "Build complete."