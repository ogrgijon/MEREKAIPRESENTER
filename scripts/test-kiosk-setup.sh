#!/usr/bin/env bash

set -euo pipefail

PLAYER_PORT=3131
PLAYER_URL="http://127.0.0.1:${PLAYER_PORT}/player/"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

warn() {
    printf 'WARN: %s\n' "$1" >&2
}

ok() {
    printf 'OK: %s\n' "$1"
}

echo "Running Merekai kiosk smoke tests"

[ -f /usr/local/bin/merekai-kiosk-session ] && ok "/usr/local/bin/merekai-kiosk-session exists" || warn "/usr/local/bin/merekai-kiosk-session missing"
[ -f /usr/share/xsessions/merekai-kiosk.desktop ] && ok "/usr/share/xsessions/merekai-kiosk.desktop exists" || warn "/usr/share/xsessions/merekai-kiosk.desktop missing"
[ -f /etc/lightdm/lightdm.conf.d/50-mereka-kiosk.conf ] && ok "/etc/lightdm/lightdm.conf.d/50-mereka-kiosk.conf exists" || warn "/etc/lightdm/lightdm.conf.d/50-mereka-kiosk.conf missing"

if command -v unclutter >/dev/null 2>&1; then
    ok "unclutter is installed"
else
    warn "unclutter is not installed"
fi

if systemctl --no-pager is-active --quiet merekai-presenter.service; then
    ok "merekai-presenter.service is active"
else
    warn "merekai-presenter.service is not active"
fi

echo "Checking player URL: ${PLAYER_URL}"
if curl --fail --silent --max-time 3 "${PLAYER_URL}" >/dev/null 2>&1; then
    ok "Player URL reachable"
else
    warn "Player URL not reachable"
fi

echo "Checking Chromium process (may run under a different user)"
if pgrep -a chromium >/dev/null 2>&1; then
    ok "Chromium process appears to be running"
else
    warn "Chromium process not found"
fi

echo "Finished smoke tests. Review WARN/FAIL messages above."

exit 0
