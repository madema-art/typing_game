<#
.SYNOPSIS
    Removes KEYSTORM: its shortcuts, the game and the launcher.

.DESCRIPTION
    Saved high scores and settings are kept by default (in browser-profile and
    launcher.config.json inside the install folder), so reinstalling to the same
    folder brings them back. Answer "y" to the question, or pass -DeleteScores,
    to remove them as well.

.PARAMETER InstallDir
    The KEYSTORM folder. Defaults to the install this script belongs to, otherwise D:\Keystorm.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = '',
    [switch]$DeleteScores,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) {
    # When run from <install>\launcher, uninstall that install; otherwise use the default location.
    $parent = Split-Path -Parent $PSScriptRoot
    if ((Test-Path -LiteralPath (Join-Path $parent 'KEYSTORM.exe')) -or (Test-Path -LiteralPath (Join-Path $parent 'launcher.config.json'))) {
        $InstallDir = $parent
    }
    else {
        $InstallDir = 'D:\Keystorm'
    }
}
$InstallDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallDir).TrimEnd('\')

Write-Host ''
Write-Host '   K E Y S T O R M   uninstall' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path -LiteralPath $InstallDir)) {
    Write-Host "  Nothing to remove: $InstallDir does not exist." -ForegroundColor Yellow
    Write-Host ''
    exit 0
}

if (-not $Force) {
    $answer = Read-Host "  Uninstall KEYSTORM from $InstallDir? [y/N]"
    if ($answer -notmatch '^[Yy]') { Write-Host '  Cancelled.'; exit 0 }
    if (-not $DeleteScores) {
        $answer = Read-Host '  Also delete your saved high scores and settings? [y/N]'
        $DeleteScores = $answer -match '^[Yy]'
    }
}

# Stop the launcher, its local game server and the game window if they are running.
$pattern = [regex]::Escape($InstallDir) + '(\\|"|\s|$)'
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('KEYSTORM.exe', 'node.exe', 'msedge.exe', 'chrome.exe') -and $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $pattern } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

# Remove shortcuts that point at this install.
$exe = Join-Path $InstallDir 'KEYSTORM.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'KEYSTORM.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'KEYSTORM.lnk'))) {
    if (-not (Test-Path -LiteralPath $lnk)) { continue }
    $target = $shell.CreateShortcut($lnk).TargetPath
    if ($target -and $target -ine $exe) { continue }
    Remove-Item -LiteralPath $lnk -Force
    Write-Host "  Removed $lnk" -ForegroundColor DarkGray
}
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)

# This script may itself live inside the install folder; PowerShell has already read it, so deleting is fine.
$keep = @()
if (-not $DeleteScores) { $keep = @('browser-profile', 'launcher.config.json') }
Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object { $keep -notcontains $_.Name } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
if ($DeleteScores) { Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue }

$left = @(Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue | Where-Object { $keep -notcontains $_.Name })
if ($left.Count -gt 0) {
    Write-Host "  Some files were in use; delete $InstallDir manually after closing KEYSTORM." -ForegroundColor Yellow
}
elseif ($DeleteScores) {
    Write-Host "  Removed $InstallDir" -ForegroundColor DarkGray
}
else {
    Write-Host "  Removed KEYSTORM from $InstallDir." -ForegroundColor DarkGray
    Write-Host '  Your high scores and settings were kept there; reinstall to the same folder to get them back.' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  KEYSTORM has been uninstalled.' -ForegroundColor Green
Write-Host ''
