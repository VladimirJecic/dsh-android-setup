# 07. Restore arhiva i git

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Skripte:
> `~/dsh/make-restore-archive.sh`, `~/dsh/restore/*` (bazni fajlovi arhive),
> `restore.sh` i `README*.md` (u arhivi), `~/dsh/restore-patches.sh`.

## Šta je arhiva

- **Živi izvor je `~/dsh`** (+ `~/.dsh`, `~/.local/bin/dsh-termux`, profil).
  Arhiva je **snapshot** tog stanja u **jednom folderu bez datuma**:
  `/storage/emulated/0/Download/DSH-Restore`.
- Isti folder je i **git repo** → <https://github.com/VladimirJecic/dsh-android-setup.git>
  (branch `master`, nalog **VladimirJecic**; auth preko `gh`,
  `gh auth git-credential` je u `~/.gitconfig`, `git push` ne pita ništa).
- **Datum je izbačen 2026-10-08:** arhiva se više ne deli preko Google Drive-a
  nego kroz git, pa se **osvežava u mestu**. Nema kopiranja prethodne arhive, ni
  prepisivanja datuma u putanjama, ni „novi datum = novi folder" — time je otpao
  i najveći deo zakomplikovanosti stare skripte.
- **Zip je ukinut 2026-10-08:** `make-restore-archive.sh` više **ne pravi**
  `DSH-Restore.zip` (nema ni `NOZIP`/`SHARE`). Deljenje i istorija idu isključivo
  kroz git — zip je bio samo prenosivi snapshot bez `.git`, tj. dupliranje istine.

## Pakovanje (`make-restore-archive.sh`)

```bash
bash ~/dsh/make-restore-archive.sh                          # osveži folder
DSH_RESTORE_DL=/drugi/Download bash ~/dsh/make-restore-archive.sh
```

Sadržaj je **100% izveden iz živog sistema**, pa je osvežavanje egzaktno:

| Izvor | Gde ide u arhivi |
|---|---|
| `~/dsh/restore/{restore.sh,README.md,README-RESTORE.md,.gitignore}` | koren |
| `~/dsh/*.md` (uputstvo, `PRAVILA-DSH.md` indeks, `UPUTSTVO-*`) | koren |
| `~/dsh/rules/*.md` | `rules/` |
| `~/dsh/<SCRIPTS>` (spisak u skripti) | `dsh/` |
| `~/dsh/dsh-composer-extras/`, `~/dsh/dsh-chat-jump-arrows/` | `dsh/<plugin>/` |
| `~/dsh/tests/*.mjs`, `*.py` | `tests/` |
| `~/.local/bin/dsh-termux` | `bin/` |
| `~/.dsh/profiles/web/{package.json,cordis.patch.yml}` | `profile/` |
| `~/.dsh/AGENTS.md` | `dsh-home/AGENTS.md` |
| `~/.dsh/skills/*` (symlinkovi se dereferenciraju) | `skills/` |

**Pre kopiranja se briše sve osim `.git`.** Zato:

- **obrisan fajl u `~/dsh` nestaje i iz arhive** (nema više ručnog `git rm`
  posledica),
- svako pokretanje daje isto stanje (idempotentno), a `git status --short` koji
  skript ispiše na kraju pokaže tačno šta se promenilo.

**Pravila:**

- **Bazne fajlove arhive menjaj u `~/dsh/restore/`**, nikad u arhivi — arhiva se
  prepisuje iz njih.
- Nova operativna skripta → dodaj je u `SCRIPTS` (u `make-restore-archive.sh`)
  **i** u `restore.sh` (`DSH_FILES`), inače restore ostavi dokumentovanu komandu
  bez skripte.
- Novi lokalni plugin → dodaj ga u `make-restore-archive.sh` (`for plugin in …`),
  `patch-android-dsh.py` (`LOCAL_PLUGINS`) i `restore.sh`
  ([`04-instalacija.md`](04-instalacija.md)).
- **Nikad ne komituj:** API ključeve, `~/.dsh/sessions/`, `.credentials.yaml`,
  `settings.yaml`, logove, `.bak` fajlove, screenshote, `node_modules`,
  `__pycache__`.

## Objava (git)

```bash
bash ~/dsh/make-restore-archive.sh          # 1. osveži iz živog sistema
cd /storage/emulated/0/Download/DSH-Restore
git status --short                          # 2. pogledaj šta se promenilo
git add -A && git commit -m "<kratko, srpski>" && git push origin master
```

- Commit poruka: kratak srpski naslov; telo po potrebi (šta i zašto).
- **Provera pre commit-a:** `grep -rniE "sk-[a-z0-9]{8,}" .` (bez `.git`) i
  `git status` — nijedna tajna, nijedan log.
- Ako `.git` iz nekog razloga ne postoji (nov telefon, obrisan folder):
  ```bash
  cd /storage/emulated/0/Download/DSH-Restore
  git init && git branch -M master
  git remote add origin https://github.com/VladimirJecic/dsh-android-setup.git
  git fetch origin && git reset --mixed origin/master
  git add -A && git commit -m "DSH restore" && git push -u origin master
  ```
  (`reset --mixed` da se istorija nastavi, a ne da nastane unrelated commit.)
- Stariji datumski folderi (`DSH-Restore-20261007` i sl.) su istorijski; kad
  zatrebaju, mogu se obrisati — jedini radni worktree je `DSH-Restore`.

## Vraćanje (`restore.sh`)

- U arhivi: `bash restore.sh --dry-run` (samo prijava) pa `bash restore.sh`.
- Vraća u `~/dsh` skripte, `rules/`, dokumentaciju i pluginove; u profil
  `package.json` + `cordis.patch.yml`; u `~/.local/bin` launcher; u `~/.dsh`
  `AGENTS.md` i `skills/*`. Tajne se unose ručno (korak 9).
- Idempotentan je: pravi `.bak-<timestamp>` samo za fajl koji se stvarno menja.
- Za samo vraćanje `~/dsh` skripti i zakrpa (bez promene verzije):
  `bash ~/dsh/restore-patches.sh` — traži `DSH-Restore/dsh`, a razume i stari
  `DSH-Restore-<datum>`.
