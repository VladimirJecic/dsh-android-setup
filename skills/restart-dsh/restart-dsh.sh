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
DRY=0
while [ $# -gt 0 ]; do
	case "$1" in
		--delay) DELAY="${2:-0}"; shift 2 ;;
		--delay=*) DELAY="${1#*=}"; shift ;;
		--quiet) QUIET=1; shift ;;
		--dry-run) DRY=1; shift ;;
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

# ── SAMOODCEP PRE KILL-A (obavezno) ────────────────────────────────────────
# OVO JE BIO UZROK „restart ne uspe nikad" (2026-11-15, 5 puta zaredom).
#
# Kad agent u dsh sesiji pokrene ovaj skript, lanac procesa je:
#     dsh (node) ──► bash alat ──► restart-dsh.sh
# Dakle **dsh je PREDAK skripta**. Cim skript uradi `kill <dsh>`, dsh pri
# svom gašenju pobije svoju decu (bash alat, a sa njim i ovaj skript), pa
# skript umre odmah posle `TERM` — pre nego sto stigne do `setsid nohup`.
#
# Dokaz iz ~/dsh/restart-dsh.log: posle svakog `TERM na <pid>` NEMA ni `OK`
# ni `NEUSPEH` ni `KILL -9`, a ~/dsh/dsh-web.log nije bio ni dotaknut od
# 2026-10-08 — wrapper se nikad nije ni pokrenuo.
#
# Resenje: skript se odcepi u SOPSTVENU sesiju PRE bilo kakve provere.
# Nekad se detektovalo „da li je dsh nas predak", ali se pokazalo krhkim:
# log nema nijedno „odvajam se" iz tih pokusaja, a `dsh-web.log` (mtime
# 2026-10-08) dokazuje da se relanc nikad nije izvrsio. Detekcija je zavisila
# od tacnog oblika argv-a i od toga da lanac PPID-ova bude citljiv.
#
# Zato se sada NE detektuje nista: skript se uvek re-exec-uje kroz setsid
# (kad `RESTART_REEXEC` nije 1). Iz agenta to spasi zivot (prekine vezu sa
# dsh-om koji cemo ubiti), a iz Terminala/GUI-ja samo dobije novi SID — jeftino
# i nikad ne skodi. `RESTART_REEXEC` cuva da se ne vrtimo u krug.
if [ "$DRY" = 0 ] && [ "${RESTART_REEXEC:-0}" != "1" ] && command -v setsid >/dev/null 2>&1; then
	log "restart: odvajam se u novu sesiju (setsid re-exec)"
	RESTART_REEXEC=1 setsid "$0" "$@" </dev/null >>"$LOG" 2>&1 &
	disown 2>/dev/null || true
	exit 0
fi

# ── KO SME DA UMRE ─────────────────────────────────────────────────────────
# `pkill -f` poredi obrazac sa PUNOM komandnom linijom svakog procesa, ne
# samo sa node-om. Ako je skriptu pokrenuo proces ciji argv SADRZI tekst
# `dsh/lib/bin[.]js` (npr. agentov `bash -c "bash …/restart-dsh.sh"` ili bilo
# koja shell komanda koja pominje taj obrazac), `pkill -f` ubije i NJEGA —
# tj. samu sebe — i to tacno izmedju `log`-a i `setsid nohup` relancha.
# OVO NIJE BIO UZROK padova 2026-11-15 (pet restarta bez „OK"). Uzrok je bio
# drugo: dsh je PREDAK skripta, pa ga ubijanje ubije i skript — vidi blok
# „SAMOODCEP" iznad. Opasnost od `pkill -f` je stvarna i reprodukovana
# (pkill -f ubije i shell koji obrazac samo POMINJE, npr. ovaj komentar), ali
# je to zaseban problem od „restart ne uspe"; enumeracija ostaje jer je
# preciznija, ne zato sto je resila te padove.
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

# ── ZAPISI AKTIVNE SESIJE (pre gasenja) ───────────────────────────────────
# Posle restarta korisnik inace mora rucno da otvori svaku prekinutu sesiju i
# klikne „try again". Ovde se zabelezi KOJE su bile aktivne (session.lock
# osvezen u zadnjih 15 min) i gde im je workspace, pa se posle relanca ispise
# spreman spisak za nastavak.
#   • STATE fajl ~/dsh/restart-dsh.sessions  (cita ga covjek i/ili skripta)
#   • u log ide isto, citljivo
PREKO="$H/dsh/restart-dsh.sessions"
: >"$PREKO" 2>/dev/null || true
aktivnih=0
while IFS= read -r lock; do
	[ -n "$lock" ] || continue
	sdir=$(dirname "$lock")
	sid=$(basename "$sdir")
	ws=$(basename "$(dirname "$sdir")")
	# workspace je u imenu foldera enkodiran; dekodiraj ~00XX u znak
	# Workspace se NE dekodira iz imena foldera (ime je izgubljeno: `1-4` je
	# postalo `1/4`, `Multi-Subs` -> `Multi/Subs`). Cita se STVARNI `cwd` iz
	# prve linije session loga — to je tacna putanja koju je sesija koristila.
	ws_dec=""
	if [ -f "$sdir/session.v4.jsonl.zstd" ]; then
		ws_dec=$(zstd -dc "$sdir/session.v4.jsonl.zstd" 2>/dev/null | head -1 \
			| python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("cwd") or "")
