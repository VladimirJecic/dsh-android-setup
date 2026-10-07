#!/data/data/com.termux/files/usr/bin/bash
# Pokrece FOKUSIRANU headless dsh sesiju (dugmad u viewer-u + multi-delete) posle
# zakazanog restarta. Detached je (setsid nohup) da prezivi restart web servera.
#
# Log: ~/dsh/headless-buttons.log
set -uo pipefail

LOG="$HOME/dsh/headless-buttons.log"
PROMPT_FILE="$HOME/dsh/PROMPT-buttons-continue.md"
WRAPPER="$HOME/.local/bin/dsh-termux"

{
  echo ""
  echo "=== headless-buttons: cekam da se server vrati ($(date '+%F %T')) ==="
  # restart se desava odmah posle zakazivanja; sacekaj da novi proces bootuje
  sleep 35
  code=""
  for i in $(seq 1 40); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:3081/ 2>/dev/null)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then break; fi
    sleep 2
  done
  echo "server HTTP=$code posle $((35 + i * 2))s"

  set -a
  # shellcheck source=/dev/null
  . "$HOME/.config/dsh-secrets.env" 2>/dev/null || echo "[!] nema dsh-secrets.env"
  set +a
  export DSH_PERMISSION_MODE=danger-full-access

  if [ ! -f "$PROMPT_FILE" ]; then echo "[x] nema $PROMPT_FILE"; exit 1; fi
  echo "=== start headless sesije ($(date '+%F %T')) ==="
  # 15 min tvrdi limit (AGENTS.md: bez beskonacnih petlji)
  timeout 900 "$WRAPPER" headless "$(cat "$PROMPT_FILE")"
  rc=$?
  echo "=== headless exit=$rc ($(date '+%F %T')) ==="
} >> "$LOG" 2>&1

# Kratka notifikacija na telefonu da sesija nije tiho umrla.
timeout 20 termux-notification \
  --title "dsh headless: dugmad" \
  --content "sesija zavrsena (exit=${rc:-?}); log: ~/dsh/headless-buttons.log" \
  2>/dev/null
