#!/data/data/com.termux/files/usr/bin/bash
# dsh-update.sh — KONTROLISANI, ISKLJUCIVO RUCNI update paketa @deepseek-ai/dsh.
#
# Auto-update je UKINUT 2026-09-29: nema cron zapisa, nema `crond` servisa, nema
# >24h fallback-a u launcheru (~/.local/bin/dsh-termux) i nema pozadinske
# provere bilo koje vrste. Ovaj fajl se pokrece SAMO kada ga covek pozove.
#
# Tok (svaka faza mora da prodje pre sledece):
#   1 lock            — drugi update ne moze da se pokrene uporedo
#   2 verzije         — instalirano vs npm latest (+ sta je trazeno)
#   3 kompatibilnost  — pluginski opsezi prema @deepseek-ai/dsh* (0.x je ostro)
#   4 sandbox         — `npm install --global --prefix` u izolovan direktorijum
#                       (NIKAD u pravi globalni root); layout sa ugnjezdenim
#                       zavisnostima je identican zivoj instalaciji.
#                       Instalira se sa --ignore-scripts (vidi 4b), a
#                       --prefer-online je obavezan: sa bajatim kešom npm ume da
#                       prijavi lazni ETARGET za pakete koji na npm-u postoje.
#   4b koffi          — dsh 0.2.x pinuje TACNO koffi@3.1.1, a android-arm64
#                       prebuild (@koromix/koffi-android-arm64) postoji tek od
#                       3.2.1. Bez njega `cnoke` prevodi iz izvora i na Bionicu
#                       puca (base.cc:2967 — `statx` tamo nije funkcija sa tim
#                       potpisom), pa ceo `npm install` pada. Zato se koffi
#                       zamenjuje verzijom koja IMA prebuild (default 3.3.2), a
#                       sve install skripte se pokrecu tek u 4c. Sve koffi
#                       upotrebe u dsh-u su ionako lazy + win32-only.
#   4c npm rebuild     — pokrece install/postinstall skripte nad VEC razresenim
#                       drvetom (--ignore-scripts ih je preskocio): node-pty
#                       node-gyp build, dsh-subprocess-local spawn-helper,
#                       protobufjs. Bez ovoga node-pty ostane bez pty.node i
#                       terminal alati pucaju u radu.
#   5 zakrpe          — hardlink/dir-fsync/ripgrep/cache-slot/flock/
#                       require-builtin/tool_use/samesite preko
#                       `patch-android-dsh.py --root <sandbox>`
#   6 validacija      — version match, `npm ls`, import mockova, native moduli
#                       (koffi, node-pty), boot smoke test na izolovanom
#                       DSH_HOME i slobodnom portu
#   7 atomska zamena  — rename stare instalacije u backup, pa sandbox na njeno
#                       mesto (isti filesystem => atomicno); profilski symlinkovi
#                       pokazuju na iste putanje, pa prate novu verziju sami
#   8 ciscenje        — sandbox se brise; backup ostaje za --rollback
#
# Bilo koja greska pre faze 7 ostavlja zivu instalaciju NETAKNUTU i brise sandbox.
#
# Upotreba:
#   dsh-update.sh --check              # samo prijava (nista se ne skida)
#   dsh-update.sh                      # update na npm latest
#   dsh-update.sh --version 0.2.0-rc.2 # update/pin na tacno tu verziju
#   dsh-update.sh --no-swap            # sve do validacije, bez diranja instalacije
#   dsh-update.sh --rollback           # vrati poslednji backup
#   dsh-update.sh --force              # nastavi i kad plugin opsezi ne dozvoljavaju
#   --global-root DIR                  # test zamene nad drugim root-om
#   --sandbox DIR                      # izolovan direktorijum (default /tmp pa $TMPDIR)
#
# Env:
#   DSH_UPDATE_KOFFI_VERSION=3.3.2     # koffi sa android-arm64 prebuildom (4b)
#   DSH_UPDATE_SMOKE_HEAP=2048         # heap za boot smoke test
#   DSH_UPDATE_SANDBOX=DIR             # isto kao --sandbox
#
# Log: ~/dsh/update.log (append). Ne rotira se sam.

set -uo pipefail

