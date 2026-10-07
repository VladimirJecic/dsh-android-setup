#!/data/data/com.termux/files/usr/bin/bash
# Restart da se ucita nova ruta /composer-extras/api/branch-info (klijent po njoj
# pali 😎 indikator za branchovane sesije). Ceka da sesije budu mirne 90s.
# Log: ~/dsh/restart-branchinfo.log
LOG="$HOME/dsh/restart-branchinfo.log"
WS="$HOME/.dsh/sessions/--data-data-com.termux-files-home-dsh--"
IDLE=90; MAX_WAIT=3600

newest() { local d="$1" f m=0; for f in "$d"/session*.jsonl.zstd; do [ -f "$f" ] || continue
  t=$(stat -c %Y "$f" 2>/dev/null || echo 0); [ "$t" -gt "$m" ] && m=$t; done; printf '%s' "$m"; }
# gledaj SVE sesije u ovom workspace-u (nijedna ne sme da se pise)
newest_all() { local d="$1" f m=0; for f in "$d"/*/session*.jsonl.zstd; do [ -f "$f" ] || continue
  t=$(stat -c %Y "$f" 2>/dev/null || echo 0); [ "$t" -gt "$m" ] && m=$t; done; printf '%s' "$m"; }

{
  echo "[$(date '+%H:%M:%S')] cekam mirnocu (${IDLE}s) pre restarta"
  waited=0
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    idle=$(( $(date +%s) - $(newest_all "$WS") ))
    [ "$idle" -ge "$IDLE" ] && { echo "[$(date '+%H:%M:%S')] mirno ${idle}s -> restart"; break; }
    sleep 15; waited=$((waited + 15))
  done
  [ "$waited" -ge "$MAX_WAIT" ] && { echo "NISAM restartovao (aktivno i posle ${MAX_WAIT}s)"; exit 1; }

  pkill -f 'dsh/lib/bin[.]js'; sleep 1
  nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:3081/ 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; then echo "HTTP $code posle $((i*2))s"; break; fi
    sleep 2
  done
  sleep 3
  # provera BEZ pravljenja sesije: GET branch-info (200) i POST branch-session sa praznim telom (400)
  echo "GET branch-info: $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 'http://127.0.0.1:3081/composer-extras/api/branch-info?sessionId=x')"
  echo "POST branch-session (prazno): $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 -X POST -H 'content-type: application/json' --data-binary '{}' http://127.0.0.1:3081/composer-extras/api/branch-session)"
} >> "$LOG" 2>&1

timeout 20 termux-notification --title "dsh restart (branch-info)" \
  --content "ucitan branch-info; 😎 indikator ce se sam upaliti za branchovane sesije" 2>/dev/null
