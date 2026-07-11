#!/usr/bin/env bash
#
# CloudCLI (Claude Code UI) — self-host installer for Debian/Ubuntu + systemd.
#
# Builds this fork from source (includes the Hebrew/RTL chat fix) and runs it
# as a systemd service that auto-starts on boot.
#
# Quick start on a new machine (one command):
#   curl -fsSL https://raw.githubusercontent.com/PointStarIL/claudecodeui/fix/rtl-chat/deploy/install.sh | bash
#
# Or from an existing clone:
#   ./deploy/install.sh
#
# Override any default with an env var, e.g.:
#   PORT=4000 INSTALL_DIR=~/apps/cloudcli ./deploy/install.sh
#
#   PORT=3008                                              # web UI port
#   INSTALL_DIR="$HOME/claudecodeui"                       # where to clone/build
#   BRANCH=fix/rtl-chat                                    # branch to deploy
#   REPO_URL=https://github.com/PointStarIL/claudecodeui.git
#   SERVICE_NAME=cloudcli                                  # systemd unit name
#
set -euo pipefail

PORT="${PORT:-3008}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/claudecodeui}"
BRANCH="${BRANCH:-fix/rtl-chat}"
REPO_URL="${REPO_URL:-https://github.com/PointStarIL/claudecodeui.git}"
SERVICE_NAME="${SERVICE_NAME:-cloudcli}"
RUN_USER="$(id -un)"
RUN_HOME="$HOME"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Run as your normal user (not root). The script uses sudo only where needed."
command -v sudo >/dev/null || die "sudo is required."

# 1) System prerequisites -----------------------------------------------------
if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  log "Installing git + curl..."
  sudo apt-get update -y
  sudo apt-get install -y git curl ca-certificates
fi

if ! command -v node >/dev/null; then
  log "Installing Node.js 22 + build tools..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs build-essential
else
  log "Node $(node -v) already present."
  command -v g++ >/dev/null || { log "Installing build tools..."; sudo apt-get install -y build-essential; }
fi

# 2) Claude Code CLI check ----------------------------------------------------
CLAUDE_BIN="$RUN_HOME/.local/bin/claude"
if ! command -v claude >/dev/null && [ ! -x "$CLAUDE_BIN" ]; then
  warn "Claude Code CLI ('claude') not found."
  warn "The web UI drives the 'claude' CLI — install Claude Code and run 'claude login',"
  warn "otherwise the UI loads but sessions won't run."
fi

# 3) Get the source -----------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing checkout at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$BRANCH" || warn "Could not fast-forward; using current checkout."
else
  log "Cloning $REPO_URL ($BRANCH) -> $INSTALL_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

# 4) Build --------------------------------------------------------------------
log "Installing dependencies (npm ci)..."
( cd "$INSTALL_DIR" && npm ci )
log "Building client + server..."
( cd "$INSTALL_DIR" && npm run build )

# 5) systemd service ----------------------------------------------------------
log "Installing systemd service '$SERVICE_NAME' on port $PORT..."
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<UNIT
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
Environment=CLAUDE_CLI_PATH=$CLAUDE_BIN
ExecStart=/usr/bin/node dist-server/server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

# 6) Summary ------------------------------------------------------------------
sleep 2
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
log "Done — CloudCLI is running:"
echo "     URL:     http://${IP:-localhost}:${PORT}   (also http://localhost:${PORT})"
echo "     logs:    journalctl -u ${SERVICE_NAME} -f"
echo "     manage:  sudo systemctl restart|stop|status ${SERVICE_NAME}"
echo "     update:  cd ${INSTALL_DIR} && git pull && npm ci && npm run build && sudo systemctl restart ${SERVICE_NAME}"
