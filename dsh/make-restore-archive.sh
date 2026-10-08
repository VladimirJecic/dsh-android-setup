#!/data/data/com.termux/files/usr/bin/bash
# make-restore-archive.sh — osveži DSH restore arhivu iz ŽIVOG sistema i spakuj je.
#
#   bash ~/dsh/make-restore-archive.sh            # osveži + .zip
#   NOZIP=1 bash ~/dsh/make-restore-archive.sh    # samo folder (bez .zip)
#   SHARE=1 bash ~/dsh/make-restore-archive.sh    # + termux-share
#   DSH_RESTORE_DL=... bash ~/dsh/make-restore-archive.sh   # drugi Download
#
# Arhiva je od 2026-10-08 JEDAN folder BEZ datuma:
#   /storage/emulated/0/Download/DSH-Restore
# i istovremeno git repo (github.com/VladimirJecic/dsh-android-setup, master).
# Osvežava se U MESTU, pa nema više kopiranja prethodne arhive, nema
# prepisivanja datuma u putanjama i nema „novi datum = novi folder". Datum je
# izbačen jer se arhiva ne deli preko Google Drive-a — deli se kroz git.
#
# Sadržaj je 100% IZVEDEN iz živog sistema:
#   ~/dsh/restore/*         -> koren arhive (restore.sh, README*.md, .gitignore)
#   ~/dsh/*.md              -> koren arhive (uputstvo, PRAVILA-DSH.md indeks, UPUTSTVO-*)
#   ~/dsh/rules/*.md        -> rules/
#   ~/dsh/<SCRIPTS>         -> dsh/
#   ~/dsh/<plugin>/         -> dsh/<plugin>/   (oba lokalna plugina)
#   ~/.local/bin/dsh-termux -> bin/
#   ~/.dsh/profiles/web/*   -> profile/
#   ~/.dsh/AGENTS.md        -> dsh-home/AGENTS.md
#   ~/.dsh/skills/*         -> skills/ (symlinkovi se dereferenciraju)
#   ~/dsh/tests/*           -> tests/
# Zato se pre kopiranja obriše SVE osim `.git`: obrisan fajl u ~/dsh nestaje i
# iz arhive, a svako pokretanje daje isto stanje (idempotentno).
#
# Posle osvežavanja (iz foldera arhive):
#   git status --short && git add -A && git commit -m "<poruka>" && git push
# Detalji i pravila: ~/dsh/rules/07-restore-i-git.md.
#
# NE uzima: tajne (~/.config/dsh-secrets.env, .credentials.yaml), sesije, logove,
# .bak fajlove, screenshot-ove, __pycache__, node_modules.
set -uo pipefail

DL="${DSH_RESTORE_DL:-/storage/emulated/0/Download}"
NEW="$DL/DSH-Restore"
ZIP="$DL/DSH-Restore.zip"
BASE="$HOME/dsh/restore"
H="$HOME"

say() { printf '%s\n' "$*"; }
[ -d "$DL" ] || { say "[x] nema $DL"; exit 1; }
[ -d "$BASE" ] || { say "[x] nema $BASE — tu žive restore.sh, README.md, README-RESTORE.md, .gitignore"; exit 1; }

say "=== make-restore-archive ==="
say "arhiva : $NEW"
if [ -d "$NEW/.git" ]; then
	say "         (git repo — osvežavam u mestu, .git se ne dira)"
else
	say "         [!] nema .git — novi repo: git init -b master + remote + fetch/reset"
fi

# --- 1) očisti sve osim .git (build je izveden, pa mora biti egzaktan) --------
mkdir -p "$NEW"
find "$NEW" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null
mkdir -p "$NEW"/{bin,dsh,dsh-home,profile,rules,skills,tests}

# --- 2) koren: bazni fajlovi + dokumentacija ---------------------------------
for f in restore.sh README.md README-RESTORE.md .gitignore; do
	if [ -f "$BASE/$f" ]; then
		cp -p "$BASE/$f" "$NEW/$f"
	else
		say "  [!] nema $BASE/$f"
	fi
