# Linux PC Presenter

This guide turns a Debian-based desktop PC into a dedicated Merekai Presenter
machine. It is suitable for Debian, Ubuntu, Linux Mint, and similar
distributions with a graphical desktop. The PC runs the local server and opens
the player in Chromium kiosk mode when the desktop session starts.

The commands below assume a normal desktop user named `<linux-user>` and a
working Internet connection during installation. The application has no
authentication, so keep the server on localhost unless remote control is
intentional.

**Disclaimer:** The installer changes the system package set, creates a
`systemd` service, writes desktop startup entries, and builds application
dependencies. Review [the installer script](../scripts/install-linux-pc.sh),
keep backups, and test the complete setup before a public event. You are
responsible for system recovery, media rights, firewall rules, physical access,
and any data loss, downtime, or security exposure.

## 1. Install the prerequisites

On Debian or Ubuntu, install the desktop browser, build tools, and Git:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git chromium build-essential
```

Install Node.js 20 or newer. If `node --version` already reports version 20
or newer, skip the NodeSource commands:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs npm
```

Confirm the prerequisites:

```bash
node --version
npm --version
chromium --version
```

For a quick installation from the repository root, run the included installer:

```bash
bash scripts/install-linux-pc.sh
```

Run this command as the normal desktop user. Do not start it from a root shell;
the installer uses the logged-in user's home directory for the Chromium player
autostart entry.

It installs the Debian packages, builds the application, creates the
`systemd` service, places a **Merekai Presenter Control Panel** shortcut in the
desktop and application menu, and registers the fullscreen player in the
desktop session's autostart. GNOME uses a per-user systemd service attached to
`graphical-session.target`; other supported desktops use XDG autostart. The
server starts at boot and the player waits for it before opening Chromium in
kiosk mode. A graphical user session must still
be available; configure desktop autologin separately if the PC must start
without manual sign-in. The manual steps below explain the same setup when you
need to customize it.

The **Auto-start** switch in the panel toolbar is enabled by default. Turn it
off to keep the fullscreen player closed on the next desktop login; the server
and control panel remain available.

To update an existing installation, run this from the repository root. It
performs a fast-forward Git update, reinstalls dependencies, rebuilds the
application, and restarts the service:

```bash
bash scripts/install-linux-pc.sh --update
```

The update requires a clean Git checkout. If local changes prevent a
fast-forward update, Git stops without overwriting them.

## 2. Install and build Merekai Presenter

Clone the repository in a directory owned by the desktop user, then install
both dependency sets and build the application:

```bash
cd /home/<linux-user>
git clone https://github.com/<github-user>/<repository>.git merekaipresenter
cd merekaipresenter
npm install
npm --prefix control-panel install
npm run build
```

Create a media directory and copy the images and videos for the presentation
into it:

```bash
mkdir -p /home/<linux-user>/Pictures/MerekaiGallery
```

Supported formats are `jpg`, `jpeg`, `png`, `gif`, `webp`, `mp4`, and `webm`.
The media folder can be changed later from **Settings**.

## 3. Run the server with systemd

Create a service for the desktop user. Keeping `HOST` at `127.0.0.1` means the
control panel is available only on this PC:

```bash
sudo tee /etc/systemd/system/merekai-presenter.service >/dev/null <<'EOF'
[Unit]
Description=Merekai Presenter server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<linux-user>
WorkingDirectory=/home/<linux-user>/merekaipresenter
Environment=HOST=127.0.0.1
Environment=PORT=3131
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Replace `<linux-user>` in the service file, then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now merekai-presenter.service
sudo systemctl status merekai-presenter.service
```

Open `http://127.0.0.1:3131/` in a browser, select the media folder in
**Settings**, and configure the order, overlays, and playback options. The
fullscreen player is at `http://127.0.0.1:3131/player/`.

To control the presenter from another device on the same network, change
`Environment=HOST=127.0.0.1` to `Environment=HOST=0.0.0.0`, allow TCP port
3131 in the firewall, and use the PC's LAN address. Do not expose the port to
the Internet without adding authentication and network restrictions.

## 4. Open the player automatically in kiosk mode

Create a small launcher owned by the desktop user:

```bash
mkdir -p /home/<linux-user>/.local/bin
cat > /home/<linux-user>/.local/bin/merekai-player <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

until curl --fail --silent http://127.0.0.1:3131/player/ >/dev/null; do
    sleep 1
done

exec chromium \
    --kiosk \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --user-data-dir="$HOME/.config/merekaipresenter/chromium-profile" \
    http://127.0.0.1:3131/player/
EOF
chmod +x /home/<linux-user>/.local/bin/merekai-player
```

Add it to the graphical desktop's autostart:

```bash
mkdir -p /home/<linux-user>/.config/autostart
cat > /home/<linux-user>/.config/autostart/merekai-player.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Merekai Presenter Player
Exec=/home/<linux-user>/.local/bin/merekai-player
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
```

Replace `<linux-user>` in both files, then log out and back in or reboot. The
desktop must be configured to log in automatically if the PC should start the
presenter without keyboard input.

To exit kiosk mode during maintenance, press `Alt+F4`. Inspect the server with:

```bash
journalctl -u merekai-presenter.service -f
```

If the player does not open after signing in, verify the desktop entry and
read the launcher log:

```bash
cat ~/.config/autostart/merekai-player.desktop
cat ~/.local/state/merekaipresenter/player-autostart.log
systemctl --user status
systemctl status merekai-presenter.service
```

Run the installer with `--update` after changing the launcher or installing a
new version so the generated autostart files are refreshed.

For a read-only diagnostic on the Debian PC, run from the repository root:

```bash
bash scripts/diagnose-linux-autostart.sh
```

It reports the exact failing layer without changing the system. Share its
output together with the launcher log and service log when troubleshooting.

## 5. Verify and maintain the presenter

1. Confirm Chromium opens the player fullscreen after login.
2. Confirm the configured media folder is shown in **Settings**.
3. Test play, pause, next, previous, overlays, and media ordering.

For a manual update without removing media or settings, use the following only
when the installer script cannot be used:

```bash
cd /home/<linux-user>/merekaipresenter
sudo systemctl stop merekai-presenter.service
git pull
npm install
npm --prefix control-panel install
npm run build
sudo systemctl restart merekai-presenter.service
```
