# Raspberry Pi Player

This guide turns a Raspberry Pi connected to an HDMI display into a Merekai
Presenter player. The Pi runs the local server and opens the player in
Chromium kiosk mode. You can use the existing LAN, the private hotspot, or
both at the same time when the Pi has separate network connectivity (for
example Ethernet plus the Wi-Fi hotspot).

The commands below target Raspberry Pi OS Bookworm or newer with a desktop
environment. Replace `<pi-user>` with the Linux username on the Pi. Do not use
this setup on an untrusted network: the application has no authentication.

For an interactive setup, run the included wizard from the repository root:

```bash
bash scripts/setup-raspberry-pi.sh
```

The wizard installs missing Debian packages and Node.js 20+, optionally asks
for hotspot details, then builds the application, saves the media folder in
application settings, installs the server service, creates the Chromium kiosk
autostart entry, and offers to enable desktop autologin and disable display
blanking. It prints every active control-panel URL when it finishes.

The wizard is safe to run again for updates. Before rebuilding, it removes the
previous Merekai system service and kiosk launcher, then installs them again.
The repository, media folder, and application settings database are preserved.

## 1. Install the Pi prerequisites

Connect the Pi to the Internet temporarily. The wizard installs Node.js 20 or
newer, Chromium, Git, NetworkManager, and curl automatically. For a manual
installation, run:

```bash
sudo apt update
sudo apt install -y git chromium network-manager curl zenity
```

Install Node.js 20 or newer. Raspberry Pi OS may package `npm` separately, so
install both packages explicitly:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs npm
```

Confirm the versions:

```bash
node --version
npm --version
chromium --version
nmcli --version
```

The `node --version` output must be `v20` or newer before continuing. If Node.js
20 or newer is already installed, skip the NodeSource commands and only verify
that both `node` and `npm` are available.

If npm was installed while a terminal was already open, refresh its command
cache or open a new terminal before retrying:

```bash
hash -r
command -v npm
npm --version
```

## 2. Install Merekai Presenter

Clone the repository somewhere owned by the desktop user and install both
dependency sets:

```bash
cd /home/<pi-user>
git clone https://github.com/<github-user>/<repository>.git merekaipresenter
cd merekaipresenter
npm install
npm --prefix control-panel install
npm run build
```

Create a media directory and copy the images and videos that the display
should play into it:

```bash
mkdir -p /home/<pi-user>/media
```

The server creates `/home/<pi-user>/media` automatically when it starts if the
folder does not exist. The path can still be changed later in Settings.

Use supported image formats (`jpg`, `jpeg`, `png`, `gif`, `webp`) and video
formats (`mp4`, `webm`).

## 3. Create the Wi-Fi hotspot

Find the Wi-Fi device name, usually `wlan0`:

```bash
nmcli device status
```

Create a hotspot named `Merekai Presenter` with the fixed address
`10.42.0.1`:

```bash
sudo nmcli connection add type wifi ifname wlan0 con-name merekai-hotspot \
  autoconnect yes ssid "Merekai Presenter"
sudo nmcli connection modify merekai-hotspot \
  802-11-wireless.mode ap \
  802-11-wireless.band bg \
  802-11-wireless.channel 6 \
  802-11-wireless-security.key-mgmt wpa-psk \
  802-11-wireless-security.psk "change-this-password" \
  ipv4.method shared \
  ipv4.addresses 10.42.0.1/24 \
  ipv6.method disabled
sudo nmcli connection up merekai-hotspot
```

Use a strong replacement for `change-this-password`. Check the address and
connection state:

```bash
ip -4 address show wlan0
nmcli connection show --active
```

If the wireless device is not `wlan0`, substitute the name reported by
`nmcli device status`.

## 4. Run the server as a system service

Create a systemd service. Binding to `10.42.0.1` makes the control panel
available through the hotspot while avoiding exposure on other interfaces.

```bash
sudo tee /etc/systemd/system/merekai-presenter.service >/dev/null <<'EOF'
[Unit]
Description=Merekai Presenter server
After=network-online.target NetworkManager-wait-online.service
Wants=network-online.target

