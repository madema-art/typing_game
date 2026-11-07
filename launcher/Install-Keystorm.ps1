<#
.SYNOPSIS
    Installs KEYSTORM for the current user and creates a desktop shortcut.

.DESCRIPTION
    - Copies the launcher to %LOCALAPPDATA%\Keystorm (no admin rights needed)
    - Compiles KEYSTORM.exe (the splash-screen launcher) with the C# compiler
      that ships with Windows, embedding the KEYSTORM icon
    - Downloads and builds the latest version of the game from GitHub
    - Creates "KEYSTORM" shortcuts on the Desktop and in the Start menu

    Every launch then checks GitHub for a newer version before starting.

.PARAMETER InstallDir
    Where to install. Defaults to %LOCALAPPDATA%\Keystorm.

.PARAMETER CompileOnly
    Only (re)build KEYSTORM.exe. Used by the launcher to update itself.

.EXAMPLE
    Double-click Install-Keystorm.cmd, or run:
    powershell -ExecutionPolicy Bypass -File .\launcher\Install-Keystorm.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Keystorm'),
    [switch]$CompileOnly,
    [switch]$NoDesktopShortcut,
    [switch]$NoStartMenuShortcut,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$SourceDir = $PSScriptRoot
$LauncherDir = Join-Path $InstallDir 'launcher'
$ExePath = Join-Path $InstallDir 'KEYSTORM.exe'

function Write-Banner {
    if ($Quiet) { return }
    Write-Host ''
    Write-Host '   K E Y S T O R M' -ForegroundColor Cyan
    Write-Host '   type to fire  /  defend the spire' -ForegroundColor DarkCyan
    Write-Host ''
}

function Write-Step([string]$Text) {
    if (-not $Quiet) { Write-Host "  > $Text" -ForegroundColor Cyan }
}

function Write-Ok([string]$Text) {
    if (-not $Quiet) { Write-Host "    $Text" -ForegroundColor Green }
}

function Stop-WithError([string]$Text) {
    Write-Host ''
    Write-Host "  ! $Text" -ForegroundColor Red
    Write-Host ''
    exit 1
}

function Find-CSharpCompiler {
    $candidates = @(
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    return $null
}

function Build-LauncherExe {
    # Native tools may write to stderr; in Windows PowerShell 5.1 that must not become a terminating error.
    $ErrorActionPreference = 'Continue'
    $csc = Find-CSharpCompiler
    if (-not $csc) {
        Stop-WithError 'The .NET Framework 4 C# compiler was not found. It ships with Windows 10/11; enable ".NET Framework 4.8" in Windows Features and try again.'
    }
    $source = Join-Path $LauncherDir 'KeystormLauncher.cs'
    $icon = Join-Path $LauncherDir 'assets\keystorm.ico'
    $newExe = Join-Path $InstallDir 'KEYSTORM.new.exe'
    if (Test-Path -LiteralPath $newExe) { Remove-Item -LiteralPath $newExe -Force }

    $cscArgs = @(
        '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
        "/out:$newExe",
        "/win32icon:$icon",
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Management.dll',
        '/reference:System.Web.Extensions.dll',
        $source
    )
    $output = & $csc @cscArgs 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $newExe)) {
        $output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Stop-WithError 'Compiling KEYSTORM.exe failed (see the messages above).'
    }

    # A running exe can't be overwritten, but it can be renamed out of the way.
    if (Test-Path -LiteralPath $ExePath) {
        try {
            Remove-Item -LiteralPath $ExePath -Force -ErrorAction Stop
        }
        catch {
            # Unique name: an older copy may itself still be running. The launcher deletes these on start.
            $old = Join-Path $InstallDir ("KEYSTORM.old-{0}.exe" -f [DateTime]::Now.Ticks)
            Move-Item -LiteralPath $ExePath -Destination $old -Force
        }
    }
    Move-Item -LiteralPath $newExe -Destination $ExePath -Force
}

function Get-NodeVersion {
    $ErrorActionPreference = 'Continue'
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $null }
    $v = (& $node.Source -p 'process.versions.node' 2>$null | Select-Object -First 1)
    if (-not $v) { return $null }
    try { return [version]("$v".Trim()) } catch { return $null }
}