PKG="@deepseek-ai/dsh"
DSH_DIR="$HOME/dsh"
LOG="$DSH_DIR/update.log"
PATCHER="$DSH_DIR/patch-android-dsh.py"
NO_HARDLINK="$DSH_DIR/no-hardlink.cjs"
LOCKDIR="$HOME/.dsh/.dsh-update-lock"
GLOBAL_ROOT="${PREFIX:-/data/data/com.termux/files/usr}/lib/node_modules/@deepseek-ai"
SANDBOX=""
TARGET=""
DO_SWAP=1
FORCE=0
MODE="update"
KEEP_SANDBOX=0
SMOKE_PORTS="3089 3090 3091 3092"
SMOKE_TIMEOUT=60
# Heap za smoke test: dovoljan za boot, a manji od launcherskih 4096 — u tom
# trenutku telefon vec drzi ziv dsh proces, pa nema smisla traziti maksimum.
SMOKE_HEAP="${DSH_UPDATE_SMOKE_HEAP:-2048}"
# koffi koji IMA @koromix/koffi-android-arm64 prebuild (android grana postoji od
# 3.2.1). Vidi fazu 4b u zaglavlju.
KOFFI_ANDROID_VERSION="${DSH_UPDATE_KOFFI_VERSION:-3.3.2}"

say() { printf '%s\n' "$*"; printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
die() {
  say ""; say "GRESKA: $*"
  cleanup_sandbox
  release_lock
  say "Ziva instalacija je NETAKNUTA. Detalji: $LOG"
  exit 1
}

# --- argumenti ---------------------------------------------------------------
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check)        MODE="check" ;;
    --rollback)     MODE="rollback" ;;
    --version)      shift; TARGET="${1:-}" ;;
    --no-swap)      DO_SWAP=0; KEEP_SANDBOX=1 ;;
    --force)        FORCE=1 ;;
    --global-root)  shift; GLOBAL_ROOT="${1:-}" ;;
    --sandbox)      shift; SANDBOX="${1:-}" ;;
    -h|--help)      awk 'NR > 1 { if ($0 == "set -uo pipefail") exit; print }' "$0"; exit 0 ;;
    *)              say "nepoznat argument: $1"; exit 2 ;;
  esac
  shift
done

DST="$GLOBAL_ROOT/dsh"
# Pointer na poslednji backup zivi UNUTAR globalnog root-a: tako `--rollback`
# uvek gleda isti root koji je update i menjao, a test nad `--global-root`
# ostaje potpuno izolovan od zive instalacije.
BACKUP_POINTER="$GLOBAL_ROOT/.dsh-backup-latest"

# --- sandbox / lock / cleanup ------------------------------------------------
pick_sandbox() {
  [ -n "$SANDBOX" ] && { printf '%s' "$SANDBOX"; return; }
  [ -n "${DSH_UPDATE_SANDBOX:-}" ] && { printf '%s' "$DSH_UPDATE_SANDBOX"; return; }
  # Termux: /tmp postoji ali NIJE nas (mode 0731, vlasnik shell); $TMPDIR jeste.
  for cand in /tmp/dsh-update-sandbox "${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}/dsh-update-sandbox"; do
    parent="$(dirname "$cand")"
    if [ -d "$parent" ] && [ -w "$parent" ]; then printf '%s' "$cand"; return; fi
  done
  printf '%s' "$HOME/.dsh/tmp/dsh-update-sandbox"
}

release_lock() { [ -n "${LOCKDIR:-}" ] && rm -rf "$LOCKDIR" 2>/dev/null; }
trap 'release_lock' EXIT INT TERM

acquire_lock() {
  if mkdir "$LOCKDIR" 2>/dev/null; then
    echo "$$" > "$LOCKDIR/pid"; return 0
  fi
  local other; other="$(cat "$LOCKDIR/pid" 2>/dev/null || echo '')"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
    say "Update je vec u toku (PID $other). Prekidam."
    exit 1
  fi
  say "Uklanjam zastareli lock (PID ${other:-?} ne postoji)."
  rm -rf "$LOCKDIR"
  mkdir "$LOCKDIR" || die "ne mogu da napravim lock $LOCKDIR"
  echo "$$" > "$LOCKDIR/pid"
}

cleanup_sandbox() {
  if [ "${KEEP_SANDBOX:-0}" = 1 ]; then
    [ -n "${SANDBOX:-}" ] && [ -d "$SANDBOX" ] && \
      say "sandbox ZADRZAN (--no-swap): $SANDBOX"
    return 0
  fi
  [ -n "${SANDBOX:-}" ] && [ -d "$SANDBOX" ] && { rm -rf "$SANDBOX"; say "sandbox obrisan: $SANDBOX"; }
  return 0
}