[Service]
Type=simple
User=<pi-user>
WorkingDirectory=/home/<pi-user>/merekaipresenter
Environment=HOST=0.0.0.0
Environment=PORT=3131
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/<pi-user>/.Xauthority
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Replace `<pi-user>` in the service file, then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now merekai-presenter.service
sudo systemctl status merekai-presenter.service
```

The server log should show:

```text
Control panel: http://10.42.0.1:3131/
Player:        http://127.0.0.1:3131/player/
```

From a device connected to the hotspot, open
`http://10.42.0.1:3131/`. On the Pi itself, open the same address once to
choose `/home/<pi-user>/media` in the Settings screen and configure the order,
overlays, and playback options.

The Browse button in the remote control panel opens a filesystem browser in
the client browser. It shows the Pi user's home directory and available
mounted locations such as removable drives under `/media`, `/run/media`, or
`/mnt`. Selecting a folder fills the setting with the Raspberry Pi filesystem
path; the remote computer does not need to have that path locally.

To copy media from another computer without using SSH, open the `Upload`
tab in the remote control panel. Choose one or more supported files and select
`Upload to Pi`. Files are uploaded to the configured media folder. Supported
formats are `jpg`, `jpeg`, `png`, `gif`, `webp`, `mp4`, and `webm`.

## 5. Start the player fullscreen

After the desktop session starts, configure Chromium to open the player in
kiosk mode. Create an autostart entry for the desktop user:

```bash
mkdir -p /home/<pi-user>/.config/autostart
cat > /home/<pi-user>/.config/autostart/merekai-player.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Merekai Presenter Player
Exec=/home/<pi-user>/.local/bin/merekai-player
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
```

Log out and back in, or reboot the Pi. The display should open the player
fullscreen after Chromium starts. The control panel is available at the URLs
printed by the setup wizard. The hotspot URL is
`http://10.42.0.1:3131/`; the local-network URL uses the Pi's Ethernet or
router-assigned Wi-Fi address.

To exit kiosk mode during maintenance, press `Alt+F4` or switch to a virtual
terminal with `Ctrl+Alt+F3`. To inspect the server:

```bash
journalctl -u merekai-presenter.service -f
```

## 6. Verify the complete setup

1. Connect a laptop or phone to the Pi's local network, or to the
  `Merekai Presenter` Wi-Fi network when the hotspot is enabled.
2. Open one of the printed control-panel URLs and confirm the panel loads.
3. Confirm the Pi display shows the local player fullscreen. The kiosk launcher waits for `http://127.0.0.1:3131/player/` and does not depend on a remote client opening the control panel.
4. Confirm that the configured media folder is shown in Settings. The wizard
  saves it automatically; the manual setup requires selecting it there.
5. Add media and confirm play, pause, next, overlays, and ordering from the
   remote control panel.

## Maintenance

### Update to the latest version

Connect to the Pi over SSH, or open a terminal on the Pi. The update does not
remove the media folder or application settings. Stop the service before
updating so the old server is not using files while they are rebuilt:

```bash
cd /home/<pi-user>/merekaipresenter
sudo systemctl stop merekai-presenter.service
git pull
npm install
npm --prefix control-panel install
npm run build
sudo systemctl restart merekai-presenter.service
```

The `git pull` command updates to the latest version on the current branch. To
update to a specific release, list the available tags and check out the
desired tag instead:

```bash
cd /home/<pi-user>/merekaipresenter
git fetch --tags
git tag --sort=-version:refname | head
git checkout v1.2.3
npm install
npm --prefix control-panel install
npm run build
sudo systemctl restart merekai-presenter.service
```

Verify that the new version is running:

```bash
sudo systemctl status merekai-presenter.service --no-pager
journalctl -u merekai-presenter.service -n 50 --no-pager
```

If the build fails, do not restart the service with the incomplete build. Fix
the reported error, run `npm run build` again, and then start the previous
service with `sudo systemctl start merekai-presenter.service`.

The application database is stored outside the repository under
`~/.local/share/merekaipresenter/settings.db`. Back it up if the playback
configuration is important.

## Security notes

The control API has no login or authentication. Keep the hotspot password
private, bind the server to the hotspot address, and do not bridge the hotspot
to an untrusted network. Do not expose port `3131` to the public Internet.