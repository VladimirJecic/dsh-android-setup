# 07. Restore arhiva i git

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Skripte:
> `~/dsh/make-restore-archive.sh`, `restore.sh` (u arhivi),
> `~/dsh/restore-patches.sh`.

## Šta je arhiva

- **Živi izvor je `~/dsh`** (+ `~/.dsh`, `~/.local/bin/dsh-termux`, profil).
  Arhiva je **snapshot** tog stanja: folder
  `/storage/emulated/0/Download/DSH-Restore-YYYYMMDD` + istoimeni `.zip`.
- Arhiva je istovremeno i **git repo** → <https://github.com/VladimirJecic/dsh-android-setup.git>
  (branch `master`, nalog **VladimirJecic**; auth preko `gh`,
  `gh auth git-credential` je u `~/.gitconfig`, `git push` ne pita ništa).
- **Sadržaj repo-a = sadržaj `DSH-Restore-YYYYMMDD` foldera** (bez tajni).
  Commit-uje se **iz tog foldera**.

## Pakovanje (`make-restore-archive.sh`)

```bash
bash ~/dsh/make-restore-archive.sh            # datum = danas (YYYYMMDD)
bash ~/dsh/make-restore-archive.sh 20261007   # osveži POSTOJEĆI folder tog datuma
NOZIP=1 bash ~/dsh/make-restore-archive.sh    # samo folder
SHARE=1 bash ~/dsh/make-restore-archive.sh    # + Android share sheet
```

Šta radi:

1. uzme **prethodnu** arhivu kao osnovu (`restore.sh`, `README-RESTORE.md`,
   `README.md`, `.gitignore`) — ali **ne** njen `.git`; ako folder za taj datum
   već postoji, **osvežava ga u mestu** i ne dira `.git`;
2. osveži iz živog sistema: `~/dsh/*.md` (u koren arhive), **`~/dsh/rules/*.md`
   → `rules/`**, skripte iz `SCRIPTS` spiska → `dsh/`, oba lokalna plugina,
   `bin/dsh-termux`, profil (`package.json`, `cordis.patch.yml`),
   `dsh-home/AGENTS.md`, `skills/*` (symlinkovi se dereferenciraju),
   `tests/*.mjs` + `tests/*.py`;
3. prepiše ime arhive u putanjama (stari datum → novi, i u arhivi i u `~/dsh`) —
   samo ako je `PREV` drugi datum;
4. očisti `__pycache__`, `*.bak-*`, `*.pyc`;
5. spakuje `.zip` (python `zipfile`; `zip` na Termuxu nije instaliran).

**Pravila:**

- **Obrisan fajl se NE vraća** osvežavanjem u mestu — ali ako praviš **novi
  datum**, folder se kopira iz prethodne arhive, pa tamo obrisano **vaskrsne**:
  obriši ga i u novom folderu.
- Novi lokalni plugin → dodaj ga u `make-restore-archive.sh` (`for plugin in …`)
  **i** u `patch-android-dsh.py` (`LOCAL_PLUGINS`)
  ([`04-instalacija.md`](04-instalacija.md)).
- Nova operativna skripta → dodaj je u `SCRIPTS` **i** u `restore.sh`
  (`DSH_FILES`), inače restore ostavi dokumentovanu komandu bez skripte.
- **Nikad ne komituj:** API ključeve, `~/.dsh/sessions/`,
  `.credentials.yaml`, `settings.yaml`, logove, `.bak` fajlove, screenshote,
  `node_modules`, `__pycache__`.

## Vraćanje (`restore.sh`)

- U arhivi: `bash restore.sh --dry-run` (samo prijava) pa `bash restore.sh`.
- Vraća u `~/dsh` skripte, **`rules/`**, dokumentaciju, pluginove; u profil
  `package.json` + `cordis.patch.yml`; u `~/.local/bin` launcher; u `~/.dsh`
  `AGENTS.md` i `skills/*`. Tajne se unose ručno (korak 9).
- Za samo vraćanje `~/dsh` skripti i zakrpa (bez promene verzije):
  `bash ~/dsh/restore-patches.sh` — sam nađe najnoviju arhivu u
  `~/storage/shared/Download`.

## Git workflow (ono što se stvarno radi)

```bash
# 1. izmeni živi sistem (~/dsh, plugin, profil, pravila)
# 2. osveži arhivu (isti datum da istorija ostane neprekinuta)
bash ~/dsh/make-restore-archive.sh 20261007
# 3. proveri i objavi
cd /storage/emulated/0/Download/DSH-Restore-20261007
git status --short
git add -A && git commit -m "<kratko, srpski>" && git push origin master
```

- Commit poruka: kratak srpski naslov; telo po potrebi (šta i zašto).
- **Provera pre commit-a:** `grep -rniE "sk-[a-z0-9]{8,}" .` (bez `.git`) i
  `git status` — nijedna tajna, nijedan log.
- Kod **novog datuma** (nov folder) repo se povezuje prvi put:
  ```bash
  cd /storage/emulated/0/Download/DSH-Restore-<danas>
  git init && git branch -M master
  git remote add origin https://github.com/VladimirJecic/dsh-android-setup.git
  git fetch origin && git reset --mixed origin/master
  git add -A && git commit -m "DSH restore <danas>" && git push -u origin master
  ```
  (`reset --mixed` da se istorija nastavi, a ne da nastane unrelated commit.)
- Pravilo iz prakse: kad se folder arhive **ne menja** (isti datum), drži ga kao
  jedini worktree tog repo-a; starije foldere sa svojim `.git` možeš obrisati kad
  te verzije više ne trebaju.

## Šta putuje, a šta ne

| Putuje u arhivu | Ne putuje |
|---|---|
| `restore.sh`, `README.md`, `README-RESTORE.md`, `.gitignore` | tajne (`~/.config/dsh-secrets.env`) |
| `~/dsh/*.md` (uputstvo, `PRAVILA-DSH.md` indeks, `UPUTSTVO-*`) | `~/.dsh/.credentials.yaml`, `settings.yaml` |
| **`rules/*.md`** | `~/.dsh/sessions/`, `session_projcache` |
| `dsh/*.py|*.sh|*.mjs|*.cjs` (spisak `SCRIPTS`) | logovi (`*.log`), `.bak-*`, screenshots |
| `dsh/<plugin>/` (oba lokalna plugina) | `node_modules`, `__pycache__`, `.zip` |
| `tests/*.mjs`, `tests/*.py` | |
| `bin/dsh-termux`, `profile/*`, `dsh-home/AGENTS.md`, `skills/*` | |
