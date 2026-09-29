#!/usr/bin/env bash

set -Eeuo pipefail

readonly DEFAULT_HOST="10.42.0.1"
readonly DEFAULT_PORT="3131"
readonly SERVER_BIND_HOST="0.0.0.0"
readonly PLAYER_HOST="127.0.0.1"
readonly DEFAULT_CONNECTION="merekai-hotspot"

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly APP_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
update_mode=false

case "${1:-}" in
    "")
        ;;
    --update)
        update_mode=true
        ;;
    --help|-h)
        printf 'Usage: bash scripts/setup-raspberry-pi.sh [--update]\n'
        printf '  --update  Pull fast-forward changes, rebuild, and restart the service.\n'
        exit 0
        ;;
    *)
        printf 'Unknown option: %s\n' "$1" >&2
        exit 2
        ;;
esac

log() {
    printf '\n==> %s\n' "$1"
}

warn() {
    printf 'Warning: %s\n' "$1" >&2
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
    command -v "$1" >/dev/null 2>&1 ||
        fail "Required command not found: $1"
}

run_audit_fix() {
    if ! npm audit fix; then
        warn "npm audit fix could not repair every vulnerability; continuing."
    fi
}

run_control_panel_audit_fix() {
    if ! npm --prefix control-panel audit fix; then
        warn "control-panel npm audit fix could not repair every vulnerability; continuing."
    fi
}

