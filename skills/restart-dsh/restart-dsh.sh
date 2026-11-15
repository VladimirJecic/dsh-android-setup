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
#   2. ugasi TAČNO node proces dsh servera (enumeracija + `kill`, uz
#      eksplicitno izbegavanje sebe i sopstvenih shell-predaka);
#      `pkill -f` je UKLONJEN 2026-11-15 — gadao je i sam skript kad se
#      obrazac `dsh/lib/bin.js` nadje u njegovom argv (vidi blok „KO SME DA
#      UMRE" nize);
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

# ── KO SME DA UMRE ─────────────────────────────────────────────────────────
# `pkill -f` poredi obrazac sa PUNOM komandnom linijom svakog procesa, ne
# samo sa node-om. Ako je skriptu pokrenuo proces ciji argv SADRZI tekst
# `dsh/lib/bin[.]js` (npr. agentov `bash -c "bash …/restart-dsh.sh"` ili bilo
# koja shell komanda koja pominje taj obrazac), `pkill -f` ubije i NJEGA —
# tj. samu sebe — i to tacno izmedju `log`-a i `setsid nohup` relancha.
# Desilo se 2026-11-15: log ima „restart: kill + relaunch", ali NEMA ni „OK"
# ni „NEUSPEH", a dsh-web.log nije bio ni dodirnut — skript je umro na pkill.
#
# Zato se sada gadja TACNO node proces dsh-a, ne obrazac. Pravilo izbora je
# namerno ASIMETRICNO, jer je prva verzija fix-a bila pogresna:
#   • SCRIPT i njegovi PREDCI koji NISU dsh server su zasticeni (shell,
#     Termux session, zygote) — njih ne smemo da ubijemo;
#   • ALI dsh server se UBIJA I KADA JE PREDAK. To je uobicajen slucaj:
#     pluginu i agentu je dsh roditelj (`/restart-dsh` iz GUI-ja ide bas tako).
#     Testirano 2026-11-15 na ovoj masini: dsh (22641) je roditelj shell-a
#     koji je pokrenuo skriptu, pa je „zastiti sve pretke" vratilo PRAZNU listu
#     i restart nista ne bi uradio. Zato identitet („da li je ovo dsh?")
#     pobeđuje parenje („da li je ovo moj predak?").
DSH_BIN_GLOB='@deepseek-ai/dsh/lib/bin.js'

self_chain() {
	# $$ → PPID → … → 1; svaki PID novi red. Termux se ume prekinuti u
	# `zygote`, pa se staje i na PPID<=1 ili na ciklusu.
	local pid=$$
	local guard=0
	while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ "$guard" -lt 32 ]; do
		printf '%s\n' "$pid"
		pid=$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null)
		guard=$((guard + 1))
	done
}
CHAIN=$(self_chain | sort -u)

# PIDs of REAL dsh servers: the argv names the package's bin.js AND the `web`
# subcommand. A shell that merely MENTIONS the pattern fails both tests.
# An ancestor that IS a dsh server is still returned (see the note above).
dsh_server_pids() {
	ps -eo pid=,args= 2>/dev/null | awk -v chain="$CHAIN" -v self="$$" '
		BEGIN { split(chain, c, "\n"); for (i in c) if (c[i] != "") ancestor[c[i]] = 1 }
		{
			pid = $1
			$1 = ""
			cmd = $0
			# This script itself is never a candidate.
			if (pid == self) next
			if (cmd !~ /@deepseek-ai\/dsh\/lib\/bin[.]js/) next
			if (cmd !~ /[ \t]web([ \t]|$)/) next
			# Protection applies ONLY to non-dsh ancestors: shells, session,
			# zygote. A dsh ancestor is the target, not a bystander.
			if ((pid in ancestor) && (cmd !~ /node/)) next
			print pid
		}'
}

pids=$(dsh_server_pids)
if [ -n "$pids" ]; then
	# shellcheck disable=SC2086
	kill $pids 2>/dev/null
	log "restart: TERM na ${pids//$'\n'/ }"
else
	log "restart: nema zivog dsh servera (nista za TERM)"
fi
sleep 1
# Ako se proces ne preda u ~3 s, pojačaj — inače bi dva dsh-a držala isti port.
pids=$(dsh_server_pids)
if [ -n "$pids" ]; then
	sleep 2
	pids=$(dsh_server_pids)
	if [ -n "$pids" ]; then
		# shellcheck disable=SC2086
		kill -9 $pids 2>/dev/null
		log "restart: KILL -9 na ${pids//$'\n'/ }"
	fi
	sleep 1
fi
# Bezbednosna mreza: skript nikad ne sme da prezivi ovde kao ziv proces koji
# je pozvao `kill -9` na sopstveni proces — provera da smo i dalje mi.
if [ "$(awk '/^PPid:/ {print $2}' "/proc/$$/status" 2>/dev/null)" = "" ]; then
	say "[x] restart-dsh: izgubio sam vezu sa roditeljem — prekidam"
	exit 1
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
