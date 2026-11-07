<#
.SYNOPSIS
    Installs KEYSTORM for the current user and creates a desktop shortcut.

.DESCRIPTION
    - Installs to D:\Keystorm, creating the folder if needed (no admin rights needed)
    - Compiles KEYSTORM.exe (the splash-screen launcher) with the C# compiler
      that ships with Windows, embedding the KEYSTORM icon
    - Downloads and builds the latest version of the game from GitHub
    - Creates "KEYSTORM" shortcuts on the Desktop and in the Start menu
    - Moves saved high scores and settings over from an earlier install in
      %LOCALAPPDATA%\Keystorm, if there is one

    Everything KEYSTORM keeps (game, launcher, updates, logs, settings and
    saved scores) lives inside the install folder. Every launch checks GitHub
    for a newer version before starting.

.PARAMETER InstallDir
    Where to install. Defaults to D:\Keystorm. Example for another drive:
    Install-Keystorm.cmd -InstallDir "E:\Games\Keystorm"

.PARAMETER CompileOnly
    Only (re)build KEYSTORM.exe. Used by the launcher to update itself.

.EXAMPLE
    Double-click Install-Keystorm.cmd, or run:
    powershell -ExecutionPolicy Bypass -File .\launcher\Install-Keystorm.ps1
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'D:\Keystorm',
    [switch]$CompileOnly,
    [switch]$NoDesktopShortcut,
    [switch]$NoStartMenuShortcut,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
$SourceDir = $PSScriptRoot
# Absolute path, resolved against the PowerShell location (works for folders that don't exist yet).
$InstallDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallDir).TrimEnd('\')
$LegacyDir = Join-Path $env:LOCALAPPDATA 'Keystorm'
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

function Initialize-InstallDir {
    # Make sure the drive exists and is writable, then create the folder. No admin rights needed:
    # standard users may create folders at the root of a Windows data drive and own what they create.
    $root = [IO.Path]::GetPathRoot($InstallDir)
    if ($root -match '^[A-Za-z]:\\?$') {
        $drive = New-Object IO.DriveInfo $root
        if (-not $drive.IsReady) {
            Stop-WithError "Drive $($root.TrimEnd('\')) is not available. Connect it, or install somewhere else, e.g.:  Install-Keystorm.cmd -InstallDir `"C:\Games\Keystorm`""
        }
        if ($drive.DriveType -eq [IO.DriveType]::CDRom) {
            Stop-WithError "Drive $($root.TrimEnd('\')) is a CD/DVD drive. Install somewhere else, e.g.:  Install-Keystorm.cmd -InstallDir `"C:\Games\Keystorm`""
        }
    }
    try {
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        $probe = Join-Path $InstallDir ('.write-test-' + [Guid]::NewGuid().ToString('N'))
        [IO.File]::WriteAllText($probe, 'ok')
        Remove-Item -LiteralPath $probe -Force
    }
    catch {
        Stop-WithError "Windows did not allow KEYSTORM to write to $InstallDir ($($_.Exception.Message)). Create the folder in File Explorer first, or choose another folder with -InstallDir."
    }
}

function Stop-KeystormProcesses([string]$Dir) {
    # The launcher, its local game server and the game window all have the install folder in their command line.
    # Match the folder itself, not a sibling such as D:\Keystorm2.
    $pattern = [regex]::Escape($Dir.TrimEnd('\')) + '(\\|"|\s|$)'
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('KEYSTORM.exe', 'node.exe', 'msedge.exe', 'chrome.exe') -and $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $pattern } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $exe = (Join-Path $Dir 'KEYSTORM.exe').ToLowerInvariant()
    Get-Process -Name 'KEYSTORM' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.ToLowerInvariant() -eq $exe } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

function Move-LegacyInstall {
    # Earlier versions installed to %LOCALAPPDATA%\Keystorm. Bring the saved high scores
    # (they live in the game window's browser profile) and settings over, then remove the old copy.
    if (-not (Test-Path -LiteralPath $LegacyDir)) { return }
    if ($LegacyDir.TrimEnd('\') -ieq $InstallDir) { return }
    $legacyProfile = Join-Path $LegacyDir 'browser-profile'
    $legacyConfig = Join-Path $LegacyDir 'launcher.config.json'
    if (-not (Test-Path -LiteralPath $legacyProfile) -and -not (Test-Path -LiteralPath $legacyConfig)) { return }

    Write-Step "Moving saved scores and settings from $LegacyDir"
    Stop-KeystormProcesses $LegacyDir
    Start-Sleep -Milliseconds 800

    $newProfile = Join-Path $InstallDir 'browser-profile'
    $scoresSafe = $true
    if (Test-Path -LiteralPath $legacyProfile) {
        if (Test-Path -LiteralPath $newProfile) {
            # Both places have saved data: keep the new one active and leave the old one untouched.
            $scoresSafe = $false
            Write-Ok 'Keeping the scores already saved in the new location'
        }
        else {
            try {
                Copy-Item -LiteralPath $legacyProfile -Destination $newProfile -Recurse -Force -ErrorAction Stop
                Write-Ok 'High scores moved'
            }
            catch {
                $scoresSafe = $false
                Write-Host "    Could not copy saved scores: $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }
    $newConfig = Join-Path $InstallDir 'launcher.config.json'
    if ((Test-Path -LiteralPath $legacyConfig) -and -not (Test-Path -LiteralPath $newConfig)) {
        Copy-Item -LiteralPath $legacyConfig -Destination $newConfig -Force
        Write-Ok 'Settings moved'
    }

    if ($scoresSafe) {
        Remove-Item -LiteralPath $LegacyDir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $LegacyDir) {
            Write-Host "    The old copy in $LegacyDir could not be fully removed; you can delete it later." -ForegroundColor Yellow
        }
        else {
            Write-Ok 'Old copy removed'
        }
    }
    else {
        Write-Host "    The old copy was left in $LegacyDir so no scores are lost." -ForegroundColor Yellow
    }
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

Write-Step "Installing to $InstallDir"
Initialize-InstallDir
Move-LegacyInstall
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
Write-Host "  KEYSTORM is installed in $InstallDir. Every launch checks for updates first." -ForegroundColor Green
Write-Host "  To uninstall, run $(Join-Path $LauncherDir 'Uninstall-Keystorm.cmd')" -ForegroundColor DarkGray
Write-Host ''
if (-not $Quiet) {
    $go = Read-Host '  Launch KEYSTORM now? [Y/n]'
    if ($go -notmatch '^[Nn]') { Start-Process -FilePath $ExePath -WorkingDirectory $InstallDir }
}
