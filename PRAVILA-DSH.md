# PRAVILA DSH setup-a (Termux / Android)

> Konsolidovana pravila ovog setup-a — **jedan dokument za sve odluke koje se
> ne smeju pogaziti**. Nastao 2026-10-07 iz `DSH-Termux-Kompletno-Uputstvo.md`
> i iz stvarnih bug-ova/žalbi korisnika. Ako se dokument i kod razilaze, **kod
> je istina**, pa se ovo ažurira uz svaku izmenu.
>
> Stanje na dan pisanja: dsh **0.2.0-rc.2**, port **3081**, profil **web**,
> plugin **dsh-composer-extras** (lokalni, `link:` u profil).

---

## 0. Najvažnija pravila (TL;DR)

1. **Restart je JEDNA komanda — `restart-dsh`.** Nikad ručni `pkill`+`nohup`.
2. **Prazna nova sesija (`+`) je smart po defaultu; postojeći razgovor NIJE.**
3. **Nikad `dsh plugin` / pnpm dok dsh radi** — pnpm prepisuje profil pod živim
   procesom i obara dsh.
4. **Tajne samo u `~/.config/dsh-secrets.env` (0600)** — nikad u arhivu ni u
   `~/.dsh/.credentials.yaml`.
5. **Update je isključivo ručan** (`~/dsh/dsh-update.sh`) i aktivira se **tek
   posle restarta**.
6. **Posle izmene klijentskog bundla → hard refresh** (dsh ne hot-reload-uje
   klijentske bundlove).
7. **Restartuj samo preko `~/.local/bin/dsh-termux`** — on pri bootu primenjuje
   Android zakrpe; `/usr/bin/dsh` i `dsh` alias ih preskaču.
8. **Ne ostavljaj dva dsh procesa nad istom sesijom** — `flock(2)` je mock.

---

## 1. RESTART — jedna komanda, jedan skript

### Pravilo

Restart ima **tačno jednu implementaciju**:
`~/.dsh/skills/restart-dsh/restart-dsh.sh` (fizički:
`~/.claude/skills/restart-dsh/restart-dsh.sh`, u `~/.dsh/skills` je symlink).

| Ulaz | Kako zove skript |
|---|---|
| **„+" meni u dsh GUI-ju** → `/restart-dsh` | serverska komanda iz `dsh-composer-extras` plugina: detaširano `bash restart-dsh.sh --delay 2 --quiet` |
| **Skill `restart-dsh`** (agent/terminal) | agent pokrene `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` |
| **Ručno iz terminala** | isto: `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` |

Ime je na oba mesta isto — **`restart-dsh`**. Skill nosi
`user-invocable: false` da se isti naziv ne pojavi dvaput u „+" meniju
(jednom kao *Skills*, jednom kao *Commands*); model ga i dalje vidi i poziva.

### Zašto (istorija)

Ranije su postojale **dve** komande za istu stvar: `/restart` (plugin) i skill
`restart-dsh`, sa **odvojenom logikom** — pa su se razlikovale i unosile
zabunu. Ujedinjeno 2026-10-07: plugin više ne zna kako se restartuje, samo
pozove skript.

### Šta skript radi (i šta se NIKAD ne radi ručno)

1. `pkill -f 'dsh/lib/bin[.]js'` (pa `-9` ako se ne preda u ~3 s);
2. detaširano `setsid nohup ~/.local/bin/dsh-termux >> ~/dsh/dsh-web.log 2>&1 &`;
3. čeka da port 3081 odgovori: **200/301/302/401/403 = živ**, `000` = mrtav;
4. log u `~/dsh/restart-dsh.log` + Android notifikacija;
5. exit 0 ako je živ, 1 ako nije.

Argumenti: `--delay SEKUNDI`, `--quiet`.

**Zabranjeno:** `pkill -f 'dsh/lib/bin[.]js' && dsh` (preskače wrapper i
Android zakrpe) i `nohup dsh` (nohup ne prolazi kroz bash funkciju `dsh`, nego
gađa `/usr/bin/dsh`, kome treba `--profile`).

