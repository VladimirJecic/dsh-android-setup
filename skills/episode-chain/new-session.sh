#!/data/data/com.termux/files/usr/bin/bash
# new-session.sh — napravi PRAZNU sesiju u istom workspace-u i pošalji joj prompt.
#
# Nova sesija ne deli istoriju (historyShared:false) i dobija samo prosleđeni
# prompt (uz BRANCH_GUARD_TEXT koji joj brani dalje grananje).
#
# Upotreba:
#   new-session.sh <prompt-file> [--cwd DIR] [--parent SESSION_ID]
#
# Ispis:  OK session=session-… group=… historyShared=false model=…/…
# Exit:   0 poslato, 1 greška, 2 loši argumenti.
set -uo pipefail

WEB_URL="${DSH_WEB_URL:-http://127.0.0.1:3081}"
PROMPT_FILE=""; CWD=""; PARENT="${DSH_SESSION_ID:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --cwd) CWD="${2:?--cwd trazi dir}"; shift 2 ;;
    --parent) PARENT="${2:?--parent trazi id}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "new-session.sh: nepoznata opcija: $1" >&2; exit 2 ;;
    *) PROMPT_FILE="$1"; shift ;;
  esac
done
[ -n "$PROMPT_FILE" ] && [ -f "$PROMPT_FILE" ] || { echo "new-session.sh: daj fajl sa promptom" >&2; exit 2; }

NEWSESSION_URL="$WEB_URL/composer-extras/api/branch-session" \
NEWSESSION_PROMPT_FILE="$PROMPT_FILE" \
NEWSESSION_CWD="$CWD" \
NEWSESSION_PARENT="$PARENT" \
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error

url = os.environ["NEWSESSION_URL"]
prompt = open(os.environ["NEWSESSION_PROMPT_FILE"], encoding="utf-8").read()
cwd = os.environ.get("NEWSESSION_CWD") or None
parent = os.environ.get("NEWSESSION_PARENT") or None

# `mode: "new"` = prazna sesija (bez istorije). Bez njega ruta radi fork.
body = {"prompt": prompt, "mode": "new"}
if cwd: body["cwd"] = cwd
if parent: body["parentSession"] = parent
data = json.dumps(body).encode("utf-8")
req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8", "replace")
    out = json.loads(raw)
except urllib.error.HTTPError as exc:
    raw = exc.read().decode("utf-8", "replace")
    try:
        err = json.loads(raw).get("error")
    except Exception:
        err = None
    print("FAIL http=%s: %s" % (exc.code, json.dumps(err, ensure_ascii=False) if err else raw[:300]))
    sys.exit(1)
except Exception as exc:
    print("FAIL: %s" % exc); sys.exit(1)

if not out.get("ok"):
    print("FAIL: %s" % json.dumps(out.get("error"), ensure_ascii=False)); sys.exit(1)
v = out.get("value") or {}
m = v.get("model") or {}
mtxt = ("%s/%s" % (m.get("provider"), m.get("model"))) if m else "profilni default"
extra = (" | modelError=%s" % v["modelError"]) if v.get("modelError") else ""
print("OK session=%s group=%s historyShared=%s model=%s depth=%s%s" % (
    v.get("sessionId"), v.get("group") or "(bez grupe)", v.get("historyShared"), mtxt,
    v.get("delegationDepth", "?"), extra))
PY
