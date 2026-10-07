#!/data/data/com.termux/files/usr/bin/bash
# Restart dsh-a kada su obe sesije MIRNE (nijedan log se ne pise 90s), da ne
# prekine branch-ovanu peak-hours sesiju ni razgovor korisnika.
# Potreban je da bi se ucitala izmena: branch ruta sada bira Gemini za prvi prompt.
#
# Log: ~/dsh/restart-when-idle.log
LOG="$HOME/dsh/restart-when-idle.log"
WS="$HOME/.dsh/sessions/--data-data-com.termux-files-home-dsh--"
BRANCH="$WS/session-72cc0d5c-e55c-4f74-b918-b63dcc6b1e69"   # peak-hours zadatak
MINE="$WS/session-11fc5768-4a16-48a0-bb24-dc478f6fb6bf"     # ovaj razgovor
IDLE=90
MAX_WAIT=3600

newest_mtime() {
  local d="$1" f m=0
  for f in "$d"/session*.jsonl.zstd; do
    [ -f "$f" ] || continue
    local t; t=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    [ "$t" -gt "$m" ] && m="$t"
  done
  printf '%s' "$m"
}

{
  echo "[$(date '+%H:%M:%S')] cekam da obe sesije budu mirne ${IDLE}s (max ${MAX_WAIT}s)"
  waited=0
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    now=$(date +%s)
    b=$(newest_mtime "$BRANCH"); m=$(newest_mtime "$MINE")
    b_idle=$(( now - b )); m_idle=$(( now - m ))
    if [ "$b_idle" -ge "$IDLE" ] && [ "$m_idle" -ge "$IDLE" ]; then
      echo "[$(date '+%H:%M:%S')] mirno (branch ${b_idle}s, ovaj razgovor ${m_idle}s) -> restart"
      break
    fi
    sleep 15; waited=$((waited + 15))
  done
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "[$(date '+%H:%M:%S')] NISAM restartovao: sesije su aktivne i posle ${MAX_WAIT}s"
    exit 1
  fi

  pkill -f 'dsh/lib/bin[.]js'
  sleep 1
  nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
  sleep 20
  echo "[$(date '+%H:%M:%S')] HTTP:$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3081/)"
  r="$(curl -s --max-time 6 -X POST -H 'content-type: application/json' \
       --data-binary '{"prompt":"provera","smart":true}' \
       http://127.0.0.1:3081/composer-extras/api/branch-session 2>/dev/null | head -c 200)"
  echo "[$(date '+%H:%M:%S')] branch ruta odgovor: ${r:-<nema>}"
} >> "$LOG" 2>&1

timeout 20 termux-notification --title "dsh restart (idle)" \
  --content "ucitan smart-start za branch; log: ~/dsh/restart-when-idle.log" 2>/dev/null
