#!/data/data/com.termux/files/usr/bin/bash
# branch-into-new-session — prosledi zadatak u NOVU (praznu) dsh sesiju preko
# web servera, u ISTOM workspace-u (GUI grupa) kao pozivajuca sesija.
#
# Ne deli istoriju i NE odgovara na zadatak u pozivajucoj sesiji — samo ga
# prosledi i javi da je nova sesija napravljena.
#
# Upotreba:
#   branch.sh [opcije] <prompt-file>
#
# Opcije:
#   -s <id>      id pozivajuce sesije (default: $DSH_SESSION_ID)
#   -c <dir>     cwd (default: cwd iz zaglavlja pozivajuce sesije)
#   -t <naslov>  naslov (samo za log; nova sesija se sama titluje iz prompta)
#   --model p/m  model za PRVI prompt (default: google/gemini-flash-lite-latest)
#   --no-smart   ne diraj model — sesija krece na profilnom default modelu
#   --dry-run    ispisi sta bi poslao, bez POST-a
#   --force      dozvoli grananje IZ sesije koja je i sama branchovana
#   -h           pomoc
#
# Ruta: POST /composer-extras/api/branch-session  (plugin dsh-composer-extras)
#       {prompt, parentSession, cwd, smart, provider, model}
#       -> {sessionId, workspaceId, group, smart, model}
#
# ZASTITA OD PONOVNOG GRANANJA: server upise oznaku u
# $LOGDIR/children/<sessionId> za svaku sesiju koju napravi. Ako je
# pozivajuca sesija (PARENT / $DSH_SESSION_ID) tako oznacena, ova skripta
# ODBIJA da grana dalje — 2026-10-07 se nova sesija sama ponovo branchovala
# (model je u njoj pozvao ovaj skill), pa je korisnikov tekst ostao u
# medjusesiji. `--force` zaobilazi proveru.
#
# SMART START: prvi (mali) prompt ide Geminiju (flash-lite) da se ne angazuje
# DeepSeek ako zadatak moze da se zavrsi jeftino. Ruta to radi preko
# sessionController.selectModel, koja vazi za SLEDECI request.
# Posle izmene plugina treba restart dsh-a da se ruta ucita.
set -uo pipefail

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
SESS_DIR="$DSH_HOME_DIR/sessions"
WEB_URL="${DSH_WEB_URL:-http://127.0.0.1:3081}"
LOGDIR="$HOME/dsh/.branch-into-new-session"

PARENT="${DSH_SESSION_ID:-}"
CWD=""
TITLE=""
SMART=1
MODEL="google/gemini-flash-lite-latest"
DRY=0
FORCE=0

usage() { sed -n '2,35p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -s) PARENT="${2:?branch.sh: -s trazi id}"; shift 2 ;;
    -c) CWD="${2:?branch.sh: -c trazi dir}"; shift 2 ;;
    -t) TITLE="${2:?branch.sh: -t trazi naslov}"; shift 2 ;;
    --model) MODEL="${2:?branch.sh: --model trazi provider/model}"; shift 2 ;;
    --no-smart) SMART=0; shift ;;
    --dry-run) DRY=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "branch.sh: nepoznata opcija: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done
PROMPT_FILE="${1:-}"
[ -n "$PROMPT_FILE" ] && [ -f "$PROMPT_FILE" ] || { echo "branch.sh: daj putanju do fajla sa zadatkom" >&2; exit 2; }

# cwd pozivajuce sesije (fallback ako nema workspace-a) iz zaglavlja sesije
parent_cwd() {
  [ -n "$PARENT" ] || return 1
  local f line
  f="$(ls -1 "$SESS_DIR"/*/"$PARENT"/session*.jsonl.zstd 2>/dev/null | head -1)"
  [ -n "$f" ] && [ -f "$f" ] || return 1
  line="$(zstdcat "$f" 2>/dev/null | head -1)"
  [ -n "$line" ] || return 1
  printf '%s' "$line" | python3 -c 'import json,sys; print(json.loads(sys.stdin.readline()).get("cwd") or "")' 2>/dev/null
}
if [ -z "$CWD" ]; then CWD="$(parent_cwd || true)"; fi
if [ -n "$CWD" ]; then CWD="$(cd "$CWD" 2>/dev/null && pwd || printf '%s' "$CWD")"; fi

[ -n "$TITLE" ] || TITLE="$(head -n1 "$PROMPT_FILE")"

