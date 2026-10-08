#!/data/data/com.termux/files/usr/bin/bash
# restore-patches.sh — vrati ~/dsh skripte iz Downloads restore foldera i
# ponovo primeni zakrpe na dsh instalaciju.
#
# Koristi se kad app prestane da radi, kad `npm install -g @deepseek-ai/dsh`
# pregazi node_modules, ili posle reinstalacije telefona.
#
#   bash ~/dsh/restore-patches.sh --check   # samo prikazi, nista ne menja
#   bash ~/dsh/restore-patches.sh           # primeni
#
# Izvor je arhiva u ~/storage/shared/Download: `DSH-Restore` (bez datuma, od
# 2026-10-08); razume i stari `DSH-Restore-<datum>` ako je ostao od ranije.
#
# NE dira tajne (API kljuceve) — za to vidi restore.sh u korenu foldera.

set -uo pipefail

DL="${DSH_RESTORE_DL:-/storage/emulated/0/Download}"
SRC="${DSH_RESTORE_SRC:-}"
if [ -z "$SRC" ]; then
  # Prvo arhiva bez datuma (2026-10-08+), pa stari datumski folder ako postoji.
  if [ -d "$DL/DSH-Restore/dsh" ]; then
    SRC="$DL/DSH-Restore/dsh"
  else
    newest="$(ls -d "$DL"/DSH-Restore-*/ 2>/dev/null | sort | tail -1)"
    SRC="${newest%/}/dsh"
  fi
fi
DEST="$HOME/dsh"
# Skripte koje se cesto menjaju — ovo je ono sto `restore-patches.sh` vraca.
# (Ostale fajlove iz ~/dsh vraca `restore.sh` iz korena arhive.)
FILES="patch-android-dsh.py gemini-catalog-update.py dsh-rescue.sh dsh-update.sh compat-scan.mjs \
no-hardlink.cjs dsh-url.sh cache-report.py session-turn-state.py resume-after-restart.sh \
.restart-after-update.sh make-restore-archive.sh"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

if [ ! -d "$SRC" ]; then
  echo "  [x] nema $SRC — je li folder na mestu?" >&2
  exit 1
fi

mkdir -p "$DEST"

echo
echo "=== restore-patches $([ "$CHECK" = 1 ] && echo '(CHECK)' || echo '(PRIMENA)') ==="
echo "izvor: $SRC"
echo
echo "1. skripte -> $DEST"
for f in $FILES; do
  if [ ! -f "$SRC/$f" ]; then
    echo "  [!] nema u izvoru: $f"; continue
  fi
  if [ -f "$DEST/$f" ] && cmp -s "$SRC/$f" "$DEST/$f"; then
    echo "  [ok] nepromenjen: $f"; continue
  fi
  if [ "$CHECK" = 1 ]; then
    echo "  [dry] kopirao bi: $f"; continue
  fi
  cp "$SRC/$f" "$DEST/$f" && chmod 700 "$DEST/$f" && echo "  [ok] $f"
done

echo
echo "2. zakrpe na dsh instalaciju"
if [ "$CHECK" = 1 ]; then
  python3 "$DEST/patch-android-dsh.py" --check 2>&1 | sed 's/^/  /'
  python3 "$DEST/gemini-catalog-update.py" 2>&1 | sed 's/^/  /'
else
  python3 "$DEST/patch-android-dsh.py" 2>&1 | sed 's/^/  /'
  python3 "$DEST/gemini-catalog-update.py" 2>&1 | sed 's/^/  /'
fi

echo
echo "3. provera instalirane zakrpe"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
T="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
if grep -q "android-cache-slot-fix" "$T" 2>/dev/null; then
  if grep -q "findLast((node) => node.text" "$T"; then
    echo "  [ok] cache-slot aktivna (findLast varijanta)"
  else
    echo "  [!] cache-slot prisutna ali STARA (find) — pokreni: python3 ~/dsh/patch-android-dsh.py (3b je sada tu, sa obe varijante originala)"
  fi
else
  echo "  [x] cache-slot NIJE u instalaciji"
fi

echo
echo "Sledeci korak: restartuj dsh da zakrpe stupe na snagu."
echo "  pkill -f 'dsh/lib/bin[.]js' && ~/.local/bin/dsh-termux"