install_packages() {
    local packages=("$@")
    local missing=()
    local package

    for package in "${packages[@]}"; do
        if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null |
            grep -Fq 'install ok installed'; then
            missing+=("$package")
        fi
    done

    if ((${#missing[@]} > 0)); then
        log "Installing missing packages"
        sudo apt-get update
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
    fi
}

cleanup_previous_installation() {
    log "Stopping previous Merekai installation"

    sudo systemctl disable --now merekai-presenter.service 2>/dev/null || true
    sudo systemctl disable --now merekai-hotspot-activation.service 2>/dev/null || true

    sudo rm -f /etc/systemd/system/merekai-presenter.service
    sudo systemctl daemon-reload
    sudo systemctl reset-failed merekai-presenter.service 2>/dev/null || true

    # Remove old Merekai desktop autostart files.
    rm -f \
        "$service_home/.config/autostart/merekai-player.desktop" \
        "$service_home/.local/bin/merekai-player"

    # Remove old Merekai lines from desktop autostart files.
    remove_launcher_from_file "$service_home/.config/labwc/autostart"
    remove_launcher_from_file "$service_home/.config/lxsession/LXDE-pi/autostart"
}

remove_launcher_from_file() {
    local file="$1"

    [[ -f "$file" ]] || return 0

    sudo sed -i \
        '\|merekai-player|d' \
        "$file" 2>/dev/null || true
}

configure_hotspot() {
    [[ "$use_hotspot" == true ]] || return 0

    log "Configuring the Wi-Fi hotspot"

    if nmcli -t -f NAME connection show |
        grep -Fxq "$DEFAULT_CONNECTION"; then

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

        sudo nmcli connection add \
            type wifi \
            ifname "$wifi_device" \
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
            ipv6.method disabled \
            connection.autoconnect yes
    fi
}

install_presenter_service() {
    log "Installing/updating Merekai presenter systemd service"

    local service_file
    service_file="$(mktemp)"

    cat > "$service_file" <<EOF
[Unit]
Description=Merekai Presenter server
After=network-online.target NetworkManager-wait-online.service
Wants=network-online.target

[Service]
Type=simple
User=$service_user
Group=$(id -gn "$service_user")
WorkingDirectory=$app_dir

Environment=HOST=$SERVER_BIND_HOST
Environment=PORT=$DEFAULT_PORT

ExecStart=$(command -v npm) start

Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    sudo install \
        -o root \
        -g root \
        -m 644 \
        "$service_file" \
        /etc/systemd/system/merekai-presenter.service

    rm -f "$service_file"

    sudo systemctl daemon-reload
    sudo systemctl enable merekai-presenter.service
    sudo systemctl restart merekai-presenter.service
}

wait_for_server() {
    log "Waiting for Merekai server"

    local attempt

    for attempt in {1..60}; do
        if curl \
            --fail \
            --silent \
            --max-time 2 \
            "http://${PLAYER_HOST}:${DEFAULT_PORT}/player/" \
            >/dev/null; then

            return 0
        fi

        sleep 1
    done

    sudo systemctl --no-pager --full status merekai-presenter.service || true

    fail \
        "The presenter server did not become ready on ${PLAYER_HOST}:${DEFAULT_PORT}. Check: sudo journalctl -u merekai-presenter.service -n 100"
}

save_media_directory() {
    log "Saving the media folder in application settings"

    curl \
        --fail \
        --silent \
        --show-error \
        --max-time 5 \
        -H 'Content-Type: application/json' \
        --data "$(node -p 'JSON.stringify({ folder: process.argv[1] })' "$media_dir")" \
        "http://${PLAYER_HOST}:${DEFAULT_PORT}/api/set-media-folder" \
        >/dev/null
}

install_kiosk_session() {
    log "Installing Merekai X11 kiosk session"

    local kiosk_script_tmp
    local desktop_tmp

    kiosk_script_tmp="$(mktemp)"
    desktop_tmp="$(mktemp)"

    cat > "$kiosk_script_tmp" <<EOF
#!/usr/bin/env bash

set -Eeuo pipefail

readonly SERVER_URL="http://127.0.0.1:${DEFAULT_PORT}/player/"
readonly CHROMIUM="$chromium_command"
readonly PROFILE_DIR="$player_profile_dir"
readonly LOG_FILE="$player_log"

mkdir -p "\$(dirname "\$LOG_FILE")"
mkdir -p "\$PROFILE_DIR"

exec >>"\$LOG_FILE" 2>&1

printf '\\n[%s] Starting Merekai kiosk session\\n' "\$(date --iso-8601=seconds)"

# X11 configuration.
# The X server is also started with -nocursor by LightDM.
if command -v xset >/dev/null 2>&1; then
    xset s off || true
    xset s noblank || true
    xset -dpms || true
fi

# Wait until the Merekai server is available.
until curl \
    --fail \
    --silent \
    --max-time 2 \
    "\$SERVER_URL" \
    >/dev/null 2>&1; do

    sleep 1
done

printf '[%s] Merekai server is ready\\n' "\$(date --iso-8601=seconds)"

# Kill an old Chromium instance belonging to this user if one exists.
pkill -u "\$(id -u)" -f '[c]hromium.*127\\.0\\.0\\.1:${DEFAULT_PORT}/player/' \
    >/dev/null 2>&1 || true

sleep 1

printf '[%s] Starting Chromium kiosk\\n' "\$(date --iso-8601=seconds)"

exec "\$CHROMIUM" \
    --kiosk \
    --start-fullscreen \
    --noerrdialogs \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --disable-features=Translate \
    --password-store=basic \
    --user-data-dir="\$PROFILE_DIR" \
    --check-for-update-interval=31536000 \
    "\$SERVER_URL"
EOF

    cat > "$desktop_tmp" <<EOF
[Desktop Entry]
Name=Merekai Presenter Kiosk
Comment=Merekai Presenter Chromium kiosk session
Exec=/usr/local/bin/merekai-kiosk-session
Type=Application
EOF

    sudo install \
        -o root \
        -g root \
        -m 755 \
        "$kiosk_script_tmp" \
        /usr/local/bin/merekai-kiosk-session

    sudo install \
        -o root \
        -g root \
        -m 644 \
        "$desktop_tmp" \
        /usr/share/xsessions/merekai-kiosk.desktop

    rm -f "$kiosk_script_tmp" "$desktop_tmp"
}

configure_lightdm() {
    log "Configuring LightDM autologin and cursor hiding"

    sudo mkdir -p /etc/lightdm/lightdm.conf.d

    sudo tee /etc/lightdm/lightdm.conf.d/50-merekai-kiosk.conf >/dev/null <<EOF
[Seat:*]
autologin-user=$service_user
autologin-user-timeout=0
autologin-session=merekai-kiosk

# Disable the X11 mouse cursor completely.
xserver-command=X -s 0 -nocursor
EOF

    # Make sure LightDM is enabled for the next boot.
    sudo systemctl enable lightdm >/dev/null 2>&1 || true

    # If another display manager is currently selected, make LightDM
    # the system display manager without killing the running desktop.
    if [[ -e /etc/systemd/system/display-manager.service ]]; then
        current_display_manager="$(readlink -f /etc/systemd/system/display-manager.service || true)"

        if [[ "$current_display_manager" != "/lib/systemd/system/lightdm.service" &&
              "$current_display_manager" != "/usr/lib/systemd/system/lightdm.service" ]]; then

            warn "Another display manager is currently selected."
            warn "LightDM kiosk will be used after switching the display manager."
            warn "You may need: sudo dpkg-reconfigure lightdm"
        fi
    fi
}

configure_desktop_autologin_cleanup() {
    log "Removing duplicate desktop Chromium autostarts"

    rm -f \
        "$service_home/.config/autostart/merekai-player.desktop" \
        "$service_home/.local/bin/merekai-player"

    remove_launcher_from_file \
        "$service_home/.config/labwc/autostart"

    remove_launcher_from_file \
        "$service_home/.config/lxsession/LXDE-pi/autostart"
}

configure_display_blanking() {
    if [[ -f "$service_home/.config/wayfire.ini" ]]; then
        warn "Wayfire configuration exists."
        warn "The Merekai kiosk uses LightDM/X11, so Wayfire should not be used for the kiosk session."
    fi
}

print_access_urls() {
    log "Access URLs"

    local lan_addresses
    local lan_address

    lan_addresses="$(
        ip -4 -o addr show scope global |
            awk '{ split($4, address, "/"); print address[1] }'
    )"

    if [[ "$use_hotspot" == true ]]; then
        printf '%s\n' \
            "Hotspot control panel: http://${DEFAULT_HOST}:${DEFAULT_PORT}/"
    fi

    while IFS= read -r lan_address; do
        [[ -n "$lan_address" ]] || continue
        [[ "$lan_address" == "$DEFAULT_HOST" ]] && continue

        printf '%s\n' \
            "Local network control panel: http://${lan_address}:${DEFAULT_PORT}/"
    done <<< "$lan_addresses"
}

# ---------------------------------------------------------------------------
# Initial checks
# ---------------------------------------------------------------------------

[[ "$(id -u)" -ne 0 ]] ||
    fail "Run this wizard as the desktop user, not with sudo."

require_command sudo

command -v apt-get >/dev/null 2>&1 ||
    fail "This wizard requires Debian-based Raspberry Pi OS with apt-get."

current_user="$(id -un)"
current_home="${HOME:?HOME is not set}"

default_media_dir="${current_home}/media"

# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------

# unclutter is intentionally NOT installed.
#
# Cursor hiding is done at the X server level using:
#
#     xserver-command=X -s 0 -nocursor
#
# This is much more reliable for the dedicated X11 kiosk session.

install_packages \
    git \
    network-manager \
    curl \
    chromium \
    zenity \
    lightdm \
    xserver-xorg \
    x11-xserver-utils

require_command systemctl
require_command systemd-run
require_command nmcli
require_command curl
require_command git
require_command ip
require_command npm
require_command node

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------

if ! command -v node >/dev/null 2>&1 ||
   [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then

    log "Installing Node.js 20"

    curl \
        --fail \
        --silent \
        --show-error \
        https://deb.nodesource.com/setup_20.x |
        sudo -E bash -

    sudo apt-get install -y nodejs
fi

if ! command -v npm >/dev/null 2>&1; then
    log "Installing npm"
    sudo apt-get update
    sudo apt-get install -y npm
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"

[[ "$node_major" -ge 20 ]] ||
    fail "Node.js 20 or newer is required; found $(node --version)."

if [[ "$update_mode" == true ]]; then
    [[ -d "$APP_DIR/.git" ]] || fail "The application directory is not a Git checkout."

    log "Updating the application"
    git -C "$APP_DIR" pull --ff-only

    (
        cd "$APP_DIR"
        npm install
        run_audit_fix
        npm --prefix control-panel install
        run_control_panel_audit_fix
        npm run build
    )

    sudo systemctl restart merekai-presenter.service

    printf '\nMerekai Presenter was updated.\n'
    printf 'Check the service with: sudo systemctl status merekai-presenter.service\n'
    exit 0
fi

# ---------------------------------------------------------------------------
# Chromium
# ---------------------------------------------------------------------------

if command -v chromium >/dev/null 2>&1; then
    chromium_command="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
    chromium_command="$(command -v chromium-browser)"
else
    fail "Chromium was not found."
fi

# ---------------------------------------------------------------------------
# Wi-Fi
# ---------------------------------------------------------------------------

wifi_device="$(
    nmcli -t -f DEVICE,TYPE,STATE device |
        awk -F: '$2 == "wifi" && $3 != "unavailable" { print $1; exit }'
)"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

printf '%s\n' "Merekai Presenter Raspberry Pi setup"
printf '%s\n' "This installer configures:"
printf '%s\n' "  - Merekai server systemd service"
printf '%s\n' "  - Chromium kiosk"
printf '%s\n' "  - LightDM autologin"
printf '%s\n' "  - X11 cursor hiding"
printf '%s\n' "  - Optional private Wi-Fi hotspot"
printf '%s\n'
printf '%s\n' "The control panel has no authentication; use a private hotspot password."

use_hotspot=false

if confirm "Configure and use the private Wi-Fi hotspot?"; then

    [[ -n "$wifi_device" ]] ||
        fail "No available Wi-Fi device was found. Check: nmcli device status"

    use_hotspot=true

    read -r -p "Wi-Fi device [$wifi_device] " input
    wifi_device="${input:-$wifi_device}"

    read -r -p "Hotspot name [Merekai Presenter] " hotspot_name
    hotspot_name="${hotspot_name:-Merekai Presenter}"

    while true; do
        read -r -s -p "Hotspot password (8+ characters) " hotspot_password
        printf '\n'

        [[ "${#hotspot_password}" -ge 8 ]] ||
            warn "The hotspot password must contain at least 8 characters."

        [[ "${#hotspot_password}" -ge 8 ]] && break
    done

    read -r -s -p "Repeat hotspot password " hotspot_password_repeat
    printf '\n'

    [[ "$hotspot_password" == "$hotspot_password_repeat" ]] ||
        fail "The hotspot passwords do not match."
fi

read -r -p "Pi username [$current_user] " input
service_user="${input:-$current_user}"

id "$service_user" >/dev/null 2>&1 ||
    fail "Linux user does not exist: $service_user"

service_home="$(getent passwd "$service_user" | cut -d: -f6)"

[[ -n "$service_home" ]] ||
    fail "Could not determine the home directory for: $service_user"

read -r -p "Application directory [$APP_DIR] " input
app_dir="${input:-$APP_DIR}"

[[ -f "$app_dir/package.json" ]] ||
    fail "No package.json found in: $app_dir"

read -r -p "Media directory [$default_media_dir] " input
media_dir="${input:-$default_media_dir}"

printf '\n'
cat <<EOF
Configuration:

    Network mode:    $(
        if [[ "$use_hotspot" == true ]]; then
            printf '%s' "Private hotspot"
        else
            printf '%s' "Existing local network"
        fi
    )

    Wi-Fi device:    ${wifi_device:-not configured}
    Pi user:         $service_user
    App directory:   $app_dir
    Media directory: $media_dir

    Player URL:
        http://127.0.0.1:${DEFAULT_PORT}/player/

    Control panel:
        port ${DEFAULT_PORT}

    Display:
        LightDM + X11
        Cursor: HIDDEN AT X SERVER LEVEL
EOF

confirm "Apply this configuration?" ||
    fail "Cancelled."

# ---------------------------------------------------------------------------
# Previous installation
# ---------------------------------------------------------------------------

cleanup_previous_installation

# ---------------------------------------------------------------------------
# Media directory
# ---------------------------------------------------------------------------

log "Preparing the media directory"

sudo mkdir -p "$media_dir"

sudo chown \
    "$service_user":"$(id -gn "$service_user")" \
    "$media_dir"

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

log "Installing application dependencies and building"

(
    cd "$app_dir"

    npm install

    run_audit_fix

    npm --prefix control-panel install

    run_control_panel_audit_fix

    npm run build
)

# ---------------------------------------------------------------------------
# Hotspot
# ---------------------------------------------------------------------------

configure_hotspot

# ---------------------------------------------------------------------------
# Presenter server
# ---------------------------------------------------------------------------

install_presenter_service

wait_for_server

save_media_directory

# ---------------------------------------------------------------------------
# Chromium profile/log directories
# ---------------------------------------------------------------------------

player_log="$service_home/.local/state/merekaipresenter/player-startup.log"

player_profile_dir="$service_home/.config/merekaipresenter/chromium-profile"

sudo install \
    -d \
    -o "$service_user" \
    -g "$(id -gn "$service_user")" \
    -m 755 \
    "$(dirname "$player_log")"

sudo install \
    -d \
    -o "$service_user" \
    -g "$(id -gn "$service_user")" \
    -m 755 \
    "$player_profile_dir"

# ---------------------------------------------------------------------------
# Kiosk
# ---------------------------------------------------------------------------

install_kiosk_session

configure_lightdm

configure_desktop_autologin_cleanup

configure_display_blanking

# ---------------------------------------------------------------------------
# Hotspot activation
# ---------------------------------------------------------------------------

if [[ "$use_hotspot" == true ]]; then

    if confirm "Activate the hotspot after the installer finishes? This will disconnect the current Wi-Fi connection."; then

        log "Scheduling hotspot activation"

        sudo systemd-run \
            --unit=merekai-hotspot-activation \
            --collect \
            --no-block \
            --description="Activate the Merekai Presenter Wi-Fi hotspot" \
            "$(command -v nmcli)" \
            connection up \
            "$DEFAULT_CONNECTION"

        printf '%s\n' \
            "The hotspot will activate after this installer exits."

    else
        printf '%s\n' \
            "The hotspot was configured but not activated."

        printf '%s\n' \
            "Run: sudo nmcli connection up $DEFAULT_CONNECTION"
    fi
fi

# ---------------------------------------------------------------------------
# Final status
# ---------------------------------------------------------------------------

print_access_urls

log "Setup complete"

lan_address="$(
    hostname -I 2>/dev/null |
        awk '{print $1}'
)"

if [[ "$use_hotspot" == true ]]; then
    lan_address="$DEFAULT_HOST"
fi

printf '\n'
printf '%s\n' \
    "Control panel: http://${lan_address:-127.0.0.1}:${DEFAULT_PORT}/"

printf '%s\n' \
    "Player:        http://127.0.0.1:${DEFAULT_PORT}/player/"

printf '%s\n' \
    "Media folder:  $media_dir"

printf '\n'
printf '%s\n' \
    "Kiosk session: LightDM + X11"

printf '%s\n' \
    "Mouse cursor:  DISABLED by Xorg -nocursor"

printf '\n'
printf '%s\n' \
    "Reboot the Pi to test the complete kiosk startup:"
printf '%s\n' \
    "    sudo reboot"