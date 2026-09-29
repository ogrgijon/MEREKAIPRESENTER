# Windows PC Presenter

This guide turns a Windows 10 or Windows 11 PC into a dedicated Merekai
Presenter machine. The PC runs the local Node.js server and opens the player
in Microsoft Edge or Google Chrome kiosk mode when the user signs in.

The commands below use PowerShell. Install the application in a folder owned by
the Windows user who will run the presentation. The application has no
authentication, so keep the server on localhost unless remote control is
intentional.

**Disclaimer:** The installer changes local files, creates a desktop shortcut,
starts a Node.js process, and can be configured to start software at sign-in.
Review [the installer script](../scripts/install-windows-pc.ps1), keep backups,
and test the complete setup before a public event. You are responsible for
system recovery, media rights, firewall rules, physical access, and any data
loss, downtime, or security exposure.

## 1. Install the prerequisites

Install these components:

- Node.js 20 LTS or newer from [nodejs.org](https://nodejs.org/)
- Git for Windows from [git-scm.com](https://git-scm.com/)
- Microsoft Edge or Google Chrome

Open PowerShell and confirm the commands are available:

```powershell
node --version
npm --version
git --version
```

The Node.js version must be 20 or newer.

For a quick installation from the repository root, run the included installer:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows-pc.ps1
```

It installs the project dependencies, builds the application, and places a
**Merekai Presenter Control Panel** shortcut on the Windows desktop. Opening
the shortcut starts the local server when necessary and opens the panel in the
default browser. The manual steps below explain the same setup when you need
to customize it.

To update an existing installation, run this from the repository root. It
performs a fast-forward Git update, reinstalls dependencies, and rebuilds the
application without removing settings or media:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-windows-pc.ps1 -Update
```

The update requires a clean Git checkout. If local changes prevent a
fast-forward update, Git stops without overwriting them.

## 2. Install and build Merekai Presenter

Clone the repository, install both dependency sets, and build the application:

```powershell
Set-Location $HOME
git clone https://github.com/<github-user>/<repository>.git merekaipresenter
Set-Location .\merekaipresenter
npm install
npm --prefix control-panel install
npm run build
```

Create the default media folder and copy the presentation files into it:

```powershell
New-Item -ItemType Directory -Force "$HOME\Pictures\MerekaiGallery"
```

Supported formats are `jpg`, `jpeg`, `png`, `gif`, `webp`, `mp4`, and `webm`.
The media folder can be changed later from **Settings**. Application data is
stored under `%APPDATA%\merekaipresenter`.

## 3. Start and configure the server

From the repository directory, start the local server:

```powershell
npm start
```

Keep that PowerShell window open while using the presenter. Open
`http://127.0.0.1:3131/` in a browser, select the media folder in **Settings**,
and configure the order, overlays, and playback options. The fullscreen player
is at `http://127.0.0.1:3131/player/`.

For a quick development run that builds before starting, use:

```powershell
npm run dev
```

To control the presenter from another device on the same network, set the
`HOST` environment variable before starting the server:

```powershell
$env:HOST = "0.0.0.0"
npm start
```

Allow TCP port 3131 through Windows Firewall only on a trusted private network.
Do not expose the server to the Internet without adding authentication and
network restrictions.

## 4. Start the player in kiosk mode

Create a launcher script in the repository directory. It starts the server,
waits for it to become available, and then opens the player fullscreen:

```powershell
@'
$ErrorActionPreference = "Stop"
$appRoot = $PSScriptRoot

Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $appRoot -WindowStyle Hidden

do {
    Start-Sleep -Seconds 1
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:3131/player/" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $ready = $true
    } catch {
        $ready = $false
    }
} until ($ready)

$browser = @(
    (Get-Command msedge.exe -ErrorAction SilentlyContinue).Source,
    (Get-Command chrome.exe -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ } | Select-Object -First 1

if (-not $browser) {
    throw "Microsoft Edge or Google Chrome was not found on PATH."
}

$profile = Join-Path $env:LOCALAPPDATA "MerekaiPresenter\browser-profile"
Start-Process -FilePath $browser -ArgumentList @(
    "--kiosk",
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--user-data-dir=$profile",
    "http://127.0.0.1:3131/player/"
)
'@ | Set-Content -Encoding UTF8 .\start-presenter.ps1
```

Test the launcher:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\start-presenter.ps1
```

To close kiosk mode during maintenance, press `Alt+F4`. Stop the server with
`Get-Process node | Stop-Process` when the launcher was started in the
background.

## 5. Start automatically when Windows signs in

Create a shortcut in the current user's Startup folder:

```powershell
$startup = [Environment]::GetFolderPath("Startup")
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $startup "Merekai Presenter.lnk"))
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-ExecutionPolicy Bypass -File `"$PWD\start-presenter.ps1`""
$shortcut.WorkingDirectory = $PWD.Path
$shortcut.WindowStyle = 7
$shortcut.Save()
```

Sign out and back in to test the complete startup. Configure Windows to sign
in automatically only on a dedicated, physically controlled presentation PC.

## 6. Verify and update the presenter

1. Confirm the browser opens the player fullscreen after sign-in.
2. Confirm the configured media folder is shown in **Settings**.
3. Test play, pause, next, previous, overlays, and media ordering.

For a manual update without removing media or settings, use the following only
when the installer script cannot be used:

```powershell
Set-Location $HOME\merekaipresenter
git pull
npm install
npm --prefix control-panel install
npm run build
```
