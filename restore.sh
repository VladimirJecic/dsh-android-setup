#!/data/data/com.termux/files/usr/bin/bash
# restore.sh — vrati DSH setup na Termux/Android iz ovog foldera.
#
#   bash restore.sh --dry-run     # samo prikazi sta bi uradio
#   bash restore.sh               # primeni
#
# Ne dira TAJNE (API kljuceve) — njih unosis sam, vidi korak 9 na kraju.
# Idempotentna je: bezbedno je pokrenuti je vise puta.
#
# Pretpostavka: `@deepseek-ai/dsh` je vec instaliran globalno
# (NODE_OPTIONS="--max-old-space-size=4096" npm install -g @deepseek-ai/dsh).
# Ako nije, skripta to prijavi i stane.

set -uo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
H="$HOME"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
DSH_BIN="$PREFIX/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

ok=0; warn=0; err=0
say()  { printf '%s\n' "$*"; }
good() { say "  [ok] $*"; ok=$((ok+1)); }
bad()  { say "  [x]  $*"; err=$((err+1)); }
note() { say "  [!]  $*"; warn=$((warn+1)); }

do_run() {
  if [ "$DRY" = 1 ]; then say "  [dry] $*"; else eval "$@"; fi
}

# Bezbedno kopiranje: napravi .bak samo ako se sadrzaj razlikuje.
copy_in() { # $1 = izvor, $2 = odrediste
  local src="$1" dst="$2"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    good "nepromenjen: ${dst#$H/}"
    return 0
  fi
  if [ -f "$dst" ]; then
    do_run "cp -p '$dst' '$dst.bak-$(date +%Y%m%d-%H%M%S)'"
  fi
  do_run "mkdir -p '$(dirname "$dst")'"
  if do_run "cp '$src' '$dst'"; then good "${dst#$H/}"; else bad "${dst#$H/}"; fi
}

say "=== DSH restore ($([ "$DRY" = 1 ] && echo DRY-RUN || echo PRIMENA)) ==="
say "arhiva: $SRC"
say

say "0. provera preduslova"
DSH_VERSION="0.2.0-rc.2"
KOFFI_VERSION="3.3.2"

# Instaliraj dsh ako ga nema — TESTIRANI 0.2.x protokol.
# `npm install -g @deepseek-ai/dsh` na 0.2.x pada pre ijednog paketa: dsh-fs-local
# pinuje TAČNO koffi@3.1.1, a taj paket nema @koromix/koffi-android-arm64 (android
# grana postoji tek od 3.2.1), pa cnoke prevodi iz izvora i puca na Bionicu
# (statx). Zato: instalacija bez skripti -> koffi sa prebuildom -> npm rebuild.
install_dsh() {
  local root="$PREFIX/lib/node_modules/@deepseek-ai/dsh"
  local scratch="$H/.dsh/tmp/dsh-restore-koffi"
  say "  [i] instalacija @deepseek-ai/dsh@$DSH_VERSION (bez install skripti)"
  do_run "npm install -g --ignore-scripts --no-audit --no-fund --prefer-online '@deepseek-ai/dsh@$DSH_VERSION'" || return 1
  say "  [i] koffi $KOFFI_VERSION (android-arm64 prebuild)"
  do_run "rm -rf '$scratch'" && do_run "mkdir -p '$scratch'"
  do_run "printf '{\"name\":\"koffi-src\",\"private\":true,\"version\":\"0.0.0\"}\n' > '$scratch/package.json'"
  do_run "npm install --prefix '$scratch' --ignore-scripts --no-audit --no-fund --prefer-online 'koffi@$KOFFI_VERSION'" || return 1
  do_run "rm -rf '$root/node_modules/koffi'"
  do_run "cp -a '$scratch/node_modules/koffi' '$root/node_modules/koffi'"
  do_run "mkdir -p '$root/node_modules/@koromix'"
  do_run "cp -a '$scratch/node_modules/@koromix/koffi-android-arm64' '$root/node_modules/@koromix/'"
  do_run "rm -rf '$scratch'"
  say "  [i] npm rebuild (node-pty i ostali native delovi)"
  do_run "npm rebuild --global --loglevel=error" || return 1
  [ -f "$root/node_modules/@koromix/koffi-android-arm64/android_arm64/koffi.node" ] || return 1
  [ -f "$root/node_modules/node-pty/build/Release/pty.node" ] || return 1
  return 0
}

if [ -f "$DSH_BIN" ]; then
  good "dsh instaliran: $(node -p "require('$PREFIX/lib/node_modules/@deepseek-ai/dsh/package.json').version" 2>/dev/null)"
