#!/usr/bin/env bash

set -u

readonly APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SERVICE_USER="${SUDO_USER:-${USER}}"
readonly SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
readonly PANEL_URL="http://127.0.0.1:3131/"
readonly PLAYER_URL="http://127.0.0.1:3131/player/"
readonly PLAYER_LAUNCHER="$SERVICE_HOME/.local/bin/merekai-player"
readonly AUTOSTART_ENTRY="$SERVICE_HOME/.config/autostart/merekai-player.desktop"
readonly PLAYER_LOG="$SERVICE_HOME/.local/state/merekaipresenter/player-autostart.log"

passed=0
warnings=0

ok() {
    printf 'OK   %s\n' "$1"
    passed=$((passed + 1))
}

warn() {
    printf 'WARN %s\n' "$1"
    warnings=$((warnings + 1))
}

check_file() {
    local path="$1"
    local label="$2"

    if [[ -f "$path" ]]; then
        ok "$label: $path"
    else
        warn "$label missing: $path"
    fi
}

printf 'Merekai Presenter Debian autostart diagnostic\n'
printf 'Repository: %s\n' "$APP_DIR"
printf 'Desktop user: %s\n\n' "$SERVICE_USER"

if [[ -f "$APP_DIR/package.json" ]]; then
    ok "Application directory found"
else
    warn "package.json not found in $APP_DIR"
fi

check_file "$PLAYER_LAUNCHER" "Player launcher"
check_file "$AUTOSTART_ENTRY" "Desktop autostart entry"
check_file "$PLAYER_LOG" "Player log"

if [[ -x "$PLAYER_LAUNCHER" ]]; then
    ok "Player launcher is executable"
elif [[ -f "$PLAYER_LAUNCHER" ]]; then
    warn "Player launcher is not executable"
fi

if [[ -f "$PLAYER_LAUNCHER" ]] && bash -n "$PLAYER_LAUNCHER"; then
    ok "Player launcher has valid Bash syntax"
fi

if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet merekai-presenter.service; then
        ok "merekai-presenter.service is active"
    else
        warn "merekai-presenter.service is not active"
        systemctl --no-pager --full status merekai-presenter.service 2>&1 | tail -n 12
    fi

    if systemctl is-enabled --quiet merekai-presenter.service; then
        ok "merekai-presenter.service is enabled"
    else
        warn "merekai-presenter.service is not enabled"
    fi
fi

if curl --fail --silent --max-time 3 "$PANEL_URL" >/dev/null; then
    ok "Control panel responds at $PANEL_URL"
else
    warn "Control panel does not respond at $PANEL_URL"
fi

if curl --fail --silent --max-time 3 "$PLAYER_URL" >/dev/null; then
    ok "Player responds at $PLAYER_URL"
else
    warn "Player does not respond at $PLAYER_URL"
fi

settings_json="$(curl --fail --silent --max-time 3 "$PANEL_URL/api/settings" 2>/dev/null || true)"
if [[ -n "$settings_json" ]] && command -v node >/dev/null 2>&1; then
    auto_start="$(printf '%s' "$settings_json" | node -p 'String(JSON.parse(require("fs").readFileSync(0, "utf8")).autoStartPlayer).trim().toLowerCase()')"
    if [[ "$auto_start" != "false" ]]; then
        ok "Auto-start preference is enabled"
    else
        warn "Auto-start preference is disabled: $auto_start"
    fi
else
    warn "Could not read auto-start preference from the panel"
fi

if command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
    ok "Chromium command is available"
else
    warn "Chromium command is not available"
fi

if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    ok "A graphical session is available"
else
    warn "No DISPLAY or WAYLAND_DISPLAY is present in this shell"
fi

printf '\nSummary: %d checks passed, %d warnings\n' "$passed" "$warnings"
printf '\nUseful logs:\n'
printf '  launcher: %s\n' "$PLAYER_LOG"
printf '  service:  journalctl -u merekai-presenter.service -n 80 --no-pager\n'
printf '  desktop:  %s\n' "$AUTOSTART_ENTRY"