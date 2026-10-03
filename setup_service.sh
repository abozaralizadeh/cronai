#!/usr/bin/env bash
# =============================================================================
# CronAI - one-shot VM setup / update script (idempotent)
#
#   First run : installs Node.js, project deps, builds the web demo, runs the
#               test-suite and installs + starts the `cronai` systemd service.
#   Re-run    : pulls nothing (no git), re-installs deps if package.json changed,
#               rebuilds, re-tests and restarts the service.
#
#   Logs      : journalctl -u cronai -f
#               plus a size-capped file log: <project>/logs/cronai.log (1 MB x 3)
#
#   Options (env vars):
#     PORT=8080            HTTP port for the demo + /api/parse
#     SERVICE_NAME=cronai  systemd unit name
#     SKIP_TESTS=1         skip the engine test-suite
#     RETRAIN=1            retrain the tiny model (needs python3 + numpy)
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-cronai}"
PORT="${PORT:-8080}"
RUN_USER="${SUDO_USER:-$(id -un)}"
LOG_DIR="$PROJECT_DIR/logs"
NODE_MAJOR=22

say() { printf '\n\033[1;35m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

cd "$PROJECT_DIR"

# --------------------------------------------------------------------- Node.js
need_node=1
if command -v node >/dev/null 2>&1; then
  current="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
  if [ "$current" -ge 20 ]; then need_node=0; fi
fi
if [ "$need_node" -eq 1 ]; then
  say "Installing Node.js ${NODE_MAJOR}.x"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update -y
    $SUDO apt-get install -y ca-certificates curl gnupg
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    $SUDO dnf install -y nodejs
  else
    echo "Unsupported distro: please install Node.js >= 20 manually." >&2
    exit 1
  fi
fi
echo "node $(node -v), npm $(npm -v)"

# --------------------------------------------------------------------- deps
say "Installing npm dependencies"
STAMP="node_modules/.cronai-deps-stamp"
HASH="$(sha256sum package.json | cut -d' ' -f1)"
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$HASH" ]; then
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund; else npm install --no-audit --no-fund; fi
  echo "$HASH" > "$STAMP"
else
  echo "dependencies up to date"
fi

# --------------------------------------------------------------------- model (optional)
if [ "${RETRAIN:-0}" = "1" ]; then
  say "Retraining the tiny on-device model"
  if ! python3 -c "import numpy" 2>/dev/null; then
    $SUDO apt-get install -y python3-numpy 2>/dev/null || pip3 install --user numpy
  fi
  python3 training/train_model.py
fi

# --------------------------------------------------------------------- verify + build
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  say "Running engine tests"
  npm test --silent
fi

say "Building web demo + embeddable widget"
npm run build:demo --silent
npm run build:widget --silent

# --------------------------------------------------------------------- systemd
mkdir -p "$LOG_DIR"
if [ "$(id -u)" -ne 0 ]; then $SUDO chown -R "$RUN_USER" "$LOG_DIR" 2>/dev/null || true; fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  say "Installing systemd service: ${SERVICE_NAME}"
  UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
  TMP="$(mktemp)"
  cat > "$TMP" <<EOF
[Unit]
Description=CronAI - natural language to cron (demo + API)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=LOG_DIR=${LOG_DIR}
Environment=LOG_MAX_BYTES=1000000
Environment=LOG_MAX_FILES=3
ExecStart=${PROJECT_DIR}/node_modules/.bin/tsx ${PROJECT_DIR}/server/index.ts
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  $SUDO install -m 0644 "$TMP" "$UNIT"
  rm -f "$TMP"
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "${SERVICE_NAME}" >/dev/null
  $SUDO systemctl restart "${SERVICE_NAME}"
  sleep 2
  if $SUDO systemctl is-active --quiet "${SERVICE_NAME}"; then
    say "Service is running"
  else
    echo "Service failed to start, last logs:" >&2
    $SUDO journalctl -u "${SERVICE_NAME}" -n 40 --no-pager >&2
    exit 1
  fi
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  cat <<EOF

  Demo     : http://${IP:-localhost}:${PORT}/
  API      : http://${IP:-localhost}:${PORT}/api/parse?q=every+15+minutes+during+business+hours
  Widget   : <script src="http://${IP:-localhost}:${PORT}/widget/cronai-widget.js"></script>
  Iframe   : http://${IP:-localhost}:${PORT}/embed?size=compact&theme=auto
  Logs     : journalctl -u ${SERVICE_NAME} -f
  Log file : ${LOG_DIR}/cronai.log  (1 MB x 3, rotated)
  Copy log : scp <vm>:${LOG_DIR}/cronai.log* ./logs/

EOF
else
  say "systemd not available; starting in the foreground instead (Ctrl+C to stop)"
  PORT="$PORT" LOG_DIR="$LOG_DIR" exec node_modules/.bin/tsx server/index.ts
fi
