#!/usr/bin/env bash
#
# CloudCLI (Claude Code UI) — all-in-one installer & manager (Debian/Ubuntu + systemd).
#
# Builds this fork from source (includes the Hebrew/RTL chat fix) and runs it as a
# systemd service. One file: install / update / status / logs / restart / uninstall.
#
# Interactive menu:
#   bash <(curl -fsSL https://raw.githubusercontent.com/PointStarIL/claudecodeui/fix/rtl-chat/deploy/manage.sh)
#
# Non-interactive (for automation) — pass a command:
#   curl -fsSL <url> | bash -s -- install      # or: update | uninstall | status | restart | stop | start
#
# Override defaults with env vars, e.g. PORT=4000, INSTALL_DIR=~/apps/cloudcli, PURGE_DATA=1
#
set -uo pipefail

PORT="${PORT:-3008}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/claudecodeui}"
BRANCH="${BRANCH:-fix/rtl-chat}"
REPO_URL="${REPO_URL:-https://github.com/PointStarIL/claudecodeui.git}"
SERVICE_NAME="${SERVICE_NAME:-cloudcli}"
PURGE_DATA="${PURGE_DATA:-0}"
PURGE_SOURCE="${PURGE_SOURCE:-0}"
RUN_USER="$(id -un)"; RUN_HOME="$HOME"
DATA_DIR="$HOME/.cloudcli"
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

c_blue=$'\033[1;34m'; c_grn=$'\033[1;32m'; c_yel=$'\033[1;33m'; c_red=$'\033[1;31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
log()  { printf '%s==>%s %s\n' "$c_blue" "$c_off" "$*"; }
warn() { printf '%s[!]%s %s\n'  "$c_yel"  "$c_off" "$*" >&2; }
die()  { printf '%s[x]%s %s\n'  "$c_red"  "$c_off" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run as your normal user (not root); the script uses sudo where needed."
command -v sudo >/dev/null || die "sudo is required."

ask() { local prompt="$1" ans; printf '%s' "$prompt" >/dev/tty; read -r ans </dev/tty; printf '%s' "$ans"; }
is_installed() { systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}.service"; }

# =============================================================================
# Core actions
# =============================================================================
do_install() {
  # 1) prerequisites
  if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
    log "Installing git + curl..."; sudo apt-get update -y; sudo apt-get install -y git curl ca-certificates
  fi
  if ! command -v node >/dev/null; then
    log "Installing Node.js 22 + build tools..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs build-essential
  else
    log "Node $(node -v) already present."
    command -v g++ >/dev/null || { log "Installing build tools..."; sudo apt-get install -y build-essential; }
  fi

  # 2) claude CLI check
  local claude_bin="$RUN_HOME/.local/bin/claude"
  if ! command -v claude >/dev/null && [ ! -x "$claude_bin" ]; then
    warn "Claude Code CLI ('claude') not found. Install it and run 'claude login' — the UI drives the 'claude' CLI."
  fi

  # 3) source
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "Updating checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --quiet origin
    git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
    git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$BRANCH" || warn "Could not fast-forward; using current checkout."
  else
    log "Cloning $REPO_URL ($BRANCH) -> $INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi

  # 4) build
  log "Installing dependencies (npm ci)..."; ( cd "$INSTALL_DIR" && npm ci )
  log "Building client + server...";          ( cd "$INSTALL_DIR" && npm run build )

  # 5) systemd service
  log "Installing systemd service '$SERVICE_NAME' on port $PORT..."
  sudo tee "$UNIT" >/dev/null <<UNITFILE
[Unit]
Description=CloudCLI (Claude Code UI)
Documentation=$REPO_URL
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=SERVER_PORT=$PORT
Environment=HOST=0.0.0.0
Environment=HOME=$RUN_HOME
Environment=PATH=$RUN_HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=CLAUDE_CLI_PATH=$claude_bin
ExecStart=/usr/bin/node dist-server/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITFILE
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME"

  sleep 2
  local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo; log "Done — CloudCLI is running:"
  echo "     URL:     http://${ip:-localhost}:${PORT}   (also http://localhost:${PORT})"
  echo "     manage:  bash <(curl -fsSL https://raw.githubusercontent.com/PointStarIL/claudecodeui/${BRANCH}/deploy/manage.sh)"
}

do_uninstall() {
  if is_installed; then
    log "Stopping and disabling ${SERVICE_NAME}..."
    sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
  else
    warn "Service ${SERVICE_NAME} not found (already removed?)."
  fi
  if [ -f "$UNIT" ]; then
    log "Removing $UNIT"; sudo rm -f "$UNIT"; sudo systemctl daemon-reload
    sudo systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
  fi

  if [ "$PURGE_DATA" = "1" ]; then
    [ -d "$DATA_DIR" ] && { log "Deleting app data $DATA_DIR"; rm -rf "$DATA_DIR"; }
  else
    [ -d "$DATA_DIR" ] && warn "Kept app data at $DATA_DIR (set PURGE_DATA=1 to remove)."
  fi

  if [ "$PURGE_SOURCE" = "1" ]; then
    case "$INSTALL_DIR" in
      "$HOME"|"$HOME/"|"/"|""|"/home") die "Refusing to delete unsafe INSTALL_DIR='$INSTALL_DIR'." ;;
    esac
    [ -d "$INSTALL_DIR" ] && { warn "Deleting source $INSTALL_DIR"; rm -rf "$INSTALL_DIR"; }
  else
    [ -d "$INSTALL_DIR" ] && warn "Kept source at $INSTALL_DIR (set PURGE_SOURCE=1 to remove)."
  fi

  echo; log "Uninstall complete. (Node.js/build tools left installed — may be used by other apps.)"
}

