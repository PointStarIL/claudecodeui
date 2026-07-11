#!/usr/bin/env bash
#
# CloudCLI (Claude Code UI) — uninstaller for the systemd install.
#
# By default this ONLY stops and removes the systemd service. Your cloned
# source, your app data (~/.cloudcli), and Node.js are left untouched.
#
# Run from a clone:   ./deploy/uninstall.sh
# Or directly:        curl -fsSL https://raw.githubusercontent.com/PointStarIL/claudecodeui/fix/rtl-chat/deploy/uninstall.sh | bash
#
# Opt-in extra cleanup (set to 1):
#   PURGE_DATA=1     also delete app data (~/.cloudcli — auth.db, settings)
#   PURGE_SOURCE=1   also delete the cloned source directory (INSTALL_DIR)
#
# Overrides:
#   SERVICE_NAME=cloudcli
#   INSTALL_DIR="$HOME/claudecodeui"
#
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-cloudcli}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/claudecodeui}"
PURGE_DATA="${PURGE_DATA:-0}"
PURGE_SOURCE="${PURGE_SOURCE:-0}"
DATA_DIR="$HOME/.cloudcli"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run as your normal user (not root). The script uses sudo only where needed."
command -v sudo >/dev/null || die "sudo is required."

UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

# 1) Stop + disable + remove the service --------------------------------------
if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}.service"; then
  log "Stopping and disabling ${SERVICE_NAME}..."
  sudo systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
else
  warn "Service ${SERVICE_NAME} not found (already removed?)."
fi

if [ -f "$UNIT" ]; then
  log "Removing $UNIT"
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
  sudo systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
fi

# 2) Optional: delete app data ------------------------------------------------
if [ "$PURGE_DATA" = "1" ]; then
  if [ -d "$DATA_DIR" ]; then
    log "Deleting app data $DATA_DIR"
    rm -rf "$DATA_DIR"
  fi
else
  [ -d "$DATA_DIR" ] && warn "Kept app data at $DATA_DIR (re-run with PURGE_DATA=1 to remove)."
fi

# 3) Optional: delete the cloned source --------------------------------------
if [ "$PURGE_SOURCE" = "1" ]; then
  case "$INSTALL_DIR" in
    "$HOME"|"/"|""|"/home"|"$HOME/") die "Refusing to delete unsafe INSTALL_DIR='$INSTALL_DIR'." ;;
  esac
  if [ -d "$INSTALL_DIR" ]; then
    warn "Deleting source directory $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
  fi
else
  [ -d "$INSTALL_DIR" ] && warn "Kept source at $INSTALL_DIR (re-run with PURGE_SOURCE=1 INSTALL_DIR=$INSTALL_DIR to remove)."
fi

echo
log "Uninstall complete."
echo "     Note: Node.js and build tools were left installed (they may be used by other apps)."
