#!/data/data/com.termux/files/usr/bin/bash
# message-session — pošalji tekst u DRUGU dsh sesiju preko loopback rute.
#
# Jedini put: POST /composer-extras/api/prompt-session  (plugin dsh-composer-extras)
#   {sessionId, text, mode} -> {ok, value:{sessionId, accepted, mode, model}}
#
# Zašto session ID je OBAVEZAN argument (2026-11-15): prvi put je sesija
# pronađena GREPOM po logovima. To je pogađanje — ako se u međuvremenu jedna
# sesija završi a druga počne, poruka ode pogrešnoj. Zato ovde nema nikakvog
# "pronađi sesiju": ID daje korisnik, a skripta PRE slanja ispiše ŠTA je u toj
# sesiji (naslov, cwd, broj turn-ova, poslednja aktivnost) da se vidi da je
# promašen ID. Sa `--check` se samo prikaže, bez slanja.
#
# Usage:
#   message-session.sh <sessionId> [opcije] <text-file>
#   message-session.sh <sessionId> "tekst poruke"
#   message-session.sh <sessionId> --check
#
# Opcije:
#   --check          samo prikaži identitet sesije, NE šalji
#   --queue          stavi poruku u RED za sledeći turn (default je --steer)
#   --force          pošalji i ako je ID ista sesija kao pošiljalac
#   --yes            ne pitaj potvrdu (obavezno kad nema TTY, npr. iz agenta)
#   --from <id>      ID sesije POŠILJAOCA (default: $DSH_SESSION_ID) — samo za potvrdu teksta
#   -h               pomoć
#
# STEER vs QUEUE (default STEER, odluka 2026-11-15):
#   `steer` -> `agent.steer(message)` -> `send(msg, "next-step", wakeup=true)`.
#     Ako sesija TRENUTNO radi turn, poruka ulazi u SLEDEĆI KORAK istog turna —
#     cilj odmah vidi instrukciju i ne mora da završi započeto. Ako sesija
#     MIRUJE, `wakeup=true` poziva `wakeDriver()`, koji otvara novi turn i
#     odmah je obrađuje (provereno u dsh-agent-loop: wakeDriver radi
#     `while (await this.turn())`). Dakle steer NIKAD ne "izvisi".
#   `queue` -> `agent.followup(message)` -> `send(msg, "next-turn", wakeup=true)`.
#     Poruka se obrađuje TEK posle celog tekućeg turna; koristi se kad poruka
#     sme da čeka (npr. "kad završiš, javi mi").
#   Zato je default steer: želja je da druga sesija ODMAH zna da treba nešto da
#   izmeni. Queue je izuzetak i traži se eksplicitno.
#
# Exit: 0 poslato (ili --check uspeo), 1 greška, 2 loši argumenti, 3 odustalo.
set -uo pipefail

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
WEB_URL="${DSH_WEB_URL:-http://127.0.0.1:3081}"
SESS_DIR="$DSH_HOME_DIR/sessions"

usage() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }

die() { printf 'message-session: %s\n' "$1" >&2; exit "${2:-2}"; }

SID=""
MODE="steer"
CHECK=0
FORCE=0
YES=0
FROM="${DSH_SESSION_ID:-}"
SRC=""

while [ $# -gt 0 ]; do
	case "$1" in
		--check) CHECK=1; shift ;;
		--queue) MODE="queue"; shift ;;
		--force) FORCE=1; shift ;;
		--yes|-y) YES=1; shift ;;
		--from) FROM="${2:?--from traži id}"; shift 2 ;;
		-h|--help) usage; exit 0 ;;
		-*) die "nepoznata opcija: $1" 2 ;;
		*)
			if [ -z "$SID" ]; then SID="$1"; shift
			elif [ -z "$SRC" ]; then SRC="$1"; shift
			else die "višak argument: $1" 2
			fi ;;
	esac
done

[ -n "$SID" ] || die "nema session ID-ja (vidi -h)" 2
case "$SID" in
	session-*) ;;
	*) die "session ID mora počinjati sa 'session-': $SID" 2 ;;
esac

# ── identitet sesije (naslov/cwd/turn-ovi) iz njenog JSONL loga ─────────────
# Sesije su pod ~/.dsh/sessions/<workspace-slug>/<sessionId>/*.jsonl.zstd.
# Naslov je `session/title` event, u `data.title`.
session_info() {
	SID="$1" python3 - <<'PY'
import json, glob, os, subprocess, sys, time
sid = os.environ["SID"]
base = os.path.expanduser("~/.dsh/sessions")
hits = glob.glob(os.path.join(base, "*", sid, "*.jsonl.zstd"))
if not hits:
    print("FOUND=0")
    sys.exit(0)
f = max(hits, key=os.path.getmtime)
title = None
cwd = None
turns = 0
model = None
try:
    raw = subprocess.run(["zstdcat", f], capture_output=True, text=True, timeout=45).stdout
except Exception:
    raw = ""
for line in raw.splitlines():
    try:
        o = json.loads(line)
    except Exception:
        continue
    t = o.get("type")
    d = o.get("data") or {}
    if t == "session/title" and isinstance(d.get("title"), str) and d["title"].strip():
        title = d["title"].strip()
    elif t == "session" and cwd is None:
        cwd = o.get("cwd") or d.get("cwd")
    elif t == "turn/end":
        turns += 1
    elif t == "model/selection" and isinstance(d.get("model"), str):
        model = f'{d.get("provider")}/{d["model"]}'
    elif t == "model/selection" and isinstance(o.get("model"), str):
        model = f'{o.get("provider")}/{o["model"]}'
mt = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(f)))
print("FOUND=1")
print("TITLE=%s" % (title or ""))
print("CWD=%s" % (cwd or ""))
print("TURNS=%s" % turns)
print("MODEL=%s" % (model or ""))
print("MTIME=%s" % mt)
print("PATH=%s" % f)
PY
}

