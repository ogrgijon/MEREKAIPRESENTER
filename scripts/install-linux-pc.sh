#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SERVICE_USER="${SUDO_USER:-${USER}}"
readonly SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
readonly PANEL_URL="http://127.0.0.1:3131/"
readonly PLAYER_URL="http://127.0.0.1:3131/player/"
readonly DESKTOP_ENVIRONMENT="${XDG_CURRENT_DESKTOP:-${DESKTOP_SESSION:-}}"
update_mode=false

if [[ "$SERVICE_USER" == "root" ]]; then
    printf 'Error: run this installer as the desktop user, not from a root shell.\n' >&2
    printf 'Use: bash scripts/install-linux-pc.sh\n' >&2
    exit 1
fi

case "${1:-}" in
    "")
        ;;
    --update)
        update_mode=true
        ;;
    --help|-h)
        printf 'Usage: bash scripts/install-linux-pc.sh [--update]\n'
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

fail() {
    printf 'Error: %s\n' "$1" >&2
    exit 1
}

command -v sudo >/dev/null 2>&1 || fail "sudo is required."
command -v apt-get >/dev/null 2>&1 || fail "This installer requires a Debian-based distribution."

if [[ "$update_mode" == true ]]; then
    command -v git >/dev/null 2>&1 || fail "git is required for updates."
    [[ -d "$APP_DIR/.git" ]] || fail "The application directory is not a Git checkout."
    git -C "$APP_DIR" pull --ff-only
fi

log "Installing Linux prerequisites"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    chromium \
    build-essential \
    xdg-utils

node_major=0
if command -v node >/dev/null 2>&1; then
    node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
fi

if ((node_major < 20)) || ! command -v npm >/dev/null 2>&1; then
    log "Installing Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs npm
fi

command -v node >/dev/null 2>&1 || fail "Node.js could not be installed."
command -v npm >/dev/null 2>&1 || fail "npm could not be installed."

if command -v chromium >/dev/null 2>&1; then
    readonly CHROMIUM_COMMAND="$(command -v chromium)"
elif command -v chromium-browser >/dev/null 2>&1; then
    readonly CHROMIUM_COMMAND="$(command -v chromium-browser)"
else
    fail "Chromium could not be installed."
fi

log "Installing and building Merekai Presenter"
cd "$APP_DIR"
npm install
npm --prefix control-panel install
npm run build

readonly NPM_COMMAND="$(command -v npm)"
readonly PANEL_LAUNCHER="$SERVICE_HOME/.local/bin/merekai-control-panel"
readonly PLAYER_LAUNCHER="$SERVICE_HOME/.local/bin/merekai-player"
readonly PLAYER_LOG="$SERVICE_HOME/.local/state/merekaipresenter/player-autostart.log"
readonly PLAYER_SERVICE="$SERVICE_HOME/.config/systemd/user/merekai-player.service"
readonly APPLICATION_ENTRY="$SERVICE_HOME/.local/share/applications/merekai-control-panel.desktop"
readonly APPLICATION_ICON="$SERVICE_HOME/.local/share/icons/hicolor/256x256/apps/merekai-presenter.png"
readonly DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || printf '%s/Desktop' "$SERVICE_HOME")"
readonly DESKTOP_ENTRY="$DESKTOP_DIR/Merekai Presenter Control Panel.desktop"
readonly AUTOSTART_ENTRY="$SERVICE_HOME/.config/autostart/merekai-player.desktop"

log "Installing the Merekai server service"
sudo tee /etc/systemd/system/merekai-presenter.service >/dev/null <<EOF
[Unit]
Description=Merekai Presenter server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=HOST=127.0.0.1
Environment=PORT=3131
ExecStart=$NPM_COMMAND start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

mkdir -p \
    "$(dirname "$PANEL_LAUNCHER")" \
    "$(dirname "$PLAYER_LOG")" \
    "$(dirname "$PLAYER_SERVICE")" \
    "$(dirname "$APPLICATION_ENTRY")" \
    "$(dirname "$APPLICATION_ICON")" \
    "$DESKTOP_DIR" \
    "$(dirname "$AUTOSTART_ENTRY")"
cp "$APP_DIR/iconoMerekaiGallery.png" "$APPLICATION_ICON"
cat > "$PANEL_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

until curl --fail --silent --max-time 2 "$PANEL_URL" >/dev/null; do
    sleep 1
done