done
shopt -s nullglob
copied=0
for f in "$H"/dsh/*.md; do
	cp -p "$f" "$NEW/" && copied=$((copied + 1))
done
say "[ok] koren: bazni fajlovi + $copied dokumenata iz ~/dsh"

# Pravila su od 2026-10-08 podeljena po temama u ~/dsh/rules/ → arhiva/rules/.
for f in "$H"/dsh/rules/*.md; do
	cp -p "$f" "$NEW/rules/"
done
say "[ok] pravila: $(ls "$NEW/rules" 2>/dev/null | wc -l) fajlova ($(ls "$NEW/rules" 2>/dev/null | tr '\n' ' '))"

# --- 3) operativne skripte ---------------------------------------------------
# Probe-skripte iz septembra su izbačene 2026-10-08 (bile su jednokratne probe,
# ne uputstvo); `restart-dsh` skill je jedini restart. Nova skripta se dodaje
# ovde I u restore.sh (`DSH_FILES`), inače restore ostavi dokumentovanu komandu
# bez skripte.
SCRIPTS=(
	patch-android-dsh.py dsh-update.sh compat-scan.mjs gemini-catalog-update.py
	dsh-rescue.sh dsh-url.sh no-hardlink.cjs restore-patches.sh
	cache-report.py session-turn-state.py resume-after-restart.sh
	preset-compaction-sync.py make-restore-archive.sh
	.restart-after-update.sh
)
missing=0
for f in "${SCRIPTS[@]}"; do
	if [ -f "$H/dsh/$f" ]; then
		cp -p "$H/dsh/$f" "$NEW/dsh/$f"
	else
		say "  [!] nema ~/dsh/$f — preskačem"; missing=$((missing + 1))
	fi
done
say "[ok] skripte: $((${#SCRIPTS[@]} - missing))/${#SCRIPTS[@]}"

# --- 4) pluginovi ------------------------------------------------------------
# Svi lokalni pluginovi iz `dsh.profile.bundles` (patch-android-dsh.py ih drži
# u istom spisku), sa istim fajlovima. Novi plugin se dodaje ovde.
for plugin in dsh-composer-extras dsh-chat-jump-arrows; do
	mkdir -p "$NEW/dsh/$plugin"
	for f in client.js index.js package.json cordis.patch.yml; do
		cp -p "$H/dsh/$plugin/$f" "$NEW/dsh/$plugin/$f" \
			|| say "  [!] nema plugina $plugin: $f"
	done
	say "[ok] $plugin (client.js, index.js, package.json, cordis.patch.yml)"
done

# --- 5) launcher, profil, AGENTS.md, skills ----------------------------------
copy_one() { # $1 izvor, $2 odredište
	if [ -f "$1" ]; then cp -p "$1" "$2" && say "  [ok] $(basename "$2")"; else say "  [!] nema $1"; fi
}
copy_one "$H/.local/bin/dsh-termux"               "$NEW/bin/dsh-termux"
copy_one "$H/.dsh/profiles/web/package.json"      "$NEW/profile/package.json"
copy_one "$H/.dsh/profiles/web/cordis.patch.yml"  "$NEW/profile/cordis.patch.yml"
copy_one "$H/.dsh/AGENTS.md"                      "$NEW/dsh-home/AGENTS.md"

# settings.yaml više ne postoji (~/.dsh/settings.yaml.imported); model i
# welcome-notice su prešli u profile/cordis.patch.yml.
rm -f "$NEW/profile/settings.yaml"

for s in "$H/.dsh/skills"/*; do
	[ -e "$s" ] || continue
	# -L: symlinkovi ka ~/.claude/skills se dereferenciraju (arhiva je samostalna)
	cp -rLp "$s" "$NEW/skills/$(basename "$s")" || say "  [!] skill nije kopiran: $s"
done
say "[ok] skills: $(ls "$NEW/skills" | wc -l) komada ($(ls "$NEW/skills" | tr '\n' ' '))"

# --- 5a) testovi (dokazuju pravila iz rules/) --------------------------------
# `tests/*.mjs` čitaju `../dsh-composer-extras/client.js`, pa ista putanja radi
# i u ~/dsh/tests i u arhivi/tests. `test-gemini-catalog-update.py` je python3.
for f in "$H"/dsh/tests/*.mjs "$H"/dsh/tests/*.py; do
	[ -f "$f" ] && cp -p "$f" "$NEW/tests/"
done
say "[ok] tests: $(ls "$NEW/tests" 2>/dev/null | wc -l) komada"

# --- 5b) čišćenje smeća ------------------------------------------------------
# Skills umeju da nose .bak kopije i __pycache__; u arhivi nemaju šta da traže.
find "$NEW" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null
find "$NEW" -name '*.bak-*' -type f -delete 2>/dev/null
find "$NEW" -name '*.pyc' -type f -delete 2>/dev/null
say "[ok] očišćeno: __pycache__, *.bak-*, *.pyc"

# --- 6) pregled --------------------------------------------------------------
say
say "sadržaj:"
du -sh "$NEW" 2>/dev/null | sed 's/^/  /'
find "$NEW" -type f -not -path '*/.git/*' | sed "s|$NEW/|  |" | sort
if [ -d "$NEW/.git" ]; then
	say
	say "razlike prema poslednjem commit-u:"
	git -C "$NEW" status --short | sed 's/^/  /' | head -40
fi

# --- 7) zip ------------------------------------------------------------------
if [ "${NOZIP:-0}" != 1 ]; then
	say
	say "pakujem $ZIP"
	rm -f "$ZIP"
	python3 - "$NEW" "$ZIP" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
base = os.path.dirname(root)
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        # `.git` NE ide u zip: arhiva je git repo, ali zip je samo prenosivi
        # snapshot sadržaja, ne i istorijat/remote.
        dirnames[:] = sorted(d for d in dirnames if d != ".git")
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            z.write(full, os.path.relpath(full, base))
            n += 1
print(f"  [ok] {out}  ({n} fajlova, {os.path.getsize(out)} B)")
PY
fi

if [ "${SHARE:-0}" = 1 ] && [ -f "$ZIP" ]; then
	say
	say "otvaram Android share sheet (termux-share)…"
	termux-share -a send -t "$(basename "$ZIP")" "$ZIP" \
		|| say "  [!] termux-share nije uspeo — podeli fajl ručno: $ZIP"
fi

say
say "gotovo: $NEW$([ "${NOZIP:-0}" != 1 ] && echo " + $ZIP")"
if [ -d "$NEW/.git" ]; then
	say "objavi:  cd \"$NEW\" && git add -A && git commit -m '<poruka>' && git push"
fi