# --- verzije -----------------------------------------------------------------
installed_version() { node -p "require('$DST/package.json').version" 2>/dev/null; }
latest_version()    { timeout 20 npm view "$PKG" version 2>/dev/null | tail -1; }

# --- kompatibilnost ----------------------------------------------------------
# Pluginski paketi u ~/.dsh mogu da traze `^0.1.0-rc.x` na @deepseek-ai/dsh*
# pakete. Caret na 0.x je uzak, pa skok na 0.2.x tiho razvali plugin. Ovde se to
# prijavi PRE skidanja; `--force` je jedini nacin da se nastavi.
compat_report() {
  local target="$1" out
  # Fail-safe: ako skener ne postoji ili ne vrati nista, NE sme se cutke
  # protumaciti kao "nema ogranicenja" (to bi preskocilo kompatibilnost i pustilo
  # update koji razvali pluginove). Vraca se GRESKA, a pozivalac tada zahteva
  # --force.
  if [ ! -f "$DSH_DIR/compat-scan.mjs" ]; then printf 'GRESKA'; return 0; fi
  out="$(node "$DSH_DIR/compat-scan.mjs" "$target" "$HOME/.dsh/profiles" 2>/dev/null)"
  if [ -z "$out" ]; then printf 'GRESKA'; return 0; fi
  printf '%s' "$out"
}

# --- validacioni probe-ovi ---------------------------------------------------
# flock mock se uvozi po APSOLUTNOJ putanji (u sandboxu je jedan modul).
PROBE_PREFIX=".dsh-update-probe"

write_probes() {
  local sb="$1" sbdir="$2"
  mkdir -p "$sb/probe"
  cat > "$sb/probe/flock.mjs" <<'EOF'
const m = await import(process.argv[2]);
await m.tryLockExclusive(0);
console.log("flock mock: tryLockExclusive(0) -> resolve OK");
EOF
  # `@vscode/ripgrep` zivi UGNJEZDEN u dsh/node_modules, pa se bare specifier
  # resolvuje samo iz dsh PAKETA (tacno kao sto ga resolvuje dsh-tool-fs-search).
  # Zato probe ide u sam paket i odmah se brise posle izvrsavanja.
  cat > "$sbdir/$PROBE_PREFIX-ripgrep.mjs" <<'EOF'
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const { rgPath } = await import("@vscode/ripgrep");
if (typeof rgPath !== "string" || !rgPath) { console.error("rgPath nije putanja"); process.exit(1); }
const r = spawnSync(rgPath, ["--no-config", "--version"], { encoding: "utf8" });
if (r.status !== 0) { console.error("rg nije pokrenut:", r.error ?? r.stderr); process.exit(1); }
console.log("ripgrep:", rgPath, "|", r.stdout.split("\n")[0]);
EOF
  # Native moduli koje npm ne isporucuje za Android: koffi (android-arm64
  # prebuild, faza 4b) i node-pty (node-gyp build, faza 4c). Probe stoji u
  # dsh PAKETU, pa se i `koffi` i `node-pty` resolvuju tacno onako kako ih
  # resolvuje sam dsh. Ako paket ne postoji u ovoj verziji, preskace se.
  cat > "$sbdir/$PROBE_PREFIX-native.mjs" <<'EOF'
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let failed = 0;
for (const id of ["koffi", "node-pty"]) {
  let resolved;
  try { resolved = require.resolve(id); }
  catch { console.log(`${id}: paket nema — preskacem`); continue; }
  try {
    require(id);
    console.log(`${id}: ok (${resolved})`);
  } catch (error) {
    console.error(`${id}: NE MOZE da se ucita — ${error.message}`);
    failed = 1;
  }
}
process.exit(failed);
EOF
}

remove_probes() { rm -f "$1/$PROBE_PREFIX"-*.mjs 2>/dev/null; return 0; }

