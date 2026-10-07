#!/data/data/com.termux/files/usr/bin/bash
# .restart-after-update.sh — dovršava update: sačeka da sesije budu MIRNE,
# restartuje dsh preko pravog launcher-a i proveri da se nova verzija digla.
# Ako se nije digla — sam radi `dsh-update.sh --rollback`, pa opet diže.
#
# Pokreće se DETAŠIRANO (setsid), pa preživi `pkill` koji sam izvrši.
#
# Log: ~/dsh/restart-after-update.log
#   IDLE=120       koliko sekundi mira se čeka (default 120)
#   MAX_WAIT=7200  koliko najduže čeka mir (default 2h)
#   DRY=1          samo izračunaj i prijavi, ništa ne restartuj

set -uo pipefail
LOG="$HOME/dsh/restart-after-update.log"
IDLE="${IDLE:-120}"
MAX_WAIT="${MAX_WAIT:-7200}"
DRY="${DRY:-0}"
PORT=3081
PKG_JSON=/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/package.json

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
[ "$DRY" = 1 ] && log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

newest_mtime() {
	local m=0 f t
	while IFS= read -r f; do
		t=$(stat -c %Y "$f" 2>/dev/null || echo 0)
		[ "$t" -gt "$m" ] && m=$t
	done < <(find "$HOME/.dsh/sessions" -name 'session*.jsonl*' -type f 2>/dev/null)
	printf '%s' "$m"
}

ver_disk() { node -p "require('$PKG_JSON').version" 2>/dev/null; }
http() { curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null; }

notify() {
	timeout 20 termux-notification --title "$1" --content "$2" 2>/dev/null
}

wait_up() {
	local i code=""
	for i in $(seq 1 30); do
		sleep 3
		code=$(http)
		case "$code" in 200|301|302|401|403) printf '%s' "$code"; return 0 ;; esac
	done
	printf '%s' "${code:-none}"
	return 1
}

relaunch() {
	pkill -f 'dsh/lib/bin[.]js' 2>/dev/null
	sleep 2
	nohup "$HOME/.local/bin/dsh-termux" > "$HOME/dsh/dsh-web.log" 2>&1 &
	disown 2>/dev/null
}

state() {
	local pid started
	pid=$(pgrep -f 'dsh/lib/bin[.]js' 2>/dev/null | head -1)
	started=$(ps -o lstart= -p "${pid:-0}" 2>/dev/null | xargs)
	printf 'PID=%s start=%s disk=%s' "${pid:-?}" "${started:-?}" "$(ver_disk)"
}

# --- 1) čekaj mir ------------------------------------------------------------
log "start: cekam mir ${IDLE}s (max ${MAX_WAIT}s), na disku $(ver_disk)"
waited=0
while [ "$waited" -lt "$MAX_WAIT" ]; do
	now=$(date +%s)
	mtime=$(newest_mtime)
	idle=$((now - mtime))
	if [ "$mtime" -gt 0 ] && [ "$idle" -ge "$IDLE" ]; then
		log "mirno: zadnji upis u sesiju pre ${idle}s (cekao ${waited}s)"
		break
	fi
	[ "$waited" -eq 0 ] && log "sesija aktivna (zadnji upis pre ${idle}s) — cekam"
	sleep 10
	waited=$((waited + 10))
done

if [ "$waited" -ge "$MAX_WAIT" ]; then
	log "ODUSTAO: sesije su aktivne i posle ${MAX_WAIT}s — dsh nije restartovan"
	notify "dsh restart odložen" "sesije aktivne >${MAX_WAIT}s; pokreni restart-dsh ručno"
	exit 1
fi

if [ "$DRY" = 1 ]; then
	log "DRY: restart bi sada bio izvrsen ($(state))"
	exit 0
fi

# --- 2) restart na novu verziju ---------------------------------------------
target=$(ver_disk)
log "restartujem dsh (na disku $target)"
relaunch
if code=$(wait_up); then
	log "OK: HTTP $code ($(state))"
	notify "dsh $target radi" "restart OK, HTTP $code"
	exit 0
fi

# --- 3) nije se digao -> rollback -------------------------------------------
log "GRESKA: HTTP $code posle restarta — ROLLBACK"
{ echo "--- dsh-web.log (zadnjih 25) ---"; tail -25 "$HOME/dsh/dsh-web.log" 2>/dev/null; } >> "$LOG"
"$HOME/dsh/dsh-update.sh" --rollback >> "$LOG" 2>&1
relaunch
if code=$(wait_up); then
	log "ROLLBACK OK: HTTP $code ($(state))"
	notify "dsh rollback" "0.2.0 se nije digao; vraceno na $(ver_disk)"
	exit 0
fi

log "KATASTROFA: ni rollback nije digao (HTTP $code) — vidi ~/dsh/dsh-web.log"
notify "dsh DOWN" "ni rollback nije digao — pogledaj ~/dsh/dsh-web.log"
exit 1
