#!/data/data/com.termux/files/usr/bin/bash
# TEST smart-starta: restart (da ucita izmenu branch rute) pa branch pitanja.
# Detached — moze da radi i posle gasenja web servera.
# Log: ~/dsh/smart-start-test.log
LOG="$HOME/dsh/smart-start-test.log"
WS="$HOME/.dsh/sessions/--data-data-com.termux-files-home-dsh--"
BRANCH_SESS="$WS/session-72cc0d5c-e55c-4f74-b918-b63dcc6b1e69"
PROMPT="$HOME/dsh/.smart-test-prompt.md"

{
  echo "=== $(date '+%F %T') start ==="
  sleep 15   # da odgovor agenta stigne do browsera pre gasenja servera

  # 1) sacekaj da peak-hours sesija ne radi (max 10 min)
  for i in $(seq 1 40); do
    t=$(stat -c %Y "$BRANCH_SESS"/session*.jsonl.zstd 2>/dev/null | sort -n | tail -1)
    idle=$(( $(date +%s) - ${t:-0} ))
    if [ "$idle" -ge 90 ]; then echo "peak-hours mirna ${idle}s — nastavljam"; break; fi
    sleep 15
  done

  # 2) restart (ucitava novu branch rutu sa smart startom)
  pkill -f 'dsh/lib/bin[.]js'; sleep 1
  nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:3081/ 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; then echo "HTTP $code posle $((i*2))s"; break; fi
    sleep 2
  done
  sleep 4

  # 3) TEST — cist prompt, bez ikakvih dodatnih instrukcija
  printf 'Koliko dana ima septembar u ovoj godini?' > "$PROMPT"
  echo "--- branch.sh ---"
  "$HOME/.dsh/skills/branch-into-new-session/branch.sh" -t "Smart test: septembar" "$PROMPT"
  echo "--- exit=$? $(date '+%F %T') ---"
} >> "$LOG" 2>&1

timeout 20 termux-notification --title "dsh: smart-start test" \
  --content "restart + branch gotovi — pogledaj novu sesiju i ~/dsh/smart-start-test.log" 2>/dev/null