except Exception: print("")' 2>/dev/null)
	fi
	[ -n "$ws_dec" ] || ws_dec="(nepoznat)"
	printf '%s\t%s\n' "$sid" "$ws_dec" >>"$PREKO"
	aktivnih=$((aktivnih + 1))
done <<EOF2
$(find "$H/.dsh/sessions" -name session.lock -newermt '-15 minutes' 2>/dev/null | sort)
EOF2
if [ "$aktivnih" -gt 0 ]; then
	log "restart: aktivnih sesija pre gasenja: $aktivnih (spisak: $PREKO)"
else
	log "restart: nema aktivnih sesija (nijedan lock <15 min)"
fi

if [ "$DRY" = 1 ]; then
	say "DRY-RUN: nista se ne gasi."
	say "  dsh PID-ovi za TERM : ${pids:-（nema zivog dsh-a）}"
	say "  wrapper             : $WRAPPER"
	say "  wrapper izvrsan     : $([ -x "$WRAPPER" ] && echo da || echo NE)"
	say "  WEBLOG              : $WEBLOG"
	say "  WEBLOG mtime        : $(date -r "$WEBLOG" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '(nema fajla)')"
	say "  setsid dostupan     : $(command -v setsid >/dev/null 2>&1 && echo da || echo NE)"
	# Aktivne sesije koje bi restart prekinuo
	akt=$(find "$H/.dsh/sessions" -name session.lock -newermt '-15 minutes' 2>/dev/null | wc -l)
	say "  aktivnih sesija (lock <15 min): $aktivnih"
	if [ -s "$PREKO" ]; then
		say "  spisak (bice ispisan posle restarta):"
		while IFS="$(printf '\t')" read -r sid ws; do
			[ -n "$sid" ] || continue
			say "    $sid  [$ws]"
		done <"$PREKO"
	fi
	exit 0
fi

# Zapamti STARE PID-ove pre gasenja: posle relanca se proverava da je novi
# PID DRUGACIJI. Bez toga bi `OK` lagao — stari proces i sam daje 401 na
# portu, pa bi skript prijavio uspeh i kad se nista nije podiglo (2026-11-15).
OLD_PIDS="$pids"
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

# ── SAČEKAJ DA PORT STVARNO BUDE SLOBODAN ─────────────────────────────────
# `wrapper` (dsh-termux) na samom startu pita „je li port 3081 slobodan" i ako
# NIJE, ispise „port je vec zauzet" i izadje sa 1 — ne ceka. Ako se stari dsh
# jos gasi kad ga pozovemo, relanc tiho propadne: u logu ostane samo
# „TERM na <pid>", a dsh-web.log se ne dotakne. To je drugi deo uzroka
# „restart ne uspe" (2026-11-15).
port_free() {
	node -e 'const n=require("net");const s=n.createServer();
		s.once("error",()=>process.exit(1));
		s.once("listening",()=>s.close(()=>process.exit(0)));
		s.listen(Number(process.argv[1]),"127.0.0.1");' 3081 2>/dev/null
}
freed=0
for _ in $(seq 1 40); do
	if port_free; then freed=1; break; fi
	sleep 0.5
done
if [ "$freed" = 1 ]; then
	log "restart: port 3081 slobodan — pokrecem wrapper"
else
	log "UPOZORENJE: port 3081 jos zauzet posle 20 s — pokusavam wrapper ipak"
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
	# `curl` SAM ispise `000` i kad padne (write-out se izvrsi i pri gresci),
	# pa `|| printf '000'` dodaje JOS jedno -> „000000". To ne matchuje `000`
	# ispod, pa je skript prijavljivao „OK: HTTP=000000" — lazni uspeh
	# (2026-11-15 15:59:14 u logu). Zato se ovde ne dodaje nista.
	code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:3081" 2>/dev/null)
	[ -n "$code" ] || code=000
	case "$code" in
		200|301|302|401|403) break ;;
	esac
done