if [ "$DRY" = 1 ]; then
  echo "DRY-RUN"
  echo "  url    : $WEB_URL/composer-extras/api/branch-session"
  echo "  parent : ${PARENT:-<nema>}"
  echo "  cwd    : ${CWD:-<nema>}"
  echo "  naslov : $TITLE"
  echo "  prompt : $PROMPT_FILE ($(wc -c <"$PROMPT_FILE") B)"
  if [ "$SMART" = 1 ]; then echo "  model  : $MODEL (prvi prompt)"; else echo "  model  : (default profila — --no-smart)"; fi
  exit 0
fi

mkdir -p "$LOGDIR"

# Zaštita od ponovnog grananja: server je za svaku sesiju koju napravi upisao
# oznaku u $LOGDIR/children/<sessionId>. Ako je POZIVAJUCA sesija označena,
# ona je i sama branchovana — grananje iz nje bi napravilo lanac i korisnikov
# tekst bi ostao u medjusesiji (vidi 2026-10-07 u zaglavlju).
CHILD_MARK="$LOGDIR/children/${PARENT:-}"
if [ "$FORCE" != 1 ] && [ -n "$PARENT" ] && [ -f "$CHILD_MARK" ]; then
  echo "FAIL: sesija $PARENT je i sama napravljena branch-om — ne granam je ponovo." >&2
  echo "      oznaka: $(cat "$CHILD_MARK" 2>/dev/null | head -c 200)" >&2
  echo "      (lančano grananje, ako baš hoćeš: --force)" >&2
  exit 3
fi
if [ "$FORCE" = 1 ] && [ -f "$CHILD_MARK" ]; then
  echo "NAPOMENA: --force — granam iz već branchovane sesije $PARENT." >&2
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"

BRANCH_URL="$WEB_URL/composer-extras/api/branch-session" \
BRANCH_PARENT="$PARENT" \
BRANCH_CWD="$CWD" \
BRANCH_PROMPT_FILE="$PROMPT_FILE" \
BRANCH_TITLE="$TITLE" \
BRANCH_SMART="$SMART" \
BRANCH_MODEL="$MODEL" \
BRANCH_LOG="$LOGDIR/branch-$STAMP.log" \
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error, time

url = os.environ["BRANCH_URL"]
parent = os.environ.get("BRANCH_PARENT") or None
cwd = os.environ.get("BRANCH_CWD") or None
title = os.environ.get("BRANCH_TITLE") or ""
log = os.environ.get("BRANCH_LOG") or ""
prompt = open(os.environ["BRANCH_PROMPT_FILE"], encoding="utf-8").read()

smart = os.environ.get("BRANCH_SMART", "1") == "1"
spec = os.environ.get("BRANCH_MODEL", "") or ""
provider = spec.split("/", 1)[0] if "/" in spec else None
model = spec.split("/", 1)[1] if "/" in spec else None
body_obj = {"prompt": prompt, "parentSession": parent, "cwd": cwd, "smart": smart}
if smart and provider and model:
    body_obj["provider"] = provider
    body_obj["model"] = model
body = json.dumps(body_obj).encode("utf-8")
req = urllib.request.Request(url, data=body, headers={"content-type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8", "replace")
    data = json.loads(raw)
except urllib.error.HTTPError as exc:
    raw = exc.read().decode("utf-8", "replace")
    try:
        data = json.loads(raw)
        err = data.get("error")
    except Exception:  # noqa: BLE001
        err = None
    if err is not None:
        print("FAIL: %s" % json.dumps(err, ensure_ascii=False))
    elif exc.code in (404, 405):
        print("FAIL: ruta /composer-extras/api/branch-session nije aktivna (http %s) — restartuj dsh da ucita plugin" % exc.code)
    else:
        print("FAIL http=%s: %s" % (exc.code, raw[:300]))
    sys.exit(1)
except Exception as exc:  # noqa: BLE001
    print("FAIL: %s" % exc)
    sys.exit(1)

if log:
    try:
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"time": time.strftime("%F %T"), "title": title, "parent": parent, "cwd": cwd, "response": data}, ensure_ascii=False) + "\n")
    except OSError:
        pass

if not data.get("ok"):
    print("FAIL: %s" % json.dumps(data.get("error"), ensure_ascii=False))
    sys.exit(1)
value = data.get("value") or {}
sel = value.get("model") or {}
model_txt = ("%s/%s" % (sel.get("provider"), sel.get("model"))) if sel else (
    "default (smart iskljucen)" if value.get("smart") is False else "nije izabran")
extra = (" | modelError=%s" % value.get("modelError")) if value.get("modelError") else ""
print("OK session=%s group=%s historyShared=%s smartModel=%s%s" % (
    value.get("sessionId"), value.get("group") or "(bez grupe)", value.get("historyShared"), model_txt, extra))
PY