# Dijagnostika za najcesci razlog pada boot-a na Androidu.
native_hint() {
  local log="$1" missing
  missing="$(grep -o "Cannot find module '[^']*\.node'" "$log" 2>/dev/null | head -1)"
  [ -z "$missing" ] && return 0
  say ""
  say "  [!] Nedostaje native dodatak koji npm ne isporucuje za Android:"
  say "      $missing"
  say "      Prenos iz zive instalacije nije pomogao, pa treba rucni rebuild:"
  say "        SB=<sandbox>/lib/node_modules/@deepseek-ai/dsh"
  say "        cd \"\$SB/node_modules/<paket>\" && npx node-gyp rebuild"
  say "      pa ponovi update. Detalji: $LOG"
}

seed_sandbox_home() {
  local h="$1" sbdir="$2"
  rm -rf "$h"
  mkdir -p "$h/profiles/node_modules/@deepseek-ai" "$h/profiles/web/node_modules" "$h/logs"
  # Isti raspored kao zivi profil: symlinkovi na pakete unutar dsh drveta.
  local d
  for d in "$sbdir"/node_modules/@deepseek-ai/*; do
    [ -e "$d" ] || continue
    ln -sfn "$d" "$h/profiles/node_modules/@deepseek-ai/$(basename "$d")"
  done
  ln -sfn "$sbdir" "$h/profiles/node_modules/@deepseek-ai/dsh"
  # Manifest iz zivog profila (samo CITANJE), ali sa bundle-ovima svedenim na
  # @deepseek-ai/*: lokalni dsh-composer-extras se NE ubacuje, da smoke test ne
  # dotakne zivi plugin direktorijum. Ovde se validira dsh PAKET, ne plugin.
  if [ -f "$HOME/.dsh/profiles/web/package.json" ]; then
    node -e '
      const fs = require("node:fs");
      const [src, dst] = process.argv.slice(1);
      const d = JSON.parse(fs.readFileSync(src, "utf8"));
      const p = d.dsh && d.dsh.profile;
      if (p && p.bundles) p.bundles = p.bundles.filter((b) => b.startsWith("@deepseek-ai/"));
      fs.writeFileSync(dst, JSON.stringify(d, null, 2) + "\n");
    ' "$HOME/.dsh/profiles/web/package.json" "$h/profiles/web/package.json" 2>/dev/null || \
      printf '%s\n' '{ "name": "dsh-profile-web", "private": true, "dependencies": {}, "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "patchReload": "live" } } }' \
        > "$h/profiles/web/package.json"
  fi
}

port_free() {
  node -e '
    const net = require("net");
    const s = net.createServer();
    s.once("error", () => process.exit(1));
    s.once("listening", () => s.close(() => process.exit(0)));
    s.listen(Number(process.argv[1]), "127.0.0.1");
  ' "$1" 2>/dev/null
}

pick_port() { local p; for p in $SMOKE_PORTS; do port_free "$p" && { printf '%s' "$p"; return; }; done; }

# Boot smoke test: NOVA instalacija, izolovan DSH_HOME, drugi port.
# Ziv proces na 3081 se ne dira. `exec` u subshell-u znaci da je $! tacno PID
# node procesa (nema setsid fork nedoumice), pa `wait` stvarno pokupi dete.
kill_tree() {
  local pid="$1" sig="${2:-TERM}" i
  for i in 1 2 3; do
    pkill "-$sig" -P "$pid" 2>/dev/null
  done
  kill "-$sig" "$pid" 2>/dev/null
}

smoke_test() {
  local sb="$1" sbdir="$2"
  local port; port="$(pick_port)"
  [ -z "$port" ] && { say "smoke test: nijedan od portova $SMOKE_PORTS nije slobodan"; return 1; }
  local home="$sb/sandbox-home"
  seed_sandbox_home "$home" "$sbdir"

  say "smoke test: boot na portu $port, DSH_HOME=$home"
  ( cd "$sb" && exec env DSH_HOME="$home" \
      DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-danger-full-access}" \
      node --expose-internals --max-old-space-size="$SMOKE_HEAP" \
        --require "$sb/no-hardlink.cjs" "$sbdir/lib/bin.js" web --port "$port" --no-open ) \
      > "$sb/boot.log" 2>&1 &
  local pid=$!

  local waited=0 code=""
  while [ "$waited" -lt "$SMOKE_TIMEOUT" ]; do
    sleep 2; waited=$((waited + 2))
    if ! kill -0 "$pid" 2>/dev/null; then
      say "smoke test: proces je umro posle ${waited}s."
      say "--- boot.log: prvih 25 linija ---"
      head -25 "$sb/boot.log" 2>/dev/null | sed 's/^/    /'
      say "--- boot.log: zadnjih 25 linija ---"
      tail -25 "$sb/boot.log" 2>/dev/null | sed 's/^/    /'
      { echo "=== boot.log (ceo) ==="; cat "$sb/boot.log" 2>/dev/null; } >> "$LOG"
      return 1
    fi
    code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$port/" 2>/dev/null)"
    case "$code" in
      200|301|302|401|403) break ;;
    esac
  done

  kill_tree "$pid" TERM
  local g=0
  while kill -0 "$pid" 2>/dev/null && [ "$g" -lt 10 ]; do sleep 1; g=$((g + 1)); done
  kill_tree "$pid" KILL
  wait "$pid" 2>/dev/null
  if kill -0 "$pid" 2>/dev/null; then
    say "smoke test: [!] proces $pid se nije ugasio — ostavljam trag u $LOG"
    printf '[%s] smoke test orphan PID %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$pid" >> "$LOG"
  fi

  case "$code" in
    200|301|302|401|403) say "smoke test OK (HTTP $code na portu $port)"; return 0 ;;
    *) say "smoke test NIJE prosao (HTTP '${code:-nema odgovora}' posle ${waited}s)"
       say "--- boot.log: prvih 25 linija ---"
       head -25 "$sb/boot.log" 2>/dev/null | sed 's/^/    /'
       say "--- boot.log: zadnjih 25 linija ---"
       tail -25 "$sb/boot.log" 2>/dev/null | sed 's/^/    /'
       { echo "=== boot.log (ceo) ==="; cat "$sb/boot.log" 2>/dev/null; } >> "$LOG"
       return 1 ;;
  esac
}

# --- faze --------------------------------------------------------------------
do_check() {
  local cur latest
  cur="$(installed_version)"; latest="$(latest_version)"
  say "dsh verzije:"
  say "  instalirano : ${cur:-?}   ($DST)"
  say "  npm latest  : ${latest:-? (nedostupno — offline?)}"
  if [ -n "$cur" ] && [ -n "$latest" ] && [ "$cur" != "$latest" ]; then
    say "  -> novija verzija postoji; update ide ISKLJUCIVO rucno: ~/dsh/dsh-update.sh"
  fi
  say ""
  say "pluginski opsezi prema @deepseek-ai/dsh* (cilj: ${latest:-?}):"
  local out; out="$(compat_report "${latest:-0.0.0}")"
  if [ "$out" = "GRESKA" ]; then
    say "  [!] ne mogu da proverim (nema $DSH_DIR/compat-scan.mjs ili skener ne radi)"
    return 1
  fi
  if [ "$out" = "NEMA" ] || [ -z "$out" ]; then
    say "  nema pluginskih opsega — nema ogranicenja"
    return 0
  fi
  local line verdict plugin dep range
  while IFS='|' read -r verdict plugin dep range; do
    say "  [$verdict] $plugin trazi $dep@$range"
  done <<< "$out"
  grep -qE '^(KRSI|NEPOZNATO)\|' <<< "$out" && return 1
  return 0
}

do_rollback() {
  [ -f "$BACKUP_POINTER" ] || die "nema zapisanog backupa ($BACKUP_POINTER)"
  local b; b="$(cat "$BACKUP_POINTER")"
  [ -d "$b" ] || die "backup $b ne postoji"
  local cur; cur="$(installed_version)"
  local aside="$GLOBAL_ROOT/.dsh-rolledback-${cur:-unknown}-$(date +%Y%m%d-%H%M%S)"
  say "rollback: $cur -> $(node -p "require('$b/package.json').version" 2>/dev/null)"
  mv "$DST" "$aside" || die "ne mogu da sklonim trenutnu instalaciju"
  mv "$b" "$DST" || { mv "$aside" "$DST"; die "rollback rename nije uspeo"; }
  rm -f "$BACKUP_POINTER"
  say "rollback OK. Sklonjena verzija: $aside (obrisi rucno kad proveris)."
  say "Sledeci korak: restart dsh-a (novi proces mora da ucita vracenu verziju)."
}

do_update() {
  local cur target
  cur="$(installed_version)"
  [ -z "$cur" ] && die "ne mogu da procitam instaliranu verziju iz $DST"
  if [ -n "$TARGET" ]; then target="$TARGET"; else target="$(latest_version)"; fi
  [ -z "$target" ] && die "ne mogu da dobijem ciljnu verziju (npm view je pao — offline?)"

  say "=== dsh-update ==="
  say "instalirano : $cur"
  say "cilj        : $target"
  say "sandbox     : (bice izabran)"
  say "swap        : $([ "$DO_SWAP" = 1 ] && echo 'da (posle validacije)' || echo 'NE (--no-swap)')"

  if [ "$cur" = "$target" ]; then
    say "Vec je instalirano $target. Nema sta da se radi."
    return 0
  fi

  # 3) kompatibilnost
  say ""
  say "--- kompatibilnost ---"
  local compat; compat="$(compat_report "$target")"
  if [ "$compat" = "GRESKA" ]; then
    if [ "$FORCE" = 1 ]; then
      say "[!] kompatibilnost se ne moze proveriti (nema $DSH_DIR/compat-scan.mjs"
      say "    ili skener ne radi); --force je zadat — nastavljam na sopstveni rizik."
    else
      die "ne mogu da proverim kompatibilnost plugina (compat-scan.mjs); za nastavak: --force"
    fi
  elif [ "$compat" = "NEMA" ] || [ -z "$compat" ]; then
    say "nema pluginskih opsega prema @deepseek-ai/dsh* — nema ogranicenja"
  else
    local verdict plugin dep range badc=0
    while IFS='|' read -r verdict plugin dep range; do
      say "  [$verdict] $plugin trazi $dep@$range"
      [ "$verdict" != "OK" ] && badc=1
    done <<< "$compat"
    if [ "$badc" = 1 ]; then
      if [ "$FORCE" = 1 ]; then
        say "  [!] opsezi se krse, ali --force je zadat — nastavljam."
      else
        say ""
        say "Ciljna verzija izlazi iz opsega koji traze instalirani pluginovi."
        say "To obicno znaci da ce plugin prestati da radi (0.x caret je uzak)."
        die "prekidam pre skidanja; za nastavak: --force"
      fi
    fi
  fi

  # 4) sandbox
  SANDBOX="$(pick_sandbox)"
  say ""
  say "--- sandbox ---"
  say "sandbox: $SANDBOX"
  rm -rf "$SANDBOX"
  mkdir -p "$SANDBOX" || die "ne mogu da napravim sandbox"

  # --global + --prefix: instalira se u <sandbox>/lib/node_modules, sa SVIM
  # zavisnostima UGNJEZDENIM u dsh/node_modules — identicno layoutu zive
  # globalne instalacije. Sa obicnim `--prefix` npm hoistuje zavisnosti u
  # <sandbox>/node_modules, pa bi swap premestio samo dsh dir i ostavio
  # zavisnosti za sobom. Realni globalni root se ne dira (prefix je sandbox).
  #
  # --ignore-scripts: instalira se BEZ install skripti, jer koffi@3.1.1 (koji
  # 0.2.x pinuje) nema android-arm64 prebuild i njegov build obara ceo install
  # pre nego sto ijedan drugi paket dobije priliku. Skripte se pokrecu u 4c,
  # posle zamene koffija (4b).
  # --prefer-online (a ne --prefer-offline): sa bajatim kešom npm ume da
  # prijavi lazni ETARGET za pakete koji na npm-u normalno postoje.
  say "npm install --global --prefix $SANDBOX --ignore-scripts $PKG@$target  (bez diranja zive instalacije)"
  if ! npm install --global --prefix "$SANDBOX" --ignore-scripts --no-audit --no-fund \
        --prefer-online --loglevel=error "$PKG@$target" >> "$LOG" 2>&1; then
    die "npm install u sandbox nije uspeo (vidi $LOG)"
  fi
  SB_DIR="$SANDBOX/lib/node_modules/@deepseek-ai/dsh"
  [ -f "$SB_DIR/package.json" ] || die "sandbox instalacija nema @deepseek-ai/dsh"

  local got; got="$(node -p "require('$SB_DIR/package.json').version" 2>/dev/null)"
  [ "$got" = "$target" ] || die "sandbox ima verziju '$got', ocekivano '$target'"
  say "sandbox verzija: $got"

  # 4b) koffi — android-arm64 prebuild
  local koffi_dir="$SB_DIR/node_modules/koffi"
  local koffi_native="$SB_DIR/node_modules/@koromix/koffi-android-arm64"
  if [ -d "$koffi_dir" ] && [ ! -f "$koffi_native/android_arm64/koffi.node" ]; then
    local koffi_pin; koffi_pin="$(node -p "require('$koffi_dir/package.json').version" 2>/dev/null)"
    say ""
    say "--- koffi (android-arm64 prebuild) ---"
    say "koffi ${koffi_pin:-?} nema @koromix/koffi-android-arm64; njegov install"
    say "script prevodi iz izvora i na Bionicu puca (statx). Zamenjujem ga sa"
    say "koffi@$KOFFI_ANDROID_VERSION, koji prebuild ima."
    local ks="$SANDBOX/koffi-src"
    rm -rf "$ks"; mkdir -p "$ks"
    printf '{"name":"dsh-update-koffi","private":true,"version":"0.0.0"}\n' > "$ks/package.json"
    if ! npm install --prefix "$ks" --ignore-scripts --no-audit --no-fund \
          --prefer-online --loglevel=error "koffi@$KOFFI_ANDROID_VERSION" >> "$LOG" 2>&1; then
      die "ne mogu da skinem koffi@$KOFFI_ANDROID_VERSION (vidi $LOG)"
    fi
    [ -f "$ks/node_modules/@koromix/koffi-android-arm64/android_arm64/koffi.node" ] \
      || die "koffi@$KOFFI_ANDROID_VERSION nema android_arm64/koffi.node"
    rm -rf "$koffi_dir"
    cp -a "$ks/node_modules/koffi" "$koffi_dir" || die "kopiranje koffi nije uspelo"
    mkdir -p "$SB_DIR/node_modules/@koromix"
    cp -a "$ks/node_modules/@koromix/koffi-android-arm64" "$koffi_native" \
      || die "kopiranje koffi-android-arm64 nije uspelo"
    rm -rf "$ks"
    say "koffi: ${koffi_pin:-?} -> $KOFFI_ANDROID_VERSION + android_arm64/koffi.node"
  elif [ -d "$koffi_dir" ]; then
    say "koffi: android-arm64 prebuild vec postoji"
  fi

  # 4c) install skripte koje je --ignore-scripts preskocio
  say ""
  say "--- install skripte (npm rebuild) ---"
  if ! npm rebuild --global --prefix "$SANDBOX" --loglevel=error >> "$LOG" 2>&1; then
    die "npm rebuild u sandboxu nije prosao (vidi $LOG)"
  fi
  say "npm rebuild: ok (node-pty i ostali native delovi izgradjeni)"

  # 5) zakrpe
  say ""
  say "--- zakrpe (na sandbox drvo) ---"
  [ -f "$PATCHER" ] || die "nema $PATCHER"
  if ! python3 "$PATCHER" --root "$SB_DIR" --pwa-samesite >> "$LOG" 2>&1; then
    python3 "$PATCHER" --root "$SB_DIR" --check 2>&1 | sed 's/^/    /' | tee -a "$LOG" >/dev/null
    die "zakrpe nisu primenjene na sandbox (vidi $LOG)"
  fi
  python3 "$PATCHER" --root "$SB_DIR" --check --pwa-samesite 2>&1 | sed 's/^/    /'
  python3 "$PATCHER" --root "$SB_DIR" --check --pwa-samesite >> "$LOG" 2>&1

  # no-hardlink.cjs: preload za SELinux link(2); kopira se u sandbox i proverava
  # se funkcionalno (link sync mora biti copyFileSync).
  [ -f "$NO_HARDLINK" ] || die "nema $NO_HARDLINK"
  cp "$NO_HARDLINK" "$SANDBOX/no-hardlink.cjs"
  if ! node --require "$SANDBOX/no-hardlink.cjs" -e \
      'const fs=require("node:fs"); if (!/copyFileSync/.test(fs.linkSync.toString())) process.exit(1);' \
      >> "$LOG" 2>&1; then
    die "no-hardlink.cjs ne presrece fs.link na Node-u $(node -v)"
  fi
  say "no-hardlink.cjs: fs.link -> copyFile aktivno"

  # 6) validacija
  say ""
  say "--- validacija ---"
  write_probes "$SANDBOX" "$SB_DIR"

  # Napomena: `if ! cmd | sed` bi testirao `sed` (uvek 0), pa bi validacija bila
  # mrtva. Zato se izlaz hvata, rc cuva, a tekst tek onda formatira.
  run_probe() {
    local desc="$1"; shift
    local out rc
    out="$("$@" 2>&1)"; rc=$?
    [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/    /'
    [ "$rc" -eq 0 ] || die "$desc nije prosao (rc=$rc)"
  }

  run_probe "flock mock" node "$SANDBOX/probe/flock.mjs" \
    "file://$SB_DIR/node_modules/@deepseek-ai/node-addon-system/lib/flock.js"
  run_probe "ripgrep shim" node "$SB_DIR/$PROBE_PREFIX-ripgrep.mjs"
  run_probe "native moduli" node "$SB_DIR/$PROBE_PREFIX-native.mjs"
  remove_probes "$SB_DIR"

  python3 "$PATCHER" --root "$SB_DIR" --check --pwa-samesite >/dev/null 2>&1 \
    || die "zakrpe nisu verifikovane posle primene (--check nije vratio 0)"

  if ! npm ls --global --prefix "$SANDBOX" --depth=0 >> "$LOG" 2>&1; then
    die "npm ls u sandboxu prijavljuje probleme (vidi $LOG)"
  fi
  say "npm ls: ok"

  if ! smoke_test "$SANDBOX" "$SB_DIR"; then
    native_hint "$SANDBOX/boot.log"
    die "boot smoke test nije prosao — update odbijen"
  fi

  # 7) atomska zamena
  if [ "$DO_SWAP" != 1 ]; then
    say ""
    say "--no-swap: sve faze prosle, ziva instalacija NIJE dirana."
    say "sandbox sa validiranom verzijom $target: $SB_DIR"
    return 0
  fi

  say ""
  say "--- atomska zamena ---"
  remove_probes "$SB_DIR"
  if pgrep -f 'dsh/lib/bin[.]js' >/dev/null 2>&1; then
    say "[i] dsh trenutno RADI. Rename je bezbedan (inode ostaje otvoren), ali"
    say "    novu verziju ces dobiti tek posle restarta. Zivi proces ne prekidam."
  fi
  local backup="$GLOBAL_ROOT/.dsh-backup-${cur}-$(date +%Y%m%d-%H%M%S)"
  say "stara instalacija -> $backup"
  mv "$DST" "$backup" || die "rename stare instalacije nije uspeo"
  if ! mv "$SB_DIR" "$DST"; then
    mv "$backup" "$DST" 2>/dev/null
    die "rename sandboxa na mesto instalacije nije uspeo (stara verzija vracena)"
  fi

  local newv; newv="$(installed_version)"
  if [ "$newv" != "$target" ]; then
    rm -rf "$DST" 2>/dev/null
    mv "$backup" "$DST" 2>/dev/null
    die "posle zamene instalirana verzija je '$newv', ocekivano '$target' — vraceno na $cur"
  fi
  echo "$backup" > "$BACKUP_POINTER"

  # Stariji backupi se brisu da ne rastu u nedogled; poslednji ostaje za rollback.
  local b
  for b in "$GLOBAL_ROOT"/.dsh-backup-*; do
    [ -d "$b" ] || continue
    [ "$b" = "$backup" ] && continue
    rm -rf "$b" && say "stari backup obrisan: $(basename "$b")"
  done

  say "zamena OK: $cur -> $newv"
  say "backup za rollback: $backup"

  # 8) ciscenje
  say ""
  say "--- ciscenje ---"
  cleanup_sandbox
  SANDBOX=""
  say ""
  say "GOTOVO. Verzija $newv je na disku, ali ZIVI PROCES i dalje radi $cur."
  say "Da je ucitas: restart dsh-a (npr. skill restart-dsh)."
  say "Provera zakrpa na zivoj instalaciji: python3 $PATCHER --check"
  return 0
}

# --- main --------------------------------------------------------------------
mkdir -p "$DSH_DIR"
[ -w "$GLOBAL_ROOT" ] || die "nemam pravo pisanja u $GLOBAL_ROOT"

case "$MODE" in
  check)    acquire_lock; do_check; rc=$?; release_lock; exit $rc ;;
  rollback) acquire_lock; do_rollback; rc=$?; release_lock; exit $rc ;;
  update)   acquire_lock; do_update; rc=$?; release_lock; exit $rc ;;
esac