function New-Shortcut([string]$Path) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($Path)
    $lnk.TargetPath = $ExePath
    $lnk.WorkingDirectory = $InstallDir
    $lnk.IconLocation = "$ExePath,0"
    $lnk.Description = 'KEYSTORM - arcade typing defence. Checks for updates, then launches.'
    $lnk.Save()
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}

# ---------------------------------------------------------------------------- compile-only mode

if ($CompileOnly) {
    Build-LauncherExe
    exit 0
}

# ---------------------------------------------------------------------------- full install

Write-Banner

Write-Step 'Checking Node.js'
$nodeVersion = Get-NodeVersion
$minimum = if ($nodeVersion -and $nodeVersion.Major -eq 20) { [version]'20.19.0' } else { [version]'22.12.0' }
if (-not $nodeVersion -or $nodeVersion.Major -eq 21 -or $nodeVersion -lt $minimum) {
    $found = if ($nodeVersion) { "found $nodeVersion" } else { 'not found' }
    Write-Host "    Node.js 22 LTS or newer is required ($found)." -ForegroundColor Yellow
    $answer = Read-Host '    Open the Node.js download page now? [Y/n]'
    if ($answer -notmatch '^[Nn]') { Start-Process 'https://nodejs.org/en/download' }
    Stop-WithError 'Install Node.js, then run this installer again.'
}
Write-Ok "Node.js $nodeVersion"

Write-Step "Installing launcher to $InstallDir"
New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null
$sameDir = (Resolve-Path -LiteralPath $SourceDir).Path.TrimEnd('\') -eq (Resolve-Path -LiteralPath $LauncherDir).Path.TrimEnd('\')
if (-not $sameDir) {
    Copy-Item -Path (Join-Path $SourceDir '*') -Destination $LauncherDir -Recurse -Force
}
# Files from a downloaded zip carry the "from the internet" mark; clear it for our own launcher files.
Get-ChildItem -LiteralPath $LauncherDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
$configPath = Join-Path $InstallDir 'launcher.config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    $config = [ordered]@{
        repo            = 'madema-art/typing_game'
        branch          = ''
        port            = 47615
        checkForUpdates = $true
        browser         = 'auto'
    }
    # UTF-8 without a byte-order mark (Windows PowerShell's -Encoding UTF8 would add one).
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json))
}
Write-Ok 'Launcher files copied'

Write-Step 'Building KEYSTORM.exe'
Build-LauncherExe
Write-Ok $ExePath

Write-Step 'Downloading and building the latest KEYSTORM (first time takes a minute)'
$core = Join-Path $LauncherDir 'keystorm-core.mjs'
$ErrorActionPreference = 'Continue'
& node $core --root $InstallDir --install-only
$coreExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($coreExit -ne 0) {
    Stop-WithError "The game could not be downloaded or built. Details: $(Join-Path $InstallDir 'logs\core.log')"
}

Write-Step 'Creating shortcuts'
if (-not $NoDesktopShortcut) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    New-Shortcut (Join-Path $desktop 'KEYSTORM.lnk')
    Write-Ok "Desktop: $(Join-Path $desktop 'KEYSTORM.lnk')"
}
if (-not $NoStartMenuShortcut) {
    $programs = [Environment]::GetFolderPath('Programs')
    New-Shortcut (Join-Path $programs 'KEYSTORM.lnk')
    Write-Ok 'Start menu: KEYSTORM'
}

Write-Host ''
Write-Host '  KEYSTORM is installed. Every launch checks for updates first.' -ForegroundColor Green
Write-Host "  To uninstall, run $(Join-Path $LauncherDir 'Uninstall-Keystorm.cmd')" -ForegroundColor DarkGray
Write-Host ''
if (-not $Quiet) {
    $go = Read-Host '  Launch KEYSTORM now? [Y/n]'
    if ($go -notmatch '^[Nn]') { Start-Process -FilePath $ExePath -WorkingDirectory $InstallDir }
}
