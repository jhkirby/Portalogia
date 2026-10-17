# Project: Northstar
# Owner: Joshua H. Kirby
# Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
# Last Modified: 2026-10-06

<#
.SYNOPSIS
    Builds Northstar and assembles a runnable Windows app folder.

.DESCRIPTION
    Runs the production build, then lays the app out the way Electron expects
    a packaged app: Electron's own runtime files, with electron.exe renamed to
    Northstar.exe and the app's code in resources\app.

    This replaces electron-builder, which was removed over its build-time
    advisories (SEC-007 in security\security-report-2026-10-06.md). It needs
    nothing beyond Node, npm, and the dev dependencies already installed.

    The output is release\Northstar-win32-x64. Run install.ps1 to install it,
    or launch Northstar.exe in place.

.PARAMETER Clean
    Reinstall the dev dependencies from the lockfile (npm ci) before
    building, instead of reusing node_modules.

.PARAMETER SkipChecks
    Skip the typecheck that runs before the build.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1
#>

[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$releaseDir = Join-Path $repoRoot 'release'
$appName = 'Northstar'
$outputDir = Join-Path $releaseDir "$appName-win32-x64"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step([string]$message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

# Native commands don't throw on failure, so every npm call goes through here
# to stop the build at the first failing step.
function Invoke-Npm([string]$workingDir, [string[]]$arguments) {
    Push-Location $workingDir
    try {
        # npm.cmd rather than npm: the npm.ps1 shim is subject to the
        # execution policy, the .cmd one is not.
        & npm.cmd @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "npm $($arguments -join ' ') failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

if ($env:OS -ne 'Windows_NT') {
    throw 'This script builds the Windows app and must run on Windows.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm was not found on PATH. Install Node.js (https://nodejs.org) first.'
}

if ($Clean -or -not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
    Write-Step 'Installing dependencies (npm ci)'
    Invoke-Npm $repoRoot @('ci', '--no-audit', '--no-fund')
}

if (-not $SkipChecks) {
    Write-Step 'Typechecking'
    Invoke-Npm $repoRoot @('run', 'typecheck')
}

Write-Step 'Regenerating THIRD_PARTY_NOTICES.txt'
Invoke-Npm $repoRoot @('run', 'notices')

Write-Step 'Building (electron-vite build)'
Invoke-Npm $repoRoot @('run', 'build')

# ---------------------------------------------------------------------------
# Assemble the app folder
# ---------------------------------------------------------------------------

Write-Step "Assembling $outputDir"

$electronDist = Join-Path $repoRoot 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $electronDist 'electron.exe'))) {
    throw "Electron's runtime is missing from $electronDist. Run with -Clean to reinstall it."
}

if (Test-Path $outputDir) {
    try {
        Remove-Item $outputDir -Recurse -Force
    }
    catch {
        throw "Could not clear $outputDir. Close any Northstar running from it and try again."
    }
}
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

Copy-Item (Join-Path $electronDist '*') $outputDir -Recurse

# A renamed executable is what makes app.isPackaged true, so the app loads
# its built pages from disk instead of looking for the dev server.
Rename-Item (Join-Path $outputDir 'electron.exe') "$appName.exe"
# Electron's own license, renamed so it doesn't read as Northstar's.
Rename-Item (Join-Path $outputDir 'LICENSE') 'LICENSE.electron.txt'
# Electron's placeholder app. Electron prefers resources\app anyway, but
# shipping it serves no purpose.
$defaultApp = Join-Path $outputDir 'resources\default_app.asar'
if (Test-Path $defaultApp) {
    Remove-Item $defaultApp -Force
}

$appDir = Join-Path $outputDir 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $repoRoot 'out') $appDir -Recurse
Copy-Item (Join-Path $repoRoot 'package.json') $appDir
Copy-Item (Join-Path $repoRoot 'package-lock.json') $appDir

# The main process loads its dependencies (node-pty, the ad blocker, ...)
# from node_modules at runtime, so the app needs the production ones. Install
# scripts are skipped: node-pty ships N-API prebuilds that Electron loads
# as-is, so there's nothing to compile.
Write-Step 'Installing production dependencies into the app'
Invoke-Npm $appDir @('ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund')

# The license requires every copy to carry its terms, and the bundled
# dependencies' licenses require their notices too, so all three ship next
# to the executable.
foreach ($file in 'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.txt') {
    Copy-Item (Join-Path $repoRoot $file) $outputDir
}
# install.ps1 points the shortcuts at this icon. Northstar.exe itself still
# carries Electron's icon, since changing an exe's icon needs a resource
# editor this script doesn't depend on.
Copy-Item (Join-Path $repoRoot 'resources\icon.ico') (Join-Path $outputDir "$appName.ico")

$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$electronVersion = (Get-Content (Join-Path $electronDist 'version') -Raw).Trim()
$sizeMb = [math]::Round(((Get-ChildItem $outputDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)

Write-Host ''
Write-Host "Built $appName $version (Electron $electronVersion), $sizeMb MB:" -ForegroundColor Green
Write-Host "  $outputDir"
Write-Host 'Install it with: powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1'
