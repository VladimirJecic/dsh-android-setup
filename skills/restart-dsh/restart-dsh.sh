#!/data/data/com.termux/files/usr/bin/bash
# restart-dsh.sh — JEDINA implementacija restarta dsh-a na Termuxu.
#
# Zašto skripta, a ne dva restarta: restart je nekad postojao na dva mesta —
# kao skill `restart-dsh` (terminal / agent) i kao `/restart` komanda u
# dsh-composer-extras pluginu („+" meni u GUI-ju) — sa različitim imenima i
# odvojenom logikom. Od 2026-10-07 postoji SAMO ovaj skript:
#   • skill `restart-dsh` ga poziva kad korisnik kaže „restartuj dsh" ili
#     otkuca /restart-dsh iz terminala;
#   • serverska komanda `/restart-dsh` iz plugina ga poziva detaširano
#     (`--delay 2 --quiet`), pa je GUI put samo tanak omotač oko istog koda.
#
# Usage:
#   restart-dsh.sh [--delay SEKUNDI] [--quiet]
#
# Šta radi:
#   1. (opciono) sačeka `--delay` sekundi — plugin ga zove detaširano i mora
#      da stigne da vrati poruku korisniku pre nego što proces padne;
#   2. `pkill -f 'dsh/lib/bin[.]js'` (pa `-9` ako se ne preda u ~3 s);
#   3. detaširano podigne `~/.local/bin/dsh-termux` — PRAVI wrapper, jer on
#      pri svakom bootu ponovo primenjuje Android zakrpe (hard-link,
#      dir-fsync, ripgrep shim, koffi, require-builtin fallback, PWA
#      SameSite). Običan `dsh` alias/`/usr/bin/dsh` sve to preskoči;
#   4. čeka da port 3081 odgovori (200/301/302/401/403 = živ; 000 = mrtav);
#   5. piše u `~/dsh/restart-dsh.log` + Android notifikaciju.
#
# Exit: 0 ako je dsh posle restarta živ, 1 ako nije.
set -uo pipefail

DELAY=0
QUIET=0
while [ $# -gt 0 ]; do
	case "$1" in
		--delay) DELAY="${2:-0}"; shift 2 ;;
		--delay=*) DELAY="${1#*=}"; shift ;;
		--quiet) QUIET=1; shift ;;
		*) printf 'restart-dsh: nepoznat argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

H="${HOME:-/data/data/com.termux/files/home}"
WRAPPER="$H/.local/bin/dsh-termux"
LOG="$H/dsh/restart-dsh.log"
WEBLOG="$H/dsh/dsh-web.log"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true; }
say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
notify() { command -v termux-notification >/dev/null 2>&1 && termux-notification --title 'restart-dsh' --content "$1" || true; }

# Provera PRE pravljenja log foldera: ako HOME nije naš (npr. pogrešan env),
# `mkdir` bi bacio „Read-only file system" šum pre prave greške.
[ -x "$WRAPPER" ] || { say "[x] nema izvršnog wrappera: $WRAPPER"; exit 1; }
mkdir -p "$H/dsh" 2>/dev/null || true

if [ "$DELAY" != 0 ]; then sleep "$DELAY"; fi

log "restart: kill + relaunch (delay=${DELAY}s)"
say "restart-dsh: gasim dsh…"
pkill -f 'dsh/lib/bin[.]js' 2>/dev/null
sleep 1
# Ako se proces ne preda u ~3 s, pojačaj — inače bi dva dsh-a držala isti port.
if pgrep -f 'dsh/lib/bin[.]js' >/dev/null 2>&1; then
	sleep 2
	pkill -9 -f 'dsh/lib/bin[.]js' 2>/dev/null
	sleep 1
fi

say "restart-dsh: podižem dsh preko $WRAPPER…"
# Detaširano: skripta mora da preživi smrt procesa koji ju je pozvao. Plugin
# se sam ugasi posle 300 ms, a agentova bash sesija umre kad pkill ubije dsh.
setsid nohup "$WRAPPER" >>"$WEBLOG" 2>&1 &
disown 2>/dev/null || true

# 401/403 je TAKOĐE „živ": to je auth odgovor, ne mrtav port. 000/7 je mrtav.
code=000
for _ in $(seq 1 30); do
	sleep 2
	code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:3081" 2>/dev/null || printf '000')
	case "$code" in
		200|301|302|401|403) break ;;
	esac
done

if [ "$code" = 000 ]; then
	say "[x] dsh se NIJE digao posle 60 s — pogledaj $LOG i $WEBLOG"
	log "NEUSPEH: HTTP=$code posle 60s"
	notify 'dsh se nije digao (HTTP 000) — vidi ~/dsh/dsh-web.log'
	exit 1
fi

say "[ok] dsh je živ (HTTP $code)"
log "OK: HTTP=$code"
notify "dsh je živ (HTTP $code)"
exit 0
