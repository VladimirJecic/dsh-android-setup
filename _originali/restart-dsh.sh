#!/data/data/com.termux/files/usr/bin/bash
# Detached DSH restart: waits a few seconds, kills the running dsh, starts a new one.
LOG="$HOME/.dsh/dsh-restart.log"
echo "[$(date '+%F %T')] restart scheduled" >> "$LOG"
sleep 5
pkill -f 'dsh/lib/bin[.]js' 2>/dev/null
# wait for the old process to actually exit and release the port
for i in $(seq 1 30); do
  pgrep -f 'dsh/lib/bin[.]js' >/dev/null 2>&1 || break
  sleep 1
done
sleep 1
cd "$HOME"
nohup "$HOME/.local/bin/dsh-termux" >> "$LOG" 2>&1 &
echo "[$(date '+%F %T')] new dsh launched (pid $!)" >> "$LOG"