### Posle restarta

- Menjan klijentski bundle → **hard refresh** u browseru.
- „Failed to load plugins" → bundle nije umotan u
  `window.__ModuleLoader__.load({id, factory})`; dsh loader **nije** običan ESM.
- Provera: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081`.

---

## 2. SMART MODE (`gemini-seek-smart`, dugme 😎)

### Šta je

Rotacija modela: **2 prompta na Gemini Flash-Lite**, pa **60 s cooldown na
DeepSeek Flash**, pa nazad na Gemini — dok je uključeno. Cilj: koristi Gemini
free tier dok ide, a DeepSeek upadne kad Gemini padne na 429.

Raspored (`GEMINI_SEEK_SCHEDULE` u `client.js`):
`google/gemini-flash-lite-latest` (count 2, `windowMs` 60 s) →
`deepseek-official/deepseek-flash` (cooldown 60 s).

### KADA se pali sam (pravilo od 2026-10-07)

| Sesija | Smart |
|---|---|
| **Prazna nova sesija** (dugme „+", `SessionSummary.blank === true`) | **DA** — podrazumevano |
| Postojeći razgovor sa istorijom | **NE** |
| Sesija koju je `branch-into-new-session` označila kao smart (`…-on-<id>`) | DA |
| Bilo koja sesija sa eksplicitnim 😎 „off" (`…-off-<id>`) | NE — klik pobeđuje sve |

- „Prazna" = DSH-ov sopstveni `blank` flag iz `sessions.list`; DSH ga obori na
  `false` čim prvi prompt uđe (sesija postane *engaged*).
- **Zašto tako:** prva verzija fix-a ugasila je auto-paljenje svuda (žalba
  „sam se uključio Smart mode kada sam se prebacio na razgovor"), pa je i
  obična nova prazna sesija ostala bez smart-a — korisnik je to odbio. Sada je
  prazna sesija smart, a **postojeći** razgovori nisu.
- Stari globalni `localStorage` ključ
  `composer-extras-gemini-seek-default-enabled` se **namerno ne čita** (da
  ranije upisano `true` ne bi ponovo palilo smart svuda).

### Automatizam koji NE treba kvariti

- **429 reakcija:** `session.lastAgentError` protiv
  `/RESOURCE_EXHAUSTED|"code"\s*:\s*429/` — odmah skok na DeepSeek + auto
  `"try again"`, ne čeka se kraj budžeta.
- **Ručni izbor modela gasi toggle** (`directory.store.subscribe`), ali
  `applyingSwitch` blokira reakciju na sopstveni switch — bez toga se toggle
  gasio na svaki auto-switch.
- **Granica 300k tokena:** sesija koja je prerasla Gemini free tier
  (250k input tokena/min) se sama isključi **u trenutku** kad bi inače prešla
  na Gemini; per-session „off" oznaka to pamti.
- **`gemini-flash-lite-latest` NE SME da se izbaci iz kataloga** — bez njega
  nema ni smart-a. Katalog održava `~/dsh/gemini-catalog-update.py` (launcher
  ga zove pri startu).
- Kvota je **per Google Cloud projekat**, ne per ključ — drugi Gemini ključ na
  istom projektu ne pomaže.

---

## 3. MODELI

- Default agent model: **`deepseek-official/deepseek-flash`**, `reasoningEffort: high`
  (`profile/cordis.patch.yml`, čvor `agent-default-model`).
- Gemini ide preko `llm-pi-ai` adaptera, ruta `google`, ključ `GOOGLE_API_KEY`.
- `deepseek-flash` se **ne deklariše** u `llm-pi-ai` — servira ga native
  `llm-deepseek` adapter iz `dsh-base`; drugi adapter na istoj ruti se odbija
  kao `DUPLICATE_ADAPTER`.

---

## 4. SESIJE

- **`blank` sesija se reuse-uje:** „+" ne pravi uvek novu — DSH preuzme
  postojeću praznu sesiju u istom workspace-u.
- **Grupa = workspace.** `branch-into-new-session` pravi novu praznu sesiju u
  **istom** workspace-u kao pozivajuća, sa **smart startom** (prvi prompt ide
  Gemini) i **odmah se zaustavlja**.
- **Zaštita od ponovnog grananja:** branch ruta upisuje oznaku u
  `~/dsh/.branch-into-new-session/children/<sessionId>` i uz prompt šalje
  `<system-reminder>` koji modelu zabranjuje da sam pozove skill grananja.
  Bez oba, model u novoj sesiji pročita prompt o grananju i napravi **još**
  jednu sesiju (izmereno 2026-10-07).
- Oznaka „ova sesija je smart-branched" je u `localStorage` i preživljava
  reload i restart.

---

## 5. PLUGINOVI I IZMENE

- Profil `web` učitava bundlove: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`,
  `dsh-composer-extras` (lokalni).
