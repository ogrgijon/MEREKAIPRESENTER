# Raspberry Pi Player

This guide turns a Raspberry Pi connected to an HDMI display into a Merekai
Presenter player. The Pi creates its own Wi-Fi hotspot, runs the local server,
and opens the player in Chromium kiosk mode. A laptop, tablet, or phone
connected to the hotspot opens the control panel.

The commands below target Raspberry Pi OS Bookworm or newer with a desktop
environment. Replace `<pi-user>` with the Linux username on the Pi. Do not use
this setup on an untrusted network: the application has no authentication.

For an interactive setup, run the included wizard from the repository root:

```bash
bash scripts/setup-raspberry-pi.sh
```

The wizard installs missing Debian packages and Node.js 20+, asks for the
hotspot details and Pi paths, then configures the hotspot, builds the
application, saves the media folder in application settings, installs the
server service, creates the Chromium kiosk autostart entry, and offers to
enable desktop autologin and disable display blanking. The manual steps below
explain what it changes and are useful when adapting the setup.

## 1. Install the Pi prerequisites

Connect the Pi to the Internet temporarily. The wizard installs Node.js 20 or
newer, Chromium, Git, NetworkManager, and curl automatically. For a manual
installation, run:

```bash
sudo apt update
sudo apt install -y git chromium network-manager curl
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
Environment=HOST=10.42.0.1
Environment=PORT=3131
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
Player:        http://10.42.0.1:3131/player/
```

From a device connected to the hotspot, open
`http://10.42.0.1:3131/`. On the Pi itself, open the same address once to
choose `/home/<pi-user>/media` in the Settings screen and configure the order,
overlays, and playback options.

## 5. Start the player fullscreen

After the desktop session starts, configure Chromium to open the player in
kiosk mode. Create an autostart entry for the desktop user:

```bash
mkdir -p /home/<pi-user>/.config/autostart
cat > /home/<pi-user>/.config/autostart/merekai-player.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Merekai Presenter Player
Exec=chromium --kiosk --noerrdialogs --disable-session-crashed-bubble --check-for-update-interval=31536000 http://127.0.0.1:3131/player/
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
```

Log out and back in, or reboot the Pi. The display should open the player
fullscreen after Chromium starts. The control panel remains available from any
hotspot client at `http://10.42.0.1:3131/`.

To exit kiosk mode during maintenance, press `Alt+F4` or switch to a virtual
terminal with `Ctrl+Alt+F3`. To inspect the server:

```bash
journalctl -u merekai-presenter.service -f
```

## 6. Verify the complete setup

1. Connect a laptop or phone to the `Merekai Presenter` Wi-Fi network.
2. Open `http://10.42.0.1:3131/` and confirm the control panel loads.
3. Confirm the Pi display shows `http://127.0.0.1:3131/player/` fullscreen.
4. Confirm that the configured media folder is shown in Settings. The wizard
  saves it automatically; the manual setup requires selecting it there.
5. Add media and confirm play, pause, next, overlays, and ordering from the
   remote control panel.

## Maintenance

Update the application from the Pi with the player stopped or while the
display is running:

```bash
cd /home/<pi-user>/merekaipresenter
git pull
npm install
npm --prefix control-panel install
npm run build
sudo systemctl restart merekai-presenter.service
```

The application database is stored outside the repository under
`~/.local/share/merekaipresenter/settings.db`. Back it up if the playback
configuration is important.

## Security notes

The control API has no login or authentication. Keep the hotspot password
private, bind the server to the hotspot address, and do not bridge the hotspot
to an untrusted network. Do not expose port `3131` to the public Internet.