else
  note "nema $DSH_BIN — instaliram @deepseek-ai/dsh@$DSH_VERSION (0.2.x protokol)"
  if [ "$DRY" = 1 ]; then
    say "  [dry] npm install -g --ignore-scripts @deepseek-ai/dsh@$DSH_VERSION"
    say "  [dry] + koffi@$KOFFI_VERSION (android-arm64 prebuild) + npm rebuild"
  elif install_dsh; then
    good "dsh instaliran: $DSH_VERSION (koffi $KOFFI_VERSION + pty.node)"
  else
    bad "instalacija nije uspela — ručno: vidi README-RESTORE.md (sekcija o koffi zamci)"
    say
    say "Prekidam (nema smisla dalje)."
    exit 1
  fi
fi
for b in node npm python3; do
  command -v "$b" >/dev/null 2>&1 && good "$b" || bad "$b nije na PATH"
done
command -v rg >/dev/null 2>&1 && good "rg (ripgrep)" || bad "nema rg — pkg install ripgrep (bez sistemskog rg glob/grep alati ne rade ni sa shim-om)"
say

say "1. ~/dsh skripte"
do_run "mkdir -p '$H/dsh'"
DSH_FILES="patch-android-dsh.py gemini-catalog-update.py dsh-rescue.sh dsh-update.sh \
compat-scan.mjs dsh-url.sh no-hardlink.cjs restore-patches.sh cache-report.py \
session-turn-state.py resume-after-restart.sh preset-compaction-sync.py \
make-restore-archive.sh .restart-after-update.sh"
for f in $DSH_FILES; do
  [ -f "$SRC/dsh/$f" ] || { note "nema u arhivi: $f"; continue; }
  copy_in "$SRC/dsh/$f" "$H/dsh/$f"
  do_run "chmod 700 '$H/dsh/$f'"
done
for f in DSH-Termux-Kompletno-Uputstvo.md PRAVILA-DSH.md UPUTSTVO-strelice.md UPUTSTVO-dodatak-dugmad.md; do
  [ -f "$SRC/$f" ] && copy_in "$SRC/$f" "$H/dsh/$f"
done
say

say "2. lokalni pluginovi"
# Svi lokalni (ne-npm) pluginovi iz `profile/package.json` -> `dsh.profile.bundles`.
# Novi plugin se dodaje u ovaj spisak (i u make-restore-archive.sh, i u
# patch-android-dsh.py koji ih drži u `bundles` na živom sistemu).
for plugin in dsh-composer-extras dsh-chat-jump-arrows; do
  do_run "mkdir -p '$H/dsh/$plugin'"
  for f in client.js index.js package.json cordis.patch.yml; do
    copy_in "$SRC/dsh/$plugin/$f" "$H/dsh/$plugin/$f"
  done
done
say

say "3. launcher"
copy_in "$SRC/bin/dsh-termux" "$H/.local/bin/dsh-termux"
do_run "chmod 700 '$H/.local/bin/dsh-termux'"

# bash funkcija `dsh` (bez nje se poziva /usr/bin/dsh i pukne)
MARKER='dsh() { command "$HOME/.local/bin/dsh-termux" "$@"; }'
if grep -qF "$MARKER" "$H/.bashrc" 2>/dev/null; then
  good "bash funkcija 'dsh' vec u ~/.bashrc"
else
  do_run "printf '\n%s\n' '$MARKER' >> '$H/.bashrc'"
  good "dodata bash funkcija 'dsh'"
fi
say

say "4. profil: bundles + cordis.patch.yml"
copy_in "$SRC/profile/package.json"      "$H/.dsh/profiles/web/package.json"
copy_in "$SRC/profile/cordis.patch.yml"  "$H/.dsh/profiles/web/cordis.patch.yml"
# settings.yaml je UKINUT (2026-10-06): ~/.dsh/settings.yaml je migriran u
# settings.yaml.imported, a `agent-default-model` + `ui-onboarding` sada žive u
# profile/cordis.patch.yml. Vraćanje starog settings.yaml bi vratilo pogrešan
# model (deepseek-flash) preko gemini podrazumevanog.
say

say "4c. AGENTS.md (user-global uputstva — dobija ih SVAKA sesija)"
copy_in "$SRC/dsh-home/AGENTS.md" "$H/.dsh/AGENTS.md"