- **Nova plugina ili nova ruta traže restart.** Config override postojećeg čvora
  se primenjuje u letu (`patchReload: live`).
- **Klijentski bundle se NE hot-reload-uje** → hard refresh.
- **Nikad `dsh plugin --profile web add …` dok dsh radi.** Uvek prvo ugasi:
  ```bash
  bash ~/.dsh/skills/restart-dsh/restart-dsh.sh   # ili ugasi, pa instaliraj
  ```
  `patch-android-dsh.py` korak **4b** čuva profil (dodaje naše pluginove u
  `bundles` ili pravi manifest iz šablona).
- Pre restarta uvek: `node -c client.js && node -c index.js`.

### `dsh-composer-extras` — šta sme

- Sve API rute su **loopback-only** (`127.0.0.1`/`localhost`/`::1`).
- Write akcije (upload/mkdir/rename/delete) su **workspace-scoped**; „delete"
  traži `confirm:true`.
- „Unrestricted" mod je **samo čitanje** van workspace-a (namerno odobreno).
- `android-share`/`android-folder` idu preko `termux-share`/`am start`.

---

## 6. TAJNE

```bash
umask 077
cat > ~/.config/dsh-secrets.env <<'EOF'
export DEEPSEEK_API_KEY='...'
export GOOGLE_API_KEY='...'        # Gemini (😎 smart)
# opciono: GROQ_API_KEY, HF_READ, HF_FULL
EOF
chmod 600 ~/.config/dsh-secrets.env
```

- **`~/.dsh/.credentials.yaml` NE sme da nosi API ključeve** — samo record
  `client-connection/browser-session` + `version`. Ako se pregazi, PWA
  „DSH 手机版" prestaje da radi.
- **Tajne nikad u restore arhivu ni na deljeni storage.**
- PWA cookie: `SameSite=Lax` (zakrpa `--pwa-samesite`); `Strict` obara PWA
  auth.

---

## 7. UPDATE (isključivo ručan)

- Auto-update **ne postoji**: nema cron-a, nema `crond`, nema „>24h fallback"
  bloka u launcheru, nema `~/.dsh/.last-update-check`.
- Launcher pri svakom startu samo **ispiše** verzije.
- `~/dsh/dsh-update.sh`: `--check`, `--version X`, `--no-swap`, `--rollback`,
  `--force`. **10 faza**, sandbox instalacija, nikad u pravi globalni root.
- **`npm install -g @deepseek-ai/dsh` sam NE prolazi na 0.2.x** — `dsh-fs-local`
  pinuje `koffi@3.1.1` bez android-arm64 prebuilda (pad na `base.cc:2967 statx`).
  Zato faze **4b** (koffi sa prebuildom) i **4c** (`npm rebuild` za `pty.node`).
- **Aktivacija tek u novom procesu** → odloženi restart
  `~/dsh/.restart-after-update.sh` (čeka `IDLE` mira u sesijama, restartuje,
  verifikuje, i **sam rollback-uje** ako se dsh ne digne).
- Bilo koja greška pre faze 7 ostavlja **staru instalaciju netaknutu**.

---

## 8. ANDROID / TERMUX ZAMKE (i šta ih rešava)

