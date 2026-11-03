# Project: Portalogia
# Owner: Joshua H. Kirby
# Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
# Last Modified: 2026-10-06

<#
.SYNOPSIS
    Removes a Portalogia install made by install.ps1.

.DESCRIPTION
    install.ps1 copies this script into the install folder, and Settings >
    Apps > Installed apps runs it from there. It removes the program files,
    the shortcuts, and the Installed apps entry.

    Browsing data (history, bookmarks, sessions, notes) in %APPDATA%\Portalogia
    is kept unless -RemoveUserData is passed.

.PARAMETER InstallDir
    The install to remove. Defaults to the folder this script runs from when
    that is an install, else %LOCALAPPDATA%\Programs\Portalogia.

.PARAMETER RemoveUserData
    Also delete %APPDATA%\Portalogia.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall.ps1
#>

[CmdletBinding()]
param(
    [string]$InstallDir,
    [switch]$RemoveUserData
)

$ErrorActionPreference = 'Stop'

$appName = 'Portalogia'
$exeName = "$appName.exe"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appName"
$userDataDir = Join-Path $env:APPDATA $appName

if (-not $InstallDir) {
    $InstallDir = if (Test-Path (Join-Path $PSScriptRoot $exeName)) {
        $PSScriptRoot
    }
    else {
        Join-Path $env:LOCALAPPDATA "Programs\$appName"
    }
}
$InstallDir = [IO.Path]::GetFullPath($InstallDir)

$running = Get-Process -Name $appName -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
    throw "$appName is running. Close it and try again."
}

if (Test-Path $InstallDir) {
    # Same guard as the installer: never recursively delete a folder that
    # isn't a Portalogia install.
    if (-not (Test-Path (Join-Path $InstallDir $exeName))) {
        throw "$InstallDir is not a $appName install."
    }
    # This script may be running from inside the folder it deletes; step
    # out so the shell's working directory doesn't hold it open.
    Set-Location $env:TEMP
    Remove-Item $InstallDir -Recurse -Force
    Write-Host "Removed $InstallDir"
}

foreach ($shortcut in @(
        (Join-Path ([Environment]::GetFolderPath('Programs')) "$appName.lnk"),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk")
    )) {
    if (Test-Path $shortcut) {
        Remove-Item $shortcut -Force
        Write-Host "Removed $shortcut"
    }
}

if (Test-Path $uninstallKey) {
    Remove-Item $uninstallKey -Recurse -Force
}

if ($RemoveUserData -and (Test-Path $userDataDir)) {
    Remove-Item $userDataDir -Recurse -Force
    Write-Host "Removed $userDataDir"
}
elseif (Test-Path $userDataDir) {
    Write-Host "Kept browsing data in $userDataDir (pass -RemoveUserData to delete it)."
}

Write-Host "$appName uninstalled." -ForegroundColor Green
