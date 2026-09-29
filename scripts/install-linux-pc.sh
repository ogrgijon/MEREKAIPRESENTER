#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SERVICE_USER="${SUDO_USER:-${USER}}"
readonly SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
readonly PANEL_URL="http://127.0.0.1:3131/"
update_mode=false

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

log "Installing and building Merekai Presenter"
cd "$APP_DIR"
npm install
npm --prefix control-panel install
npm run build

readonly NPM_COMMAND="$(command -v npm)"
readonly PANEL_LAUNCHER="$SERVICE_HOME/.local/bin/merekai-control-panel"
readonly APPLICATION_ENTRY="$SERVICE_HOME/.local/share/applications/merekai-control-panel.desktop"
readonly DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || printf '%s/Desktop' "$SERVICE_HOME")"
readonly DESKTOP_ENTRY="$DESKTOP_DIR/Merekai Presenter Control Panel.desktop"

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

mkdir -p "$(dirname "$PANEL_LAUNCHER")" "$(dirname "$APPLICATION_ENTRY")" "$DESKTOP_DIR"
cat > "$PANEL_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

until curl --fail --silent --max-time 2 "$PANEL_URL" >/dev/null; do
    sleep 1
done

exec xdg-open "$PANEL_URL"
EOF
chmod +x "$PANEL_LAUNCHER"

cat > "$APPLICATION_ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Merekai Presenter Control Panel
Comment=Open the Merekai Presenter control panel
Exec=$PANEL_LAUNCHER
Terminal=false
Categories=AudioVideo;
EOF

cp "$APPLICATION_ENTRY" "$DESKTOP_ENTRY"
chmod +x "$APPLICATION_ENTRY" "$DESKTOP_ENTRY"

sudo systemctl daemon-reload
if [[ "$update_mode" == true ]]; then
    sudo systemctl restart merekai-presenter.service
else
    sudo systemctl enable --now merekai-presenter.service
fi

printf '\nMerekai Presenter is installed.\n'
printf 'Control panel: %s\n' "$PANEL_URL"
printf 'Desktop shortcut: %s\n' "$DESKTOP_ENTRY"