| Zamka | Rešenje |
|---|---|
| `EACCES … link` (SELinux) | `python3 ~/dsh/patch-android-dsh.py` (hard-link zakrpa) |
| `EACCES … open '/data/data'` | isto (dir-fsync zakrpa) |
| `ripgrep launch failed` / glob mrtav | `pkg install ripgrep` + `patch-android-dsh.py` (shim) |
| `No usable native binding … require-builtin-android-arm64` | `patch-android-dsh.py` (3e — JS fallback) |
| `pty.node` ne postoji | `npm rebuild --global` (faza 4c), pa restart |
| `flock(2)` mock | **ne pokreći dva dsh-a nad istom sesijom** |
| `dsh --profile is required` | pozvan `/usr/bin/dsh`; koristi wrapper |

Launcher `~/.local/bin/dsh-termux` pri **svakom** bootu zove
`patch-android-dsh.py` i `gemini-catalog-update.py` — zato restart ide
isključivo preko njega.

---

## 9. ARHIVA / RESTORE

- **Jedini izvor istine je arhiva u `/storage/emulated/0/Download/DSH-Restore-YYYYMMDD`**
  (folder + `.zip`) i `~/dsh` iz koje se pravi.
- Pakovanje: `bash ~/dsh/make-restore-archive.sh`
  (`SHARE=1` → share sheet, `NOZIP=1` → samo folder). Uzima **prethodnu**
  arhivu kao osnovu, osveži iz živog sistema, prepiše datum u putanjama, očisti
  `__pycache__`/`*.bak-*`.
- Vraćanje: `restore.sh --dry-run` pa `restore.sh`.
- **U arhivi NEMA:** API ključeva, `~/.dsh/sessions/`, `.credentials.yaml`,
  `~/.dsh/settings.yaml` (ukinut), logova, `.bak` fajlova, `node_modules`.
- Arhiva sadrži: `restore.sh`, `README-RESTORE.md`, sve `~/dsh/*.md`, skripte,
  `dsh-composer-extras/`, `bin/dsh-termux`, `profile/`, `skills/*` (svi,
  symlinkovi dereferencirani), `dsh-home/AGENTS.md`.

---

## 10. GIT (od 2026-10-07)

- Repo: **https://github.com/VladimirJecic/dsh-android-setup.git**
- Nalog: **VladimirJecic**, auth preko `gh` (`gh auth status`), helper
  `gh auth git-credential` već u `~/.gitconfig` → `git push` radi bez prompta.
- Sadržaj repo-a = **sadržaj `DSH-Restore-YYYYMMDD` foldera** (arhiva bez
  tajni), commit-ovan iz tog foldera.
- Postupak za novi datum:
  ```bash
  bash ~/dsh/make-restore-archive.sh                  # napravi DSH-Restore-<danas>
  cd /storage/emulated/0/Download/DSH-Restore-<danas>
  git init && git branch -M master
  git remote add origin https://github.com/VladimirJecic/dsh-android-setup.git
  git fetch origin && git merge --allow-unrelated-histories origin/master
  git add -A && git commit -m "DSH restore <danas>"
  git push -u origin master
  ```
- **Nikad ne komituj** tajne, sesije, `.credentials.yaml`, `node_modules`.

---

## 11. AGENT PRAVILA (globalno, `~/.dsh/AGENTS.md`)

- **„uplati" = `uplati` skill** — učitaj skill, ne izmišljaj IPS QR. Broj
  računa samo iz šablona/korisnika. Skill fizički živi u `~/.claude/skills/uplati`
  (symlink u `~/.dsh/skills`); ako ga nema u katalogu, proveri symlink.
- **Operacije duže od 5 minuta:** prekini petlju/retry, sačuvaj napredak u
  JSON/tekst, vrati kontrolu korisniku sa statusom. **Ne ostavljaj** aktivne
  `session.lock` fajlove ni zombi procese.
- Ne restartuj živi dsh bez izričite dozvole korisnika (kroz njega razgovara) —
  restart **na zahtev**, preko `restart-dsh`.
