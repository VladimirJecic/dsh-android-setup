#!/data/data/com.termux/files/usr/bin/bash
# make-restore-archive.sh — osveži DSH restore arhivu iz ŽIVOG sistema i spakuj je.
#
#   bash ~/dsh/make-restore-archive.sh            # datum = danas (YYYYMMDD)
#   bash ~/dsh/make-restore-archive.sh 20261006   # eksplicitno
#   NOZIP=1  ...                                  # samo folder, bez .zip
#   SHARE=1  ...                                  # + termux-share na kraju
#
# Šta radi:
#   1. uzme prethodnu arhivu kao osnovu (restore.sh, README-RESTORE.md, README.md,
#      .gitignore, _originali/) — ali NE i njen `.git`
#   2. osveži iz živog sistema: skripte, plugin, launcher, profil, AGENTS.md, skills, docs
#   3. prepiše ime arhive u putanjama (stari datum -> novi)
#   4. spakuje u <ime>.zip (python zipfile — `zip` na Termuxu nije instaliran)
#
# Od 2026-10-07 je arhiva i GIT REPO:
#   github.com/VladimirJecic/dsh-android-setup  (branch master)
# Posle pravljenja nove arhive: `cd` u nju, `git init -b master`, `git remote add
# origin <url>`, `git fetch`, `git reset --mixed origin/master`, `git add -A`,
# `git commit`, `git push`. Detalji: PRAVILA-DSH.md, sekcija 10.
#
# NE uzima: tajne (~/.config/dsh-secrets.env, .credentials.yaml), sesije, logove,
# .bak fajlove, screenshot-ove, __pycache__, node_modules.
set -uo pipefail

DATE="${1:-$(date +%Y%m%d)}"
DL=/storage/emulated/0/Download
NEW="$DL/DSH-Restore-$DATE"
PREV="$(ls -d "$DL"/DSH-Restore-* 2>/dev/null | grep -v '\.zip$' | grep -v "^$NEW\$" | sort | tail -1)"
H="$HOME"

say() { printf '%s\n' "$*"; }
[ -d "$DL" ] || { say "[x] nema $DL"; exit 1; }

say "=== make-restore-archive ==="
say "novo   : $NEW"
say "osnova : ${PREV:-<nema — pravi se od nule>}"

# --- 1) osnova ---------------------------------------------------------------
if [ -d "$NEW" ]; then
	say "[i] $NEW već postoji — osvežavam ga u mestu"
elif [ -n "$PREV" ]; then
	rm -rf "$NEW"
	cp -r "$PREV" "$NEW" || { say "[x] kopiranje osnove nije uspelo"; exit 1; }
	# Arhiva je od 2026-10-07 i git repo (github.com/VladimirJecic/dsh-android-setup).
	# `.git` se NE prenosi u novu arhivu: novi datum dobija svoj `git init`, a
	# stari istorijat/remote bi samo zbunio i udvostručio repo.
	rm -rf "$NEW/.git"
	rm -f "$DL/DSH-Restore-$(basename "$PREV" | sed 's/DSH-Restore-//').zip"
else
	mkdir -p "$NEW"
fi
mkdir -p "$NEW"/{bin,dsh,dsh-home,profile,skills}

PREVDATE="$(basename "${PREV:-DSH-Restore-}" | sed 's/DSH-Restore-//')"

