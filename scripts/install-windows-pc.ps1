param(
    [switch] $Update
)

$ErrorActionPreference = "Stop"

function Fail([string] $Message) {
    throw $Message
}

$appRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $node -or -not $npm) {
    Fail "Node.js 20 or newer is required. Install it from https://nodejs.org/ and run this installer again."
}

$nodeMajor = [int]((& $node.Source -p 'Number(process.versions.node.split(".")[0])'))
if ($nodeMajor -lt 20) {
    Fail "Node.js 20 or newer is required. Current version: $nodeMajor"
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    Fail "Git for Windows is required. Install it from https://git-scm.com/ and run this installer again."
}

if ($Update) {
    Write-Host "Updating the repository..."
    Set-Location $appRoot
    & git.exe pull --ff-only
}

Write-Host "Installing and building Merekai Presenter..."
Set-Location $appRoot
& $npm.Source install
& $npm.Source --prefix control-panel install
& $npm.Source run build

$launcherDirectory = Join-Path $env:LOCALAPPDATA "MerekaiPresenter"
$launcherPath = Join-Path $launcherDirectory "start-control-panel.ps1"
$playerLauncherPath = Join-Path $launcherDirectory "start-player.ps1"
$iconPath = Join-Path $appRoot "iconoMerekaiGallery.ico"
New-Item -ItemType Directory -Force $launcherDirectory | Out-Null

$escapedAppRoot = $appRoot.Replace("'", "''")
$launcherContent = @'
$ErrorActionPreference = "Stop"
$appRoot = '__APP_ROOT__'
$panelUrl = "http://127.0.0.1:3131/"

try {
    Invoke-WebRequest -Uri $panelUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
    $ready = $true
} catch {
    $ready = $false
}

if (-not $ready) {
    Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $appRoot -WindowStyle Hidden
}

$ready = $false
1..60 | ForEach-Object {
    if (-not $ready) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri $panelUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
        } catch {
        }
    }
}

if (-not $ready) {
    throw "Merekai Presenter did not start on $panelUrl."
}

Start-Process $panelUrl
'@.Replace('__APP_ROOT__', $escapedAppRoot)
Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8

$playerLauncherContent = @'
$ErrorActionPreference = "Stop"
$appRoot = '__APP_ROOT__'
$playerUrl = "http://127.0.0.1:3131/player/"
$panelUrl = "http://127.0.0.1:3131/"

try {
    Invoke-WebRequest -Uri $panelUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
    $ready = $true
} catch {
    $ready = $false
}

if (-not $ready) {
    Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $appRoot -WindowStyle Hidden
}

$ready = $false
1..60 | ForEach-Object {
    if (-not $ready) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri $playerUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
        } catch {
        }
    }
}

if (-not $ready) {
    throw "Merekai Presenter did not start on $playerUrl."
}

$settings = Invoke-RestMethod -Uri "$panelUrl/api/settings"
if ($settings.autoStartPlayer -ne "true") {
    exit 0
}

$browser = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browser) {
    throw "Microsoft Edge or Google Chrome was not found."
}

$profile = Join-Path $env:LOCALAPPDATA "MerekaiPresenter\browser-profile"
Start-Process -FilePath $browser -ArgumentList @(
    "--kiosk",
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--user-data-dir=$profile",
    $playerUrl
)
'@.Replace('__APP_ROOT__', $escapedAppRoot)
Set-Content -Path $playerLauncherPath -Value $playerLauncherContent -Encoding UTF8

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Merekai Presenter Control Panel.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.WorkingDirectory = $appRoot
$shortcut.Description = "Open the Merekai Presenter control panel"
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Save()

$startupPath = [Environment]::GetFolderPath("Startup")
$playerShortcutPath = Join-Path $startupPath "Merekai Presenter Player.lnk"
$playerShortcut = $shell.CreateShortcut($playerShortcutPath)
$playerShortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$playerShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$playerLauncherPath`""
$playerShortcut.WorkingDirectory = $appRoot
$playerShortcut.Description = "Start the Merekai Presenter player in fullscreen mode"
$playerShortcut.IconLocation = "$iconPath,0"
$playerShortcut.WindowStyle = 7
$playerShortcut.Save()

if ($Update) {
    $appRootPattern = [regex]::Escape($appRoot)
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object {
            $_.CommandLine -match $appRootPattern -and
            $_.CommandLine -match 'dist[\\/]+main[\\/]+index\.js'
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

    Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $appRoot -WindowStyle Hidden
}

Write-Host ""
Write-Host "Merekai Presenter is installed."
Write-Host "Control panel: http://127.0.0.1:3131/"
Write-Host "Desktop shortcut: $shortcutPath"
Write-Host "Player autostart: $playerShortcutPath"