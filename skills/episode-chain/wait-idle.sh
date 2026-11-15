#!/data/data/com.termux/files/usr/bin/bash
# wait-idle.sh — čeka da sesija ZAVRŠI posao za jednu epizodu.
#
# Zašto ne `turn/end`: dsh piše log inkrementalno, pa `zstdcat` u toku pisanja
# ume da vrati odsečen frame, a sesija koju je restart prekinuo nikad ne dobije
# `turn/end`. Zato se gleda ARTEFAKT koji zadatak mora da ostavi:
#
#   1) <epdir>/.done.json postoji  → sesija je završila (uspeh ili prijavljena greška)
#   2) log se ne menja >= --zastoj min → sesija je stala (prekinuta/zaglavljena)
#
# Upotreba:
#   wait-idle.sh <session-id> --done-file <put> [--timeout MIN] [--zastoj MIN]
#
# Exit: 0 = .done.json postoji, 1 = timeout, 2 = loši argumenti,
#       3 = sesija nestala, 4 = zastoj (nema napretka).
set -uo pipefail

SESS_DIR="${DSH_HOME:-$HOME/.dsh}/sessions"
SID=""; DONEFILE=""; TIMEOUT_MIN=180; ZASTOJ_MIN=30

while [ $# -gt 0 ]; do
  case "$1" in
    --done-file) DONEFILE="${2:?--done-file trazi put}"; shift 2 ;;
    --timeout) TIMEOUT_MIN="${2:?--timeout trazi min}"; shift 2 ;;
    --zastoj) ZASTOJ_MIN="${2:?--zastoj trazi min}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) echo "wait-idle.sh: nepoznata opcija: $1" >&2; exit 2 ;;
    *) SID="$1"; shift ;;
  esac
done
[ -n "$SID" ] || { echo "wait-idle.sh: daj session id" >&2; exit 2; }
[ -n "$DONEFILE" ] || { echo "wait-idle.sh: daj --done-file" >&2; exit 2; }

LOG=$(ls -1 "$SESS_DIR"/*/"$SID"/session*.jsonl.zstd 2>/dev/null | head -1)
[ -n "$LOG" ] || { echo "wait-idle.sh: nema loga za $SID" >&2; exit 3; }

START=$(date +%s)
DEADLINE=$((START + TIMEOUT_MIN*60))
ZASTOJ=$((ZASTOJ_MIN*60))
LAST_CHANGE=$START
PREV_MTIME=$(stat -c %Y "$LOG" 2>/dev/null || echo 0)

while :; do
  if [ -f "$DONEFILE" ]; then
    echo "DONE $SID (.done.json postoji, posle $(( $(date +%s) - START ))s)"
    exit 0
  fi

  NOW=$(date +%s)
  if [ "$NOW" -ge "$DEADLINE" ]; then
    echo "TIMEOUT posle ${TIMEOUT_MIN} min — sesija $SID nije ostavila .done.json"
    exit 1
  fi

  MT=$(stat -c %Y "$LOG" 2>/dev/null || echo 0)
  if [ "$MT" != "$PREV_MTIME" ]; then
    PREV_MTIME="$MT"; LAST_CHANGE="$NOW"
  elif [ $((NOW - LAST_CHANGE)) -ge "$ZASTOJ" ]; then
    echo "ZASTOJ: log se ne menja $(( (NOW-LAST_CHANGE)/60 )) min — sesija $SID je stala"
    exit 4
  fi

  sleep 60
done
