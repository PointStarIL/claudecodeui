#!/usr/bin/env bash
#
# CloudCLI (Claude Code UI) — interactive manager.
#
# One entry point for install / update / status / logs / restart / uninstall.
# Run it and pick from a menu.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/PointStarIL/claudecodeui/fix/rtl-chat/deploy/manage.sh)
#   # or, from a clone:
#   ./deploy/manage.sh
#
set -uo pipefail

BRANCH="${BRANCH:-fix/rtl-chat}"
SERVICE_NAME="${SERVICE_NAME:-cloudcli}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/claudecodeui}"
RAW_BASE="https://raw.githubusercontent.com/PointStarIL/claudecodeui/${BRANCH}/deploy"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd 2>/dev/null || true)"

c_blue=$'\033[1;34m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }
warn() { printf '%s[!]%s %s\n'  "$c_yel"  "$c_off" "$*" >&2; }
die()  { printf '%s[x]%s %s\n'  "$c_red"  "$c_off" "$*" >&2; exit 1; }

# Interactive input must come from the terminal, even when piped via curl|bash.
[ -e /dev/tty ] || die "No terminal available for interactive input. Use install.sh / uninstall.sh directly instead."
ask() { local prompt="$1" ans; printf '%s' "$prompt" >/dev/tty; read -r ans </dev/tty; printf '%s' "$ans"; }

# Run a sibling script if present, else fetch it from GitHub. Env vars are inherited.
run_script() {
  local name="$1"
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$name" ]; then
    bash "$SCRIPT_DIR/$name"
  else
    command -v curl >/dev/null || die "curl is required to fetch $name."
    bash <(curl -fsSL "$RAW_BASE/$name")
  fi
}

is_installed() { systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}.service"; }

status_line() {
  if is_installed; then
    local state; state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
    local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    local port; port="$(systemctl show "$SERVICE_NAME" -p Environment --no-pager 2>/dev/null | tr ' ' '\n' | sed -n 's/^SERVER_PORT=//p')"
    port="${port:-3008}"
    if [ "$state" = "active" ]; then
      printf '%sinstalled%s · %srunning%s · http://%s:%s\n' "$c_grn" "$c_off" "$c_grn" "$c_off" "${ip:-localhost}" "$port"
    else
      printf '%sinstalled%s · %s%s%s\n' "$c_grn" "$c_off" "$c_yel" "${state:-stopped}" "$c_off"
    fi
  else
    printf '%snot installed%s\n' "$c_dim" "$c_off"
  fi
}

action_install() {
  local port; port="$(ask "Port [3008]: ")"; port="${port:-3008}"
  log "Installing/updating on port $port ..."
  PORT="$port" INSTALL_DIR="$INSTALL_DIR" SERVICE_NAME="$SERVICE_NAME" BRANCH="$BRANCH" run_script install.sh
}

action_update() {
  is_installed || { warn "Not installed yet — use option 1 first."; return; }
  log "Updating (git pull + rebuild + restart) ..."
  # install.sh is idempotent: it pulls, rebuilds, and restarts the service.
  INSTALL_DIR="$INSTALL_DIR" SERVICE_NAME="$SERVICE_NAME" BRANCH="$BRANCH" run_script install.sh
}

action_uninstall() {
  local purge; purge="$(ask "Also delete app data (~/.cloudcli) and cloned source? [y/N]: ")"
  if [ "$purge" = "y" ] || [ "$purge" = "Y" ]; then
    warn "Full removal: service + data + source."
    PURGE_DATA=1 PURGE_SOURCE=1 INSTALL_DIR="$INSTALL_DIR" SERVICE_NAME="$SERVICE_NAME" run_script uninstall.sh
  else
    INSTALL_DIR="$INSTALL_DIR" SERVICE_NAME="$SERVICE_NAME" run_script uninstall.sh
  fi
}

svc() { # run a systemctl verb, sudo where needed
  is_installed || { warn "Not installed."; return; }
  case "$1" in
    status)  systemctl status "$SERVICE_NAME" --no-pager ;;
    logs)    log "Following logs — Ctrl-C to stop."; journalctl -u "$SERVICE_NAME" -f ;;
    restart) sudo systemctl restart "$SERVICE_NAME" && log "restarted." ;;
    stop)    sudo systemctl stop "$SERVICE_NAME" && log "stopped." ;;
    start)   sudo systemctl start "$SERVICE_NAME" && log "started." ;;
  esac
}

menu() {
  cat >/dev/tty <<BANNER

${c_blue}  CloudCLI (Claude Code UI) — manager${c_off}
${c_dim}  ---------------------------------${c_off}
  status: $(status_line)

  ${c_grn}1${c_off}) Install / update       (build from source + systemd)
  ${c_grn}2${c_off}) Update to latest        (git pull + rebuild + restart)
  ${c_grn}3${c_off}) Service status
  ${c_grn}4${c_off}) Follow logs
  ${c_grn}5${c_off}) Restart service
  ${c_grn}6${c_off}) Stop service
  ${c_grn}7${c_off}) Start service
  ${c_grn}8${c_off}) Uninstall
  ${c_grn}q${c_off}) Quit
BANNER
}

# --- main loop ---------------------------------------------------------------
[ "$(id -u)" -eq 0 ] && die "Run as your normal user (not root); the scripts use sudo where needed."

while true; do
  menu
  choice="$(ask "
Choose: ")"
  case "$choice" in
    1) action_install ;;
    2) action_update ;;
    3) svc status ;;
    4) svc logs ;;
    5) svc restart ;;
    6) svc stop ;;
    7) svc start ;;
    8) action_uninstall ;;
    q|Q|"") log "Bye."; exit 0 ;;
    *) warn "Unknown choice: $choice" ;;
  esac
  ask "
Press Enter to return to the menu... " >/dev/null
done