say "5. symlink plugina u profil"
do_run "mkdir -p '$H/.dsh/profiles/node_modules' '$H/.dsh/profiles/web/node_modules'"
for plugin in dsh-composer-extras dsh-chat-jump-arrows; do
  do_run "ln -sfn '$H/dsh/$plugin' '$H/.dsh/profiles/node_modules/$plugin'"
  do_run "ln -sfn '$H/dsh/$plugin' '$H/.dsh/profiles/web/node_modules/$plugin'"
  good "$plugin -> ~/dsh/$plugin (oba store-a)"
done
say

say "6. skills (svi, sa prilozima)"
for s in "$SRC"/skills/*/; do
  [ -d "$s" ] || continue
  name="$(basename "$s")"
  do_run "mkdir -p '$H/.dsh/skills/$name'"
  # ceo skill, ne samo SKILL.md — neki nose i skripte (branch.sh, uplati.py, …)
  do_run "cp -r '$s'./* '$H/.dsh/skills/$name'/"
  good "skill: $name"
done
say

say "7. dsh-context plugin (pnpm, trazi mrezu)"
if [ -d "$H/.dsh/profiles/web/node_modules/dsh-context" ] || [ -d "$H/.dsh/profiles/node_modules/dsh-context" ]; then
  good "dsh-context vec instaliran"
elif [ "$DRY" = 1 ]; then
  say "  [dry] ~/.local/bin/dsh-termux plugin --profile web add dsh-context"
else
  if "$H/.local/bin/dsh-termux" plugin --profile web add dsh-context >/dev/null 2>&1; then
    good "dsh-context instaliran"
  else
    note "dsh-context nije instaliran — pokreni rucno: dsh plugin --profile web add dsh-context"
  fi
fi
say

say "8. Android zakrpe + model katalog"
if [ "$DRY" = 1 ]; then
  say "  [dry] python3 ~/dsh/patch-android-dsh.py --pwa-samesite"
  say "  [dry] python3 ~/dsh/gemini-catalog-update.py"
else
  python3 "$H/dsh/patch-android-dsh.py" --pwa-samesite | sed 's/^/    /' || note "zakrpe nisu prosle u celosti"
  python3 "$H/dsh/gemini-catalog-update.py" | sed 's/^/    /' || note "gemini katalog nije podesen"
fi
say

say "9. TAJNE — rucno (nikad se ne cuvaju u arhivi)"
say "  1) napravi ~/.config/dsh-secrets.env (mode 600) sa:"
say "       export DEEPSEEK_API_KEY='...'"
say "       export GOOGLE_API_KEY='...'      # Gemini"
say "       export GROQ_API_KEY='...'        # opciono"
say "       export HF_READ='...' HF_FULL='...'  # opciono"
say "     pa: chmod 600 ~/.config/dsh-secrets.env"
say "  2) kljuc se NIKAD ne upisuje u ~/.dsh/.credentials.yaml — taj fajl treba"
say "     da sadrzi SAMO record 'client-connection/browser-session' (auth secret)."
say
say "=== gotovo: ok=$ok warn=$warn err=$err ==="
if [ "$DRY" != 1 ]; then
  say
  say "Sledece: pokreni dsh i uzmi URL"
  say "  ~/dsh/dsh-url.sh"
  say "(restartuje dsh, ispise tokenizovani URL i posalje ga u 'DSH 手机版' aplikaciju)"
  say
  say "10. AZURIRANJE — kontrolisano i ISKLJUCIVO RUCNO"
  say "  auto-update je ukinut 2026-09-29 (nema cron-a, nema pozadinske provere)."
  say "  verzije se ispisuju pri svakom startu; update pokreces sam:"
  say "    ~/dsh/dsh-update.sh --check     # samo prijava (instalirano vs npm latest)"
  say "    ~/dsh/dsh-update.sh             # sandbox -> validacija -> atomska zamena (10 faza)"
  say "    ~/dsh/dsh-update.sh --rollback  # vrati prethodnu verziju"
  say
  say "  Vazno za 0.2.x: `npm install -g` sam NE prolazi (koffi bez android"
  say "  prebuild-a). dsh-update.sh faze 4b/4c to resavaju — detalji:"
  say "  README-RESTORE.md i sam dsh-update.sh (--dry-run)."
  say
  say "11. AKTIVACIJA posle update-a (novu verziju ucitava NOVI proces)"
  say "  restart preko launcher-a:"
  say "    pkill -f 'dsh/lib/bin[.]js' && ~/.local/bin/dsh-termux"
  say "  ili odlozeno (ceka mirnocu, proverava HTTP i sam radi rollback ako"
  say "  se nova verzija ne digne):"
  say "    setsid nohup env IDLE=120 bash ~/dsh/.restart-after-update.sh >/dev/null 2>&1 &"
fi
exit $(( err > 0 ? 1 : 0 ))