exec xdg-open "$PANEL_URL"
EOF
chmod +x "$PANEL_LAUNCHER"

cat > "$PLAYER_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

readonly PROFILE_DIR="\$HOME/.config/merekaipresenter/chromium-profile"

mkdir -p "\$(dirname "$PLAYER_LOG")" "\$PROFILE_DIR"
exec >>"$PLAYER_LOG" 2>&1
printf '\n[%s] Merekai player autostart\n' "\$(date --iso-8601=seconds)"

until curl --fail --silent --max-time 2 "$PLAYER_URL" >/dev/null; do
    sleep 1
done

settings_json="\$(curl --fail --silent --show-error --max-time 2 "$PANEL_URL/api/settings")"
auto_start="\$(printf '%s' "\$settings_json" | \
    node -p 'String(JSON.parse(require("fs").readFileSync(0, "utf8")).autoStartPlayer).trim().toLowerCase()')"
if [[ "\$auto_start" == "false" ]]; then
    printf '[%s] Auto-start disabled in the control panel\n' "\$(date --iso-8601=seconds)"
    exit 0
fi

# Avoid Chromium refusing to start because a previous kiosk process owns the profile.
pkill -u "\$(id -u)" -f '[c]hromium.*127\\.0\\.0\\.1:3131/player/' \
    >/dev/null 2>&1 || true
sleep 1

printf '[%s] Starting Chromium kiosk\n' "\$(date --iso-8601=seconds)"

exec "$CHROMIUM_COMMAND" \
    --kiosk \
    --start-fullscreen \
    --noerrdialogs \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --password-store=basic \
    --user-data-dir="\$PROFILE_DIR" \
    "$PLAYER_URL"
EOF
chmod +x "$PLAYER_LAUNCHER"

if [[ "$DESKTOP_ENVIRONMENT" == *GNOME* ]]; then
    cat > "$PLAYER_SERVICE" <<EOF
[Unit]
Description=Merekai Presenter Chromium player
PartOf=graphical-session.target
After=graphical-session.target

[Service]
Type=simple
ExecStart=$PLAYER_LAUNCHER
Restart=on-failure
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF
    rm -f "$AUTOSTART_ENTRY"
else
    rm -f "$PLAYER_SERVICE"
fi

cat > "$APPLICATION_ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Merekai Presenter Control Panel
Comment=Open the Merekai Presenter control panel
Exec=$PANEL_LAUNCHER
Terminal=false
Categories=AudioVideo;
Icon=$APPLICATION_ICON
EOF

cp "$APPLICATION_ENTRY" "$DESKTOP_ENTRY"
chmod +x "$APPLICATION_ENTRY" "$DESKTOP_ENTRY"

if [[ "$DESKTOP_ENVIRONMENT" != *GNOME* ]]; then
    cat > "$AUTOSTART_ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Merekai Presenter Player
Comment=Start the Merekai Presenter player in fullscreen mode
Exec=$PLAYER_LAUNCHER
TryExec=$PLAYER_LAUNCHER
Terminal=false
Hidden=false
NoDisplay=false
StartupNotify=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5
EOF
    chmod +x "$AUTOSTART_ENTRY"
fi
touch "$PLAYER_LOG"

chown_paths=( \
    "$SERVICE_USER":"$(id -gn "$SERVICE_USER")" \
    "$PANEL_LAUNCHER" \
    "$PLAYER_LAUNCHER" \
    "$PLAYER_LOG" \
    "$APPLICATION_ENTRY" \
    "$DESKTOP_ENTRY" \
)
if [[ "$DESKTOP_ENVIRONMENT" == *GNOME* ]]; then
    chown_paths+=( "$PLAYER_SERVICE" )
else
    chown_paths+=( "$AUTOSTART_ENTRY" )
fi
sudo chown "${chown_paths[@]}"

sudo systemctl daemon-reload
if [[ "$DESKTOP_ENVIRONMENT" == *GNOME* ]]; then
    systemctl --user daemon-reload
    systemctl --user enable merekai-player.service
fi
if [[ "$update_mode" == true ]]; then
    sudo systemctl restart merekai-presenter.service
else
    sudo systemctl enable --now merekai-presenter.service
fi

printf '\nMerekai Presenter is installed.\n'
printf 'Control panel: %s\n' "$PANEL_URL"
printf 'Desktop shortcut: %s\n' "$DESKTOP_ENTRY"