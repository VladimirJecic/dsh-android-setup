#!/data/data/com.termux/files/usr/bin/bash
# edge-download-bridge.sh
# Prebacuje fajlove koje je Microsoft Edge (Chromium) skinuo u svoju privatnu
# fasciklu  Android/data/com.microsoft.emmx/files/Download  u pravi, javni
# /storage/emulated/0/Download.
#
# Pristup privatnoj fascikli ide preko Shizuku-a (rish, uid=shell), jer Termux
# bez root-a ne moze da cita Android/data.
# Napomena: rish ne propagira exit kod i pise izlaz na stderr, zato se svuda
# koriste sentinel markeri (__OK__).
#
# Upotreba:
#   edge-bridge              # jedan prolaz
#   edge-bridge --watch      # petlja (default interval 60s)
#   edge-bridge --watch 30   # petlja na 30s
#   edge-bridge --status     # stanje + poslednjih 15 log linija
#   edge-bridge --stop       # zaustavi watcher

set -uo pipefail

SRC="/storage/emulated/0/Android/data/com.microsoft.emmx/files/Download"
DST="/storage/emulated/0/Download"
RISH="$HOME/rish"
LOG="$HOME/.edge-bridge.log"
PIDFILE="$HOME/.edge-bridge.pid"
INTERVAL=60
MAXLOG=3000

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG"; }

trim_log() {
  [ -f "$LOG" ] || return 0
  if [ "$(wc -l <"$LOG" 2>/dev/null || echo 0)" -gt "$MAXLOG" ]; then
    tail -n 500 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  fi
}

# Bezbedno pakovanje imena za sh -c na drugoj strani (apostrofi u imenima).
q() { printf "%s" "$1" | sed "s/'/'\\\\''/g"; }

notify() {
  command -v termux-notification >/dev/null 2>&1 || return 0
  termux-notification --id edge-bridge --title "Edge -> Download" --content "$1" \
    >/dev/null 2>&1 || true
}

# rish izvrsavanje sa sentinelom: ispisuje izlaz bez markera.
# Vraca 0 samo ako je marker __OK__ prisutan.
rish_run() {
  local out
  out=$(timeout "${RISH_TIMEOUT:-90}" "$RISH" -c "$1; echo __OK__" </dev/null 2>&1) || true
  case "$out" in
  *__OK__*)
    printf '%s\n' "${out%__OK__*}"
    return 0
    ;;
  *)
    printf '%s\n' "$out"
    return 1
    ;;
  esac
}

shizuku_ok() {
  [ -x "$RISH" ] || return 1
  local out
  out=$(timeout 30 "$RISH" -c "id; echo __OK__" </dev/null 2>&1) || true
  [ "${out#*uid=}" != "$out" ]
}

MOVED=0
run_once() {
  MOVED=0
  if ! shizuku_ok; then
    log "SKIP: Shizuku (rish) nije pokrenut - nema pristupa $SRC"
    return 0
  fi

  local list
  if ! list=$(rish_run "cd '$SRC' 2>/dev/null && ls -1"); then
    log "ERR: ne mogu da procitam $SRC"
    return 1
  fi
  list=$(printf '%s\n' "$list" | grep -v '^$' | grep -v "No such file" || true)
  [ -z "$list" ] && return 0

  local name dst_name base ext i
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    dst_name="$name"
    i=1
    while [ -e "$DST/$dst_name" ]; do
      ext="${name##*.}"
      if [ "$ext" = "$name" ]; then
        dst_name="$name ($i)"
      else
        base="${name%.*}"
        dst_name="$base ($i).$ext"
      fi
      i=$((i + 1))
    done

    if rish_run "mv '$SRC/$(q "$name")' '$DST/$(q "$dst_name")'" >/dev/null; then
      termux-media-scan "$DST/$dst_name" >/dev/null 2>&1 || true
      log "MOVED: $name  ->  $dst_name"
      MOVED=$((MOVED + 1))
    else
      log "FAIL: $name"
    fi
  done <<<"$list"

  if [ "$MOVED" -gt 0 ]; then
    log "OK: prebaceno $MOVED fajl(ova) u $DST"
    notify "Prebaceno $MOVED fajl(ova) u Download."
  fi
  return 0
}

watch() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    echo "Watcher vec radi (PID $(cat "$PIDFILE"))."
    exit 0
  fi
  echo $$ >"$PIDFILE"
  log "WATCH: start (interval ${INTERVAL}s, PID $$)"
  trap 'log "WATCH: stop (PID $$)"; rm -f "$PIDFILE"; exit 0' TERM INT
  while :; do
    run_once
    trim_log
    sleep "$INTERVAL"
  done
}

show_status() {
  echo "SRC: $SRC"
  echo "DST: $DST"
  if shizuku_ok; then
    echo "Shizuku: RADI"
    echo "--- fajlovi u Edge fascikli:"
    rish_run "ls -la '$SRC'" 2>/dev/null | sed 's/^/    /'
  else
    echo "Shizuku: NE RADI (pokreni Shizuku pa probaj ponovo)"
  fi
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    echo "Watcher: RADI (PID $(cat "$PIDFILE"))"
  else
    echo "Watcher: ne radi"
  fi
  echo "--- poslednjih 15 log linija ($LOG):"
  tail -n 15 "$LOG" 2>/dev/null | sed 's/^/    /' || echo "    (nema loga)"
}

case "${1:-}" in
--watch)
  [ -n "${2:-}" ] && INTERVAL="$2"
  watch
  ;;
--status) show_status ;;
--stop | --restart)
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null && echo "Zaustavljen watcher PID $(cat "$PIDFILE")"
    rm -f "$PIDFILE"
  else
    echo "Watcher ne radi."
  fi
  ;;
"")
  run_once
  if [ "$MOVED" -gt 0 ]; then echo "Prebaceno: $MOVED"; else echo "Nema novih fajlova."; fi
  ;;
*)
  echo "Nepoznata opcija: $1" >&2
  exit 2
  ;;
esac
