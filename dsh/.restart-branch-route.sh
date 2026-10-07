#!/data/data/com.termux/files/usr/bin/bash
# Zakazani restart dsh-a: aktivira novu rutu /composer-extras/api/branch-session
# (nova prazna sesija u istom workspace-u). Log: ~/dsh/restart-branch-route.log
LOG="$HOME/dsh/restart-branch-route.log"
{
  echo "[$(date '+%H:%M:%S')] zakazano: restart za branch-session rutu"
  sleep 12
  pkill -f 'dsh/lib/bin[.]js'
  sleep 1
  nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
  sleep 22
  echo "[$(date '+%H:%M:%S')] HTTP:$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 http://127.0.0.1:3081/)"

  # route mora da vrati nas 400 'bad-request' (prazan prompt), a NE 405
  body="$(curl -s --max-time 8 -X POST -H 'content-type: application/json' \
        --data-binary '{"prompt":""}' \
        "http://127.0.0.1:3081/composer-extras/api/branch-session" 2>/dev/null)"
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST -H 'content-type: application/json' \
        --data-binary '{"prompt":""}' \
        "http://127.0.0.1:3081/composer-extras/api/branch-session" 2>/dev/null)"
  echo "[$(date '+%H:%M:%S')] branch-session: HTTP:$st body:$body"
  case "$body" in
    *bad-request*) echo "[$(date '+%H:%M:%S')] OK ruta je aktivna" ;;
    *)             echo "[$(date '+%H:%M:%S')] [!] ruta NIJE aktivna — pogledaj ~/dsh/dsh-web.log" ;;
  esac

  echo "[$(date '+%H:%M:%S')] client bundle: $(curl -s -o /dev/null -w '%{http_code}' --max-time 6 'http://127.0.0.1:3081/plugins/dsh-composer-extras/client.js')"
} >> "$LOG" 2>&1
