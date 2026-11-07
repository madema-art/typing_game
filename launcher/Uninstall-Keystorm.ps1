<#
.SYNOPSIS
    Removes KEYSTORM: shortcuts, the installed game, the launcher and its browser profile.
    Your high scores live in that browser profile and are removed too.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Keystorm'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host '   K E Y S T O R M   uninstall' -ForegroundColor Cyan
Write-Host ''

if (-not $Force) {
    $answer = Read-Host "  Remove KEYSTORM from $InstallDir (including saved high scores)? [y/N]"
    if ($answer -notmatch '^[Yy]') { Write-Host '  Cancelled.'; exit 0 }
}

# Stop a running launcher, game server or game window that uses this install.
$installLower = $InstallDir.ToLowerInvariant()
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($installLower) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process -Name 'KEYSTORM' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

foreach ($lnk in @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'KEYSTORM.lnk'),
        (Join-Path ([Environment]::GetFolderPath('Programs')) 'KEYSTORM.lnk'))) {
    if (Test-Path -LiteralPath $lnk) {
        Remove-Item -LiteralPath $lnk -Force
        Write-Host "  Removed $lnk" -ForegroundColor DarkGray
    }
}

if (Test-Path -LiteralPath $InstallDir) {
    # This script may be running from inside the install folder; PowerShell has already read it, so deleting is fine.
    Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $InstallDir) {
        Write-Host "  Some files were in use; delete $InstallDir manually after closing KEYSTORM." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Removed $InstallDir" -ForegroundColor DarkGray
    }
}

Write-Host ''
Write-Host '  KEYSTORM has been uninstalled.' -ForegroundColor Green
Write-Host ''