svc() {
  is_installed || { warn "Not installed."; return 1; }
  case "$1" in
    status)  systemctl status "$SERVICE_NAME" --no-pager ;;
    logs)    log "Following logs — Ctrl-C to stop."; journalctl -u "$SERVICE_NAME" -f ;;
    restart) sudo systemctl restart "$SERVICE_NAME" && log "restarted." ;;
    stop)    sudo systemctl stop    "$SERVICE_NAME" && log "stopped." ;;
    start)   sudo systemctl start   "$SERVICE_NAME" && log "started." ;;
  esac
}

# =============================================================================
# Non-interactive dispatch:  manage.sh <command>
# =============================================================================
if [ "$#" -gt 0 ]; then
  case "$1" in
    install|update) ( set -e; do_install ) ;;
    uninstall)      do_uninstall ;;
    status|logs|restart|stop|start) svc "$1" ;;
    *) die "Unknown command '$1'. Use: install | update | uninstall | status | logs | restart | stop | start" ;;
  esac
  exit $?
fi

# =============================================================================
# Interactive menu
# =============================================================================
[ -e /dev/tty ] || die "No terminal for interactive input. Pass a command instead, e.g. '... | bash -s -- install'."

status_line() {
  if is_installed; then
    local state ip port
    state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    port="$(systemctl show "$SERVICE_NAME" -p Environment --no-pager 2>/dev/null | tr ' ' '\n' | sed -n 's/^SERVER_PORT=//p')"; port="${port:-3008}"
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
  local port; port="$(ask "Port [${PORT}]: ")"; PORT="${port:-$PORT}"
  ( set -e; do_install ) || warn "Install did not complete cleanly."
}
action_uninstall() {
  local p; p="$(ask "Also delete app data (~/.cloudcli) and cloned source? [y/N]: ")"
  case "$p" in y|Y) PURGE_DATA=1; PURGE_SOURCE=1; warn "Full removal selected." ;; esac
  do_uninstall
}

menu() {
  cat >/dev/tty <<BANNER

${c_blue}  CloudCLI (Claude Code UI) — manager${c_off}
${c_dim}  ---------------------------------${c_off}
  status: $(status_line)

  ${c_grn}1${c_off}) Install / update       (build from source + systemd)
  ${c_grn}2${c_off}) Service status
  ${c_grn}3${c_off}) Follow logs
  ${c_grn}4${c_off}) Restart service
  ${c_grn}5${c_off}) Stop service
  ${c_grn}6${c_off}) Start service
  ${c_grn}7${c_off}) Uninstall
  ${c_grn}q${c_off}) Quit
BANNER
}

while true; do
  menu
  choice="$(ask "
Choose: ")"
  case "$choice" in
    1) action_install ;;
    2) svc status ;;
    3) svc logs ;;
    4) svc restart ;;
    5) svc stop ;;
    6) svc start ;;
    7) action_uninstall ;;
    q|Q|"") log "Bye."; exit 0 ;;
    *) warn "Unknown choice: $choice" ;;
  esac
  ask "
Press Enter to return to the menu... " >/dev/null
done
