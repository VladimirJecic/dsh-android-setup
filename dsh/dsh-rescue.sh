#!/data/data/com.termux/files/usr/bin/bash
# dsh-rescue.sh — boot a SECOND dsh instance on port 3082 for diagnostics.
#
# Why: the primary instance on 3081 is what the Web GUI is attached to. If a
# profile patch, a plugin or a model route misbehaves, booting a rescue instance
# on another port proves whether the fault is global or local to the running
# process — without touching the instance you are talking through.
#
# There is NO `dsh --verbose` flag and no log-level environment variable: the
# cordis logger defaults to level 1 (info) and dsh ships no console-exporter
# row in its profile patches, so debug output cannot be raised from outside.
# What this script does instead is the real, available thing: it captures the
# full stdout+stderr of a fresh boot to a log file and checks the HTTP surface,
# so a failing boot leaves a readable trace instead of vanishing.
#
# It never kills, restarts or reconfigures the 3081 instance.
#
# Usage:
#   dsh-rescue.sh              # boot on 3082, foreground, tee to log
#   dsh-rescue.sh --check      # only report port + HTTP health, change nothing
#   dsh-rescue.sh -- <args...> # extra args are passed to `dsh web`

set -uo pipefail

DSH_BIN=/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
PRIMARY_PORT=3081
RESCUE_PORT=3082
LOG_DIR="$HOME/.dsh/logs"
LOG_FILE="$LOG_DIR/rescue-$(date +%Y%m%d-%H%M%S).log"

port_free() {
  node -e '
    const net = require("net");
    const s = net.createServer();
    s.once("error", () => process.exit(1));
    s.once("listening", () => s.close(() => process.exit(0)));
    s.listen(Number(process.argv[1]), "127.0.0.1");
  ' "$1" 2>/dev/null
}

http_ok() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1/" 2>/dev/null
}

report() {
  for port in "$PRIMARY_PORT" "$RESCUE_PORT"; do
    if port_free "$port"; then
      echo "  port $port: FREE"
    else
      echo "  port $port: IN USE  (HTTP $(http_ok "$port"))"
    fi
  done
}

if [ "${1:-}" = "--check" ]; then
  echo "dsh: health report"
  report
  exit 0
fi

[ "${1:-}" = "--" ] && shift

mkdir -p "$LOG_DIR"

# Same environment the primary launcher establishes.
SECRETS="$HOME/.config/dsh-secrets.env"
if [ -f "$SECRETS" ]; then
  # shellcheck source=/dev/null
  . "$SECRETS"
fi
export DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-danger-full-access}"

if ! port_free "$RESCUE_PORT"; then
  echo "dsh-rescue: port $RESCUE_PORT is already in use." >&2
  echo "            Free it, or inspect it with: dsh-rescue.sh --check" >&2
  exit 1
fi

echo "dsh-rescue: booting a second instance on http://127.0.0.1:$RESCUE_PORT" >&2
echo "dsh-rescue: primary instance on $PRIMARY_PORT is left untouched." >&2
echo "dsh-rescue: full boot output -> $LOG_FILE" >&2

# --no-open keeps the rescue boot from stealing the browser tab from the GUI
# you are actually working in.
node --expose-internals --max-old-space-size=4096 \
  --require "$HOME/dsh/no-hardlink.cjs" \
  "$DSH_BIN" web --port "$RESCUE_PORT" --no-open "$@" 2>&1 | tee -a "$LOG_FILE"

echo "dsh-rescue: instance exited; boot log kept at $LOG_FILE" >&2
