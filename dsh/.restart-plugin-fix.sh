#!/data/data/com.termux/files/usr/bin/bash
# Restart #2: aktivira fix iz headless sesije (path.dirname u android-folder).
# Log: ~/dsh/restart-plugin-fix.log
LOG="$HOME/dsh/restart-plugin-fix.log"
{
  echo "[$(date '+%H:%M:%S')] zakazano: restart za fix android-folder (path.dirname)"
  sleep 12
  pkill -f 'dsh/lib/bin[.]js'
  sleep 1
  nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
  sleep 20
  echo "[$(date '+%H:%M:%S')] HTTP:$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3081/)"
  for r in android-share android-folder delete-paths; do
    st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 -X POST -H 'content-type: application/json' \
          --data-binary '{"path":"/storage/emulated/0/Download/DSH-Restore-20261006.zip"}' \
          "http://127.0.0.1:3081/composer-extras/api/$r" 2>/dev/null)"
    echo "[$(date '+%H:%M:%S')] $r: HTTP:$st  (400/200 = ruta ziva; 405 = nije registrovana)"
  done
} >> "$LOG" 2>&1
