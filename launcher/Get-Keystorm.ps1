# KEYSTORM web installer.
# Downloads the project from GitHub into a temporary folder and runs the regular
# installer, which installs KEYSTORM to D:\Keystorm and creates the shortcuts.
#
# Run in PowerShell:
#   irm https://raw.githubusercontent.com/madema-art/typing_game/refs/heads/claude/brave-edison-9nckwo/launcher/Get-Keystorm.ps1 | iex
#
# To install somewhere else, set KEYSTORM_DIR first:
#   $env:KEYSTORM_DIR = 'E:\Games\Keystorm'; irm <url above> | iex
#
# Everything runs inside a script block so nothing leaks into your PowerShell session,
# and the script never calls `exit` (that would close your window when run via iex).
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far faster without the progress bar
    $repo = 'madema-art/typing_game'
    $branch = if ($env:KEYSTORM_BRANCH) { $env:KEYSTORM_BRANCH } else { 'claude/brave-edison-9nckwo' }
    $installDir = if ($env:KEYSTORM_DIR) { $env:KEYSTORM_DIR } else { 'D:\Keystorm' }

    # Windows PowerShell 5.1 may default to old TLS versions that GitHub refuses.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $work = Join-Path ([IO.Path]::GetTempPath()) ('keystorm-setup-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        Write-Host ''
        Write-Host '  Downloading KEYSTORM...' -ForegroundColor Cyan
        $zip = Join-Path $work 'keystorm.zip'
        Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$repo/archive/refs/heads/$branch.zip" -OutFile $zip
        Expand-Archive -LiteralPath $zip -DestinationPath $work -Force
        $installer = Get-ChildItem -LiteralPath $work -Recurse -Filter 'Install-Keystorm.ps1' |
            Where-Object { $_.Directory.Name -eq 'launcher' } | Select-Object -First 1
        if (-not $installer) { throw 'The download did not contain the KEYSTORM installer.' }

        # Run the installer as its own process so the PC's script execution policy doesn't block it.
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer.FullName -InstallDir $installDir
    }
    catch {
        Write-Host ''
        Write-Host "  ! $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ''
    }
    finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
