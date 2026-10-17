# Project: Northstar
# Owner: Joshua H. Kirby
# Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
# Last Modified: 2026-10-06

<#
.SYNOPSIS
    Installs the Northstar build for the current user.

.DESCRIPTION
    Copies release\Northstar-win32-x64 (made by build.ps1) into the install
    folder, adds a Start Menu shortcut, and registers Northstar under
    Settings > Apps > Installed apps so it can be uninstalled from there.

    Everything is per-user (no administrator rights needed). Running it
    again upgrades in place; browsing data in %APPDATA%\Northstar is never
    touched.

.PARAMETER Build
    Run build.ps1 first.

.PARAMETER InstallDir
    Where to install. Defaults to %LOCALAPPDATA%\Programs\Northstar.

.PARAMETER DesktopShortcut
    Also put a shortcut on the desktop.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -Build -DesktopShortcut
#>

[CmdletBinding()]
param(
    [switch]$Build,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\Northstar'),
    [switch]$DesktopShortcut
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appName = 'Northstar'
$sourceDir = Join-Path $repoRoot "release\$appName-win32-x64"
$exeName = "$appName.exe"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appName"
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk"
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"

function Write-Step([string]$message) {
    Write-Host "==> $message" -ForegroundColor Cyan
}

function New-Shortcut([string]$path, [string]$target, [string]$icon) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = Split-Path $target
    $shortcut.IconLocation = "$icon,0"
    $shortcut.Description = 'Northstar browser'
    $shortcut.Save()
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

if ($Build) {
    & (Join-Path $PSScriptRoot 'build.ps1')
}

if (-not (Test-Path (Join-Path $sourceDir $exeName))) {
    throw "No build found at $sourceDir. Run scripts\windows\build.ps1 first, or pass -Build."
}

$InstallDir = [IO.Path]::GetFullPath($InstallDir)

# Files in use can't be replaced, and a half-copied install is worse than none.
$running = Get-Process -Name $appName -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
    throw "$appName is running from $InstallDir. Close it and run the installer again."
}

# The old install is deleted wholesale, so only delete a folder that is
# provably a Northstar install - never whatever -InstallDir happens to name.
if (Test-Path $InstallDir) {
    $isOurs = Test-Path (Join-Path $InstallDir $exeName)
    $isEmpty = -not (Get-ChildItem $InstallDir -Force | Select-Object -First 1)
    if (-not $isOurs -and -not $isEmpty) {
        throw "$InstallDir already exists and is not a $appName install. Choose another -InstallDir."
    }
}

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

Write-Step "Copying files to $InstallDir"
if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item (Join-Path $sourceDir '*') $InstallDir -Recurse
Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') $InstallDir

$exePath = Join-Path $InstallDir $exeName
$iconPath = Join-Path $InstallDir "$appName.ico"

Write-Step 'Creating shortcuts'
New-Shortcut $startMenuShortcut $exePath $iconPath
if ($DesktopShortcut) {
    New-Shortcut $desktopShortcutPath $exePath $iconPath
}

Write-Step 'Registering with Installed apps'
$version = (Get-Content (Join-Path $InstallDir 'resources\app\package.json') -Raw | ConvertFrom-Json).version
$sizeKb = [int]((Get-ChildItem $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
$uninstallCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'uninstall.ps1')`""

New-Item -Path $uninstallKey -Force | Out-Null
$entries = @{
    DisplayName     = $appName
    DisplayVersion  = $version
    Publisher       = 'Joshua H. Kirby'
    InstallLocation = $InstallDir
    DisplayIcon     = $iconPath
    UninstallString = $uninstallCommand
    InstallDate     = (Get-Date -Format 'yyyyMMdd')
}
foreach ($name in $entries.Keys) {
    Set-ItemProperty -Path $uninstallKey -Name $name -Value $entries[$name]
}
Set-ItemProperty -Path $uninstallKey -Name EstimatedSize -Value $sizeKb -Type DWord
Set-ItemProperty -Path $uninstallKey -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $uninstallKey -Name NoRepair -Value 1 -Type DWord

Write-Host ''
Write-Host "Installed $appName $version to $InstallDir" -ForegroundColor Green
Write-Host 'Launch it from the Start Menu, or uninstall it from Settings > Apps > Installed apps.'
