#!/data/data/com.termux/files/usr/bin/bash
# resume-after-restart.sh — saceka da dsh sesije budu mirne, restartuje server
# (da ucita `android-tool-use-order-fix` / `android-empty-text-after-tool-call-fix`),
# pa posalje prompt u CILJNU sesiju i prijavi ishod.
#
#   resume-after-restart.sh [sessionId] [prompt]
#
# Log: ~/dsh/resume-after-restart.log ; na kraju i termux-notification.
#
# Zasto ovako: patch adaptera vazi tek posle restarta procesa, a restart ubija
# i sesiju koja ga je pokrenula — zato se sve radi iz odvojenog (nohup) procesa
# koji ceka MIRNOCU (nijedan log se ne pise IDLE sekundi), pa tek onda restartuje.
set -uo pipefail

SESSION="${1:-session-154bc11b-911e-4d0c-9eb6-040808c51e1d}"
PROMPT="${2:-try again}"
LOG="$HOME/dsh/resume-after-restart.log"
WS_ROOT="$HOME/.dsh/sessions"
TARGET_DIR="$WS_ROOT/--data-data-com.termux-files-home-dsh-dsh_v2--/$SESSION"
STATE="$HOME/dsh/session-turn-state.py"
URL="http://127.0.0.1:3081"
IDLE="${IDLE:-75}"
MAX_WAIT="${MAX_WAIT:-5400}"
TURN_WAIT="${TURN_WAIT:-1800}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

{
  log "start: session=$SESSION idle=${IDLE}s prompt=\"$PROMPT\""

  # 1) mirnoca: nijedan session log se ne pise IDLE sekundi
  waited=0
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    now=$(date +%s)
    newest=$(find "$WS_ROOT" -name 'session*.jsonl.zstd' -printf '%T@\n' 2>/dev/null \
             | sort -n | tail -1 | cut -d. -f1)
    newest="${newest:-0}"
    idle=$(( now - newest ))
    if [ "$idle" -ge "$IDLE" ]; then
      log "mirno ${idle}s -> restart"
      break
    fi
    sleep 10
    waited=$(( waited + 10 ))
  done
  if [ "$waited" -ge "$MAX_WAIT" ]; then
    log "ODUSTAJEM: sesije su aktivne i posle ${MAX_WAIT}s"
    exit 1
  fi

  # 2) restart preko pravog wrapper-a (on sam primenjuje Android zakrpe)
  pkill -f 'dsh/lib/bin[.]js'
  sleep 2
  nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
  disown 2>/dev/null || true

  code=000
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$URL/" 2>/dev/null || echo 000)
    # 401 je OCEKIVAN odgovor na / bez browser kolacica — server je ziv
    if [ "$code" = "401" ] || [ "$code" = "200" ]; then break; fi
    sleep 2
  done
  log "posle restarta HTTP:$code"
  if [ "$code" = "000" ]; then
    log "GRESKA: server nije podignut — vidi ~/dsh/dsh-web.log"
    exit 1
  fi

  # 3) stanje PRE prompta (da znamo od kog turna gledamo)
  before=$(python3 "$STATE" "$TARGET_DIR/session.v4.jsonl.zstd" 2>/dev/null)
  log "pre prompta: $before"

  # 4) „try again" u ciljnu sesiju
  resp=$(curl -s --max-time 30 -X POST -H 'content-type: application/json' \
      --data-binary "{\"sessionId\":\"$SESSION\",\"text\":\"$PROMPT\"}" \
      "$URL/composer-extras/api/prompt-session" 2>/dev/null)
  log "prompt-session odgovor: ${resp:-<nema>}"
  case "$resp" in
    *'"ok":true'*) : ;;
    *) log "GRESKA: prompt nije prihvacen"; exit 1 ;;
  esac

  # 5) ishod: cekaj turn/end novijeg turna od onog pre prompta
  before_turn=$(printf '%s' "$before" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastTurn") or 0)' 2>/dev/null)
  before_turn="${before_turn:-0}"
  outcome="timeout"
  deadline=$(( $(date +%s) + TURN_WAIT ))
  last=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 15
    now_state=$(python3 "$STATE" "$TARGET_DIR/session.v4.jsonl.zstd" 2>/dev/null)
    [ -n "$now_state" ] && last="$now_state"
    done_turn=$(printf '%s' "$now_state" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("lastTurn") or 0)' 2>/dev/null)
    done_turn="${done_turn:-0}"
    if [ "$done_turn" -gt "$before_turn" ]; then
      outcome=$(printf '%s' "$now_state" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("kind") or "?")' 2>/dev/null)
      break
    fi
    # progres u log (dokaz da sesija radi, a ne samo da je prompt primljen)
    log "u toku: $now_state"
  done

  log "ISHOD: kind=${outcome} | zadnje stanje: ${last:-<nema>}"
  err=$(printf '%s' "${last:-{}}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("error") or "")' 2>/dev/null)
  case "$err" in
    *"tool_use"*"without"*"tool_result"*)
      msg="NIJE POPRAVLJENO — isti 400: ${err:0:120}" ;;
    *)
      case "$outcome" in
        completed) msg="NASTAVILA je da radi na DeepSeek-u (turn completed)" ;;
        error) msg="turn je pao: ${err:0:120}" ;;
        timeout) msg="jos traje posle ${TURN_WAIT}s — vidi log" ;;
        *) msg="ishod: ${outcome}" ;;
      esac ;;
  esac
  log "gotovo: $msg"
  timeout 20 termux-notification --title "dsh: sesija 154bc11b" --content "$msg" 2>/dev/null
} >> "$LOG" 2>&1
