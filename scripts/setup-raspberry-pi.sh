#!/usr/bin/env bash

set -Eeuo pipefail

readonly DEFAULT_HOST="10.42.0.1"
readonly DEFAULT_PORT="3131"
readonly SERVER_BIND_HOST="0.0.0.0"
readonly PLAYER_HOST="127.0.0.1"
readonly DEFAULT_CONNECTION="merekai-hotspot"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

log() {
    printf '\n==> %s\n' "$1"
}

run_audit_fix() {
    if ! npm audit fix; then
        printf '%s\n' "Warning: npm audit fix could not repair every vulnerability; continuing with the installed dependencies." >&2
    fi
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

confirm() {
    local answer
    read -r -p "$1 [y/N] " answer
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

[[ "$(id -u)" -ne 0 ]] || fail "Run this wizard as the desktop user, not with sudo. It uses sudo when needed."

require_command sudo

command -v apt-get >/dev/null 2>&1 || fail "This wizard requires a Debian-based Raspberry Pi OS with apt-get."

apt_packages=()
for package in git network-manager curl chromium zenity; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -Fq 'install ok installed'; then
        apt_packages+=("$package")
    fi
done

if ((${#apt_packages[@]} > 0)); then
    log "Installing Raspberry Pi prerequisites"
    sudo apt-get update
    sudo apt-get install -y "${apt_packages[@]}"
fi

require_command systemctl
require_command nmcli
require_command curl
require_command git

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
    log "Installing Node.js 20"
    curl --fail --silent --show-error https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v npm >/dev/null 2>&1; then
    log "Installing npm"
    sudo apt-get update
    sudo apt-get install -y npm
fi

require_command npm
require_command node

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 20 ]] || fail "Node.js 20 or newer is required; found $(node --version)."

if command -v chromium >/dev/null 2>&1; then
    chromium_command="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
    chromium_command="$(command -v chromium-browser)"
else
    fail "Chromium was not found. Install it with: sudo apt install chromium"
fi

wifi_device="$(nmcli -t -f DEVICE,TYPE,STATE device | awk -F: '$2 == "wifi" && $3 != "unavailable" { print $1; exit }')"
[[ -n "$wifi_device" ]] || fail "No available Wi-Fi device was found. Check nmcli device status."

current_user="$(id -un)"
current_home="${HOME:?HOME is not set}"
default_media_dir="${current_home}/media"

printf '%s\n' "Merekai Presenter Raspberry Pi setup"
printf '%s\n' "This wizard changes apt packages, NetworkManager, systemd, and Chromium autostart."
printf '%s\n' "The control panel has no authentication; use a private hotspot password."

read -r -p "Wi-Fi device [$wifi_device] " input
wifi_device="${input:-$wifi_device}"
read -r -p "Hotspot name [Merekai Presenter] " hotspot_name
hotspot_name="${hotspot_name:-Merekai Presenter}"
read -r -s -p "Hotspot password (8+ characters) " hotspot_password
printf '\n'
[[ "${#hotspot_password}" -ge 8 ]] || fail "The hotspot password must contain at least 8 characters."
read -r -s -p "Repeat hotspot password " hotspot_password_repeat
printf '\n'
[[ "$hotspot_password" == "$hotspot_password_repeat" ]] || fail "The hotspot passwords do not match."
read -r -p "Pi username [$current_user] " input
service_user="${input:-$current_user}"
id "$service_user" >/dev/null 2>&1 || fail "Linux user does not exist: $service_user"
service_home="$(getent passwd "$service_user" | cut -d: -f6)"
[[ -n "$service_home" ]] || fail "Could not determine the home directory for: $service_user"
read -r -p "Application directory [$APP_DIR] " input
app_dir="${input:-$APP_DIR}"
[[ -f "$app_dir/package.json" ]] || fail "No package.json found in: $app_dir"
read -r -p "Media directory [$default_media_dir] " input
media_dir="${input:-$default_media_dir}"

cat <<EOF

Configuration:
  Wi-Fi device:   $wifi_device
  Hotspot name:   $hotspot_name
  Hotspot address: $DEFAULT_HOST
  Pi user:        $service_user
  App directory:  $app_dir
  Media directory: $media_dir
  Player URL:     http://127.0.0.1:${DEFAULT_PORT}/player/
  Control panel:  http://${DEFAULT_HOST}:${DEFAULT_PORT}/
EOF

confirm "Apply this configuration?" || fail "Cancelled."

log "Preparing the media directory"
mkdir -p "$media_dir"
sudo chown "$service_user":"$(id -gn "$service_user")" "$media_dir"

log "Installing application dependencies and building"
(
    cd "$app_dir"
    npm install
    run_audit_fix
    npm --prefix control-panel install
    if ! npm --prefix control-panel audit fix; then
        printf '%s\n' "Warning: control-panel npm audit fix could not repair every vulnerability; continuing with the installed dependencies." >&2
    fi
    npm run build
)

log "Configuring the Wi-Fi hotspot"
if nmcli -t -f NAME connection show | grep -Fxq "$DEFAULT_CONNECTION"; then
    sudo nmcli connection modify "$DEFAULT_CONNECTION" \
        connection.interface-name "$wifi_device" \
        802-11-wireless.ssid "$hotspot_name" \
        802-11-wireless.mode ap \
        802-11-wireless.band bg \
        802-11-wireless.channel 6 \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.psk "$hotspot_password" \
        ipv4.method shared \
        ipv4.addresses "${DEFAULT_HOST}/24" \
        ipv6.method disabled \
        connection.autoconnect yes
else
    sudo nmcli connection add type wifi ifname "$wifi_device" \
        con-name "$DEFAULT_CONNECTION" \
        autoconnect yes \
        ssid "$hotspot_name"
    sudo nmcli connection modify "$DEFAULT_CONNECTION" \
        802-11-wireless.mode ap \
        802-11-wireless.band bg \
        802-11-wireless.channel 6 \
        802-11-wireless-security.key-mgmt wpa-psk \
        802-11-wireless-security.psk "$hotspot_password" \
        ipv4.method shared \
        ipv4.addresses "${DEFAULT_HOST}/24" \
        ipv6.method disabled
fi

confirm "Activate the hotspot now? This may disconnect the current Wi-Fi connection." || fail "The hotspot must be activated before the server can start."
sudo nmcli connection up "$DEFAULT_CONNECTION"

log "Installing the systemd service"
service_file="$(mktemp)"
trap 'rm -f "$service_file"' EXIT
cat > "$service_file" <<EOF
[Unit]
Description=Merekai Presenter server
After=network-online.target NetworkManager-wait-online.service
Wants=network-online.target

[Service]
Type=simple
User=$service_user
WorkingDirectory=$app_dir
Environment=HOST=$SERVER_BIND_HOST
Environment=PORT=$DEFAULT_PORT
Environment=DISPLAY=:0
Environment=XAUTHORITY=$service_home/.Xauthority
ExecStart=$(command -v npm) start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo install -o root -g root -m 644 "$service_file" /etc/systemd/system/merekai-presenter.service
sudo systemctl daemon-reload
sudo systemctl enable --now merekai-presenter.service

log "Saving the media folder in application settings"
curl --fail --silent --show-error --retry 10 --retry-delay 1 \
    --max-time 5 \
    -H 'Content-Type: application/json' \
    --data "$(node -p 'JSON.stringify({ folder: process.argv[1] })' "$media_dir")" \
    "http://${DEFAULT_HOST}:${DEFAULT_PORT}/api/set-media-folder" >/dev/null

log "Configuring Chromium kiosk autostart"
autostart_dir="$service_home/.config/autostart"
autostart_file="$autostart_dir/merekai-player.desktop"
player_bin_dir="$service_home/.local/bin"
player_launcher="$player_bin_dir/merekai-player"
autostart_tmp="$(mktemp)"
player_launcher_tmp="$(mktemp)"
trap 'rm -f "$service_file" "$autostart_tmp" "$player_launcher_tmp"' EXIT
cat > "$player_launcher_tmp" <<EOF
#!/usr/bin/env bash
set -eu
until curl --fail --silent "http://${PLAYER_HOST}:${DEFAULT_PORT}/player/" >/dev/null; do
    sleep 1
done
exec "$chromium_command" --kiosk --noerrdialogs --disable-session-crashed-bubble --check-for-update-interval=31536000 "http://${PLAYER_HOST}:${DEFAULT_PORT}/player/"
EOF
sudo install -d -o "$service_user" -g "$(id -gn "$service_user")" -m 755 "$player_bin_dir"
sudo install -o "$service_user" -g "$(id -gn "$service_user")" -m 755 "$player_launcher_tmp" "$player_launcher"
cat > "$autostart_tmp" <<EOF
[Desktop Entry]
Type=Application
Name=Merekai Presenter Player
Exec=$player_launcher
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
sudo install -d -o "$service_user" -g "$(id -gn "$service_user")" -m 755 "$autostart_dir"
sudo install -o "$service_user" -g "$(id -gn "$service_user")" -m 644 "$autostart_tmp" "$autostart_file"

log "Configuring display session"
if command -v raspi-config >/dev/null 2>&1; then
    if confirm "Enable Raspberry Pi desktop autologin?"; then
        sudo raspi-config nonint do_boot_behaviour B4 ||
            printf '%s\n' "Warning: Raspberry Pi desktop autologin could not be configured automatically."
    fi
else
    printf '%s\n' "raspi-config not found; configure desktop autologin manually if needed."
fi

session_config_dir="$service_home/.config"
session_config_file="$session_config_dir/wayfire.ini"
if [[ -d "$session_config_dir" && -f "$session_config_file" ]]; then
    if confirm "Disable display blanking in the Wayfire session?"; then
        if ! grep -Fq '[idle]' "$session_config_file"; then
            cat > "$autostart_tmp" <<'EOF'

[idle]
dpms_timeout = -1
screensaver_timeout = -1
idle_timeout = -1
EOF
            sudo tee -a "$session_config_file" < "$autostart_tmp" >/dev/null
            sudo chown "$service_user":"$(id -gn "$service_user")" "$session_config_file"
        fi
    fi
fi

log "Setup complete"
printf '%s\n' "Control panel: http://${DEFAULT_HOST}:${DEFAULT_PORT}/"
printf '%s\n' "Player:        http://${DEFAULT_HOST}:${DEFAULT_PORT}/player/"
printf '%s\n' "Media folder:  $media_dir"
printf '%s\n' "Reboot the Pi to test Chromium kiosk autostart."