NEW_PIDS=$(dsh_server_pids)
same=0
if [ -n "$OLD_PIDS" ] && [ "$NEW_PIDS" = "$OLD_PIDS" ]; then same=1; fi

case "$code" in [0-9][0-9][0-9]) ;; *) code=000 ;; esac
if [ "$code" = 000 ]; then
	say "[x] dsh se NIJE digao posle 60 s — pogledaj $LOG i $WEBLOG"
	log "NEUSPEH: HTTP=$code posle 60s (stari PID: ${OLD_PIDS:-nema}, sada: ${NEW_PIDS:-nema})"
	notify 'dsh se nije digao (HTTP 000) — vidi ~/dsh/dsh-web.log'
	exit 1
fi
# Port odgovara, ali to moze biti ISTI proces koji nikad nije ugasen.
if [ "$same" = 1 ]; then
	say "[x] port odgovara, ali PID je isti (${OLD_PIDS}) — dsh nije restartovan"
	log "NEUSPEH: HTTP=$code ali isti PID ${OLD_PIDS} — relanc se nije dogodio"
	notify "restart nije uspeo: isti PID ${OLD_PIDS}"
	exit 1
fi

# Podsetnik na prekinute sesije — da se ne traze rucno u sidebaru.
if [ -s "$PREKO" ]; then
	say ""
	say "Prekinute sesije pre restarta ($aktivnih) — otvori ih i klikni „try again”:"
	while IFS="$(printf '\t')" read -r sid ws; do
		[ -n "$sid" ] || continue
		say "  $sid"
		say "     workspace: $ws"
	done <"$PREKO"
fi

# ── NASTAVI PREKINUTE SESIJE ──────────────────────────────────────────────
# Sesije se posle restarta NE nastavljaju same — dsh ih samo ucita kao
# istoriju, a turn koji je bio u toku ostane `aborted/disposed`. Zato se ovde
# posalje „try again" u svaku sesiju koja je bila aktivna pre gasenja.
# Uslovi (svi moraju da prodju):
#   • lock je bio osvezen <15 min pre restarta (vec zapisan u $PREKO),
#   • zadnji turn te sesije se zavrsio sa `aborted` + `disposed` (dakle BAS
#     ga je nas restart prekinuo, a ne korisnik ili greska).
# Salje se kroz `prompt-session` rutu (isti put koji koristi message-session).
RESUME="${RESTART_RESUME:-1}"
if [ "$RESUME" = 1 ] && [ -s "$PREKO" ]; then
	say ""
	say "Nastavljam sesije koje je restart prekinuo…"
	while IFS="$(printf '\t')" read -r sid ws; do
		[ -n "$sid" ] || continue
		logf=$(find "$H/.dsh/sessions" -type d -name "$sid" -exec ls -d {}/session.v4.jsonl.zstd \; 2>/dev/null | head -1)
		if [ -z "$logf" ] || [ ! -f "$logf" ]; then
			say "  $sid — nema loga, preskacem"
			continue
		fi
		# Prekid od naseg restarta ima OBLIK `aborted` + `disposed` (proces je
		# odbacen pri gasenju). `interrupted` i `aborted/user` su korisnikovi
		# prekidi — njih NE nastavljamo. Gleda se zadnjih 200 linija, jer
		# izmedju turn/end i kraja loga ume biti i po 100+ dogadjaja.
		prekinut=$(zstd -dc "$logf" 2>/dev/null | tail -200 \
			| grep -c '"kind":"aborted","reason":{"kind":"disposed"' || true)
		if [ "${prekinut:-0}" -eq 0 ]; then
			say "  $sid — turn nije prekinut restartom, preskacem"
			continue
		fi
		resp=$(curl -s --max-time 20 -X POST -H 'content-type: application/json' \
			--data-binary "{\"sessionId\":\"$sid\",\"text\":\"try again\",\"mode\":\"queue\"}" \
			"http://127.0.0.1:3081/composer-extras/api/prompt-session" 2>/dev/null)
		case "$resp" in
			*'"ok":true'*) say "  $sid — poslato „try again”" ; log "resume: $sid OK" ;;
			*) say "  $sid — NIJE prihvaceno: ${resp:0:80}" ; log "resume: $sid FAIL ${resp:0:120}" ;;
		esac
	done <"$PREKO"
fi

say "[ok] dsh je živ (HTTP $code), novi PID ${NEW_PIDS:-?} (stari ${OLD_PIDS:-nema})"
log "OK: HTTP=$code, novi PID ${NEW_PIDS:-?} (stari ${OLD_PIDS:-nema})"
notify "dsh je živ (HTTP $code), PID ${NEW_PIDS:-?}"
exit 0