# --- 2) skripte --------------------------------------------------------------
# Dokumentacija koja živi u ~/dsh (uključujući kompletno uputstvo) ide u koren arhive.
shopt -s nullglob
copied=0
for f in "$H"/dsh/*.md; do
	cp -p "$f" "$NEW/" && copied=$((copied + 1))
done
say "[ok] dokumentacija iz ~/dsh: $copied fajlova"

# Operativne skripte u arhivi/dsh/
SCRIPTS=(
	patch-android-dsh.py dsh-update.sh compat-scan.mjs gemini-catalog-update.py
	dsh-rescue.sh dsh-url.sh no-hardlink.cjs restore-patches.sh
	cache-report.py session-turn-state.py resume-after-restart.sh
	run-headless-buttons.sh make-restore-archive.sh
	.restart-after-update.sh .smart-start-test.sh .smart-test-prompt.md
	.restart-branch-route.sh .restart-for-branchinfo.sh .restart-plugin-fix.sh
	.restart-when-idle.sh
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

# --- 3) plugin ---------------------------------------------------------------
mkdir -p "$NEW/dsh/dsh-composer-extras"
for f in client.js index.js package.json cordis.patch.yml; do
	cp -p "$H/dsh/dsh-composer-extras/$f" "$NEW/dsh/dsh-composer-extras/$f" \
		|| say "  [!] nema plugina: $f"
done
say "[ok] dsh-composer-extras (client.js, index.js, package.json, cordis.patch.yml)"

# --- 4) launcher, profil, AGENTS.md, skills ----------------------------------
copy_one() { # $1 izvor, $2 odredište
	if [ -f "$1" ]; then cp -p "$1" "$2" && say "  [ok] $(basename "$2")"; else say "  [!] nema $1"; fi
}
copy_one "$H/.local/bin/dsh-termux"            "$NEW/bin/dsh-termux"
copy_one "$H/.dsh/profiles/web/package.json"   "$NEW/profile/package.json"
copy_one "$H/.dsh/profiles/web/cordis.patch.yml" "$NEW/profile/cordis.patch.yml"
copy_one "$H/.dsh/AGENTS.md"                    "$NEW/dsh-home/AGENTS.md"

# settings.yaml više ne postoji (~/.dsh/settings.yaml.imported); model i
# welcome-notice su prešli u profile/cordis.patch.yml, pa stara kopija ne treba.
rm -f "$NEW/profile/settings.yaml"

rm -rf "$NEW/skills"
mkdir -p "$NEW/skills"
for s in "$H/.dsh/skills"/*; do
	[ -e "$s" ] || continue
	# -L: symlinkovi ka ~/.claude/skills se dereferenciraju (arhiva je samostalna)
	cp -rLp "$s" "$NEW/skills/$(basename "$s")" || say "  [!] skill nije kopiran: $s"
done
say "[ok] skills: $(ls "$NEW/skills" | wc -l) komada ($(ls "$NEW/skills" | tr '\n' ' '))"

# --- 4b) čišćenje smeća ------------------------------------------------------
# Skills umeju da nose .bak kopije i __pycache__; u arhivi nemaju šta da traže.
find "$NEW" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null
find "$NEW" -name '*.bak-*' -type f -delete 2>/dev/null
find "$NEW" -name '*.pyc' -type f -delete 2>/dev/null
say "[ok] očišćeno: __pycache__, *.bak-*, *.pyc"

# --- 5) datum u putanjama ----------------------------------------------------
if [ -n "$PREVDATE" ] && [ "$PREVDATE" != "$DATE" ]; then
	n=0
	while IFS= read -r f; do
		if grep -q "DSH-Restore-$PREVDATE" "$f" 2>/dev/null; then
			sed -i "s/DSH-Restore-$PREVDATE/DSH-Restore-$DATE/g" "$f" && n=$((n + 1))
		fi
	done < <(find "$NEW" -path "$NEW/_originali" -prune -o \
		\( -name '*.md' -o -name '*.sh' -o -name '*.py' -o -name '*.yml' \) -type f -print)
	say "[ok] putanje prepisane ($PREVDATE -> $DATE) u $n fajlova"

	# I u živim izvorima (~/dsh) — da dokumentacija i skripte uvek pokazuju na
	# NAJNOVIJU arhivu, a ne na prošlogodišnju.
	m=0
	for f in "$H"/dsh/*.md "$H"/dsh/*.sh "$H"/dsh/*.py; do
		[ -f "$f" ] || continue
		case "$f" in *.bak-*) continue ;; esac
		if grep -q "DSH-Restore-$PREVDATE" "$f" 2>/dev/null; then
			sed -i "s/DSH-Restore-$PREVDATE/DSH-Restore-$DATE/g" "$f" && m=$((m + 1))
		fi
	done
	say "[ok] isto u ~/dsh: $m fajlova"
fi

# --- 6) pregled --------------------------------------------------------------
say
say "sadržaj:"
du -sh "$NEW" | sed 's/^/  /'
find "$NEW" -type f -not -path '*/.git/*' | sed "s|$NEW/|  |" | sort
[ -n "$PREV" ] && { say; say "razlike prema $(basename "$PREV"):"; diff -rq -x '.git' "$PREV" "$NEW" 2>/dev/null | sed 's/^/  /' | head -40; }

# --- 7) zip ------------------------------------------------------------------
if [ "${NOZIP:-0}" != 1 ]; then
	say
	say "pakujem $NEW.zip"
	rm -f "$NEW.zip"
	python3 - "$DL" "$(basename "$NEW")" <<'PY'
import os, sys, zipfile
base, name = sys.argv[1], sys.argv[2]
root = os.path.join(base, name)
out = os.path.join(base, name + ".zip")
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        # `.git` NE ide u zip: arhiva je od 2026-10-07 i git repo, ali zip je
        # samo prenosivi snapshot sadržaja, ne i istorijat/remote.
        dirnames[:] = sorted(d for d in dirnames if d != ".git")
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            z.write(full, os.path.relpath(full, base))
            n += 1
print(f"  [ok] {out}  ({n} fajlova, {os.path.getsize(out)} B)")
PY
fi

if [ "${SHARE:-0}" = 1 ] && [ -f "$NEW.zip" ]; then
	say
	say "otvaram Android share sheet (termux-share)…"
	termux-share -a send -t "$(basename "$NEW").zip" "$NEW.zip" \
		|| say "  [!] termux-share nije uspeo — podeli fajl ručno: $NEW.zip"
fi

say
say "gotovo: $NEW$([ "${NOZIP:-0}" != 1 ] && echo " + $NEW.zip")"