info="$(session_info "$SID")"
if ! printf '%s\n' "$info" | grep -q '^FOUND=1'; then
	printf 'message-session: sesija %s NE POSTOJI (nema loga u %s)\n' "$SID" "$SESS_DIR" >&2
	printf '  ID mora biti tačan; proveri u GUI-ju ili u sidebar-u.\n' >&2
	exit 1
fi
getf() { printf '%s\n' "$info" | sed -n "s/^$1=//p" | head -1; }
S_TITLE="$(getf TITLE)"; S_CWD="$(getf CWD)"; S_TURNS="$(getf TURNS)"
S_MODEL="$(getf MODEL)"; S_MTIME="$(getf MTIME)"

printf 'poruka ide sesiji:\n'
printf '  id      : %s\n' "$SID"
[ -n "$S_TITLE" ] && printf '  naslov  : %s\n' "$S_TITLE"
[ -n "$S_CWD" ]   && printf '  cwd     : %s\n' "$S_CWD"
[ -n "$S_MODEL" ] && printf '  model   : %s\n' "$S_MODEL"
printf '  turn-ova: %s   poslednja aktivnost: %s\n' "$S_TURNS" "$S_MTIME"
if [ -n "$FROM" ]; then
	printf '  pošiljalac: %s\n' "$FROM"
	if [ "$FROM" = "$SID" ] && [ "$FORCE" != 1 ]; then
		printf '\n[x] to je OVA sesija (--from == ID). Za slanje sebi koristi --force.\n' >&2
		exit 3
	fi
fi

if [ "$CHECK" = 1 ]; then
	printf '\n(--check: ništa nije poslato)\n'
	exit 0
fi

has_text() { [ -n "${1:-}" ]; }

if ! has_text "${SRC:-}"; then
	die "nema teksta poruke (drugi argument: string ili putanja do fajla)" 2
fi

# Tekst: ili fajl ili literalni string.
if [ -f "$SRC" ]; then
	TEXT_FILE="$SRC"
elif [ "$SRC" = "-" ]; then
	TMP="$(mktemp "${TMPDIR:-$HOME/.cache}/msg-session.XXXXXX")"
	cat > "$TMP" || die "ne mogu da pročitam stdin" 1
	TEXT_FILE="$TMP"
else
	TMP="$(mktemp "${TMPDIR:-$HOME/.cache}/msg-session.XXXXXX")"
	printf '%s' "$SRC" > "$TMP" || die "ne mogu da upišem privremeni fajl" 1
	TEXT_FILE="$TMP"
fi

[ -s "$TEXT_FILE" ] || die "tekst poruke je prazan" 2

# Potvrda se traži samo kad je interaktivan TTY i nije --yes: skripta se često
# zove iz agenta, gde nema koga da pita.
if [ "$YES" != 1 ] && [ -t 0 ]; then
	printf '\nposalji %s bajtova? [y/N] ' "$(wc -c <"$TEXT_FILE")"
	read -r ans
	case "$ans" in y|Y|yes|YES) ;; *) printf 'odustao\n'; exit 3 ;; esac
fi

MS_URL="$WEB_URL/composer-extras/api/prompt-session" \
MS_SID="$SID" \
MS_MODE="$MODE" \
MS_TEXT_FILE="$TEXT_FILE" \
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
url = os.environ["MS_URL"]
sid = os.environ["MS_SID"]
mode = os.environ["MS_MODE"]
text = open(os.environ["MS_TEXT_FILE"], encoding="utf-8").read()
body = json.dumps({"sessionId": sid, "text": text, "mode": mode}).encode("utf-8")
req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8", "replace"))
except urllib.error.HTTPError as e:
    raw = e.read().decode("utf-8", "replace")
    try:
        err = json.loads(raw).get("error") or {}
    except Exception:
        err = {"code": "http-%s" % e.code, "message": raw[:300]}
    print("FAIL: %s: %s" % (err.get("code"), err.get("message")))
    sys.exit(1)
except Exception as e:
    print("FAIL: %s" % e)
    sys.exit(1)
v = data.get("value") or {}
if not data.get("ok") or not v.get("accepted"):
    print("FAIL: %s" % json.dumps(data.get("error"), ensure_ascii=False))
    sys.exit(1)
print("OK poslato %s (mode=%s)" % (v.get("sessionId"), v.get("mode")))
PY
rc=$?
if [ -n "${TMP:-}" ] && [ -f "${TMP:-}" ]; then rm -f "$TMP"; fi
exit $rc
