# DSH Termux — restore arhiva (2026-10-07)

> Arhiva je preimenovana iz `DSH-Restore-20261006` i osvežena **2026-10-07**:
> **ujedinjen restart** (jedina komanda `restart-dsh`, skill + GUI komanda nad
> istim skriptom; ukinut dupli `/restart`), **prazna nova sesija (`+`) je
> ponovo smart po defaultu** (postojeći razgovori nisu), dodat je
> **`PRAVILA-DSH.md`** — konsolidovana pravila celog setup-a, i arhiva je prvi
> put objavljena na GitHub
> (**https://github.com/VladimirJecic/dsh-android-setup.git**). Prethodna
> osnova (dsh **0.2.0-rc.2**, `dsh-update.sh` sa **10 faza**, odloženi restart
> sa auto-rollback-om) i dalje važi; dokazi: `SANDBOX-DOKAZ-0.2.0-rc.2.md`.

Sve što treba da se vrati DSH setup na telefon posle reinstalacije / brisanja
`~/.dsh`. **Arhiva NE sadrži API ključeve** — oni se unose ručno (korak 9).

> 📌 **Pravila su sada konsolidovana u `PRAVILA-DSH.md`** (u korenu arhive) —
> restart, smart mode, sesije, pluginovi, tajne, update, Android zamke, arhiva
> i git. Ako se ovaj README i `PRAVILA-DSH.md` razilaze, `PRAVILA-DSH.md` je
> noviji; ako se i on razilazi sa kodom, **kod je istina**.


## ⚠️ NIKAD ne pokretati `dsh plugin` / pnpm dok dsh RADI

`dsh plugin --profile web add <pkg>` je omotač oko pnpm-a, a pnpm prepisuje
`~/.dsh/profiles/*/node_modules` **pod živim procesom**. To je dva puta oborilo
dsh (2026-09-15), a jednom je ostavilo profil u stanju iz kog ga je dsh pri
sledećem bootu resetovao na default šablon — pa su pluginovi tiho nestali.

**Uvek prvo ugasi dsh**, pa instaliraj:

```bash
bash ~/.dsh/skills/restart-dsh/restart-dsh.sh   # jedina komanda za restart (ili samo ugasi dsh)
dsh plugin --profile web add <pkg>
~/dsh/dsh-url.sh
```

### Zaštita koja sada postoji

`patch-android-dsh.py` (launcher ga zove pri SVAKOM startu) ima korak **4b** koji
tvrdo proverava profil:

- manifest postoji ali mu fale naši pluginovi u `bundles` → **doda ih**
- manifest je obrisan → **napravi ga** iz našeg šablona (umesto da dsh upiše
  default i tiho izgubi pluginove)

Ručna provera: `python3 ~/dsh/patch-android-dsh.py --check`

## Brzi put

```bash
# 1. sistemski paketi (dsh se instalira sam u koraku 2 — vidi koffi zamku)
pkg install nodejs python ripgrep -y

# 2. vrati setup iz arhive (restore.sh sam instalira dsh 0.2.0-rc.2 ako ga nema)
bash ~/storage/shared/Download/DSH-Restore-20261007/restore.sh --dry-run   # pogledaj
bash ~/storage/shared/Download/DSH-Restore-20261007/restore.sh             # primeni

# 3. unesi tajne (vidi korak 9 ispod)

# 4. pokreni i uzmi URL (restartuje + ispiše URL + pošalje ga u aplikaciju)
~/dsh/dsh-url.sh
```

> ⛔ **`npm install -g @deepseek-ai/dsh` sam NE prolazi na 0.2.x.** `dsh-fs-local`
> pinuje tačno `koffi@3.1.1`, a taj paket **nema** `@koromix/koffi-android-arm64`
> (android grana postoji tek od `3.2.1`). Zato `cnoke` prevodi iz izvora i pada na
> Bionicu (`base.cc:2967`, `statx`) — **pre ijednog instaliranog paketa**. Zato
> `restore.sh` radi testirani niz: `--ignore-scripts` instalacija → koffi `3.3.2`
> sa prebuildom → `npm rebuild` (node-pty `pty.node`). Isto radi i
> `~/dsh/dsh-update.sh` (faze 4b/4c).

## Šta je u arhivi

| Putanja | Ide u |
|---|---|
| `restore.sh` | pokreće se odavde (`--dry-run` ili primena) |
| `dsh/*.py`, `dsh/*.sh`, `dsh/*.mjs`, `dsh/*.cjs` | `~/dsh/` — uključuje **`dsh-update.sh`** (ručni updater, 10 faza), **`compat-scan.mjs`**, **`.restart-after-update.sh`** (odloženi restart + auto-rollback), `cache-report.py`, `session-turn-state.py`, `resume-after-restart.sh`, **`make-restore-archive.sh`** (pakovanje ove arhive) |
| `dsh/dsh-composer-extras/` | `~/dsh/dsh-composer-extras/` — **osveženo 2026-10-07**: `/restart-dsh` komanda (poziva skill skript), **smart se sam pali za praznu novu sesiju**; ranije: 📤 Podeli / 📂 Folder, multi-select + 🗑️, SMART branch (`branch-session`, `branch-info`, `prompt-session`) |
| `bin/dsh-termux` | `~/.local/bin/dsh-termux` |
| `profile/package.json`, `profile/cordis.patch.yml` | `~/.dsh/profiles/web/` — model, Gemini katalog, welcome-notice |
| `skills/*` (10 komada) | `~/.dsh/skills/` — `branch-into-new-session` (+`branch.sh`), `burn-subtitle`, `kljucne-reci-nemacki`, `partial-prevod`, **`restart-dsh` (+`restart-dsh.sh` — jedina implementacija restarta)**, `solid`, `uplati` (+`uplati.py`), `voice-input`, `wa-message`, `wa-message-audio` |
| `dsh-home/AGENTS.md` | `~/.dsh/AGENTS.md` — **user-global uputstva, dobija ih SVAKA sesija** |
| `PRAVILA-DSH.md` | **novo 2026-10-07**: konsolidovana pravila celog setup-a (restart, smart, sesije, pluginovi, tajne, update, Android zamke, arhiva, git) |
| `DSH-Termux-Kompletno-Uputstvo.md` | kompletno uputstvo (i u `~/dsh/`) — **osveženo 2026-10-07** (`/restart-dsh`, smart pravilo) |
| `SANDBOX-DOKAZ-0.2.0-rc.2.md` | **novo**: koffi zamka, 10 faza, sandbox dokazi, plugin na 0.2.0, odloženi restart |
| `SANDBOX-DOKAZ-tooluse-fix.md` | tool_use redosled (3f) — dokaz i ispravljena koffi napomena |
| `DIJAGNOZA-gemini-deepseek-tool-use.md` | dijagnoza `tool_use ids without tool_result` |
| `UPUTSTVO-dodatak-dugmad.md` | dodatak: 📤/📂/☑️/🗑️ (rute, zamke, restore) |
| `PLAN-composer-extras.md`, `PWA-AUTH-FIX.md`, `PROMPT-*.md`, `clear-context.md` | istorijski planovi/promptovi (referenca) |
| `_originali/` | originalni fajlovi od 2026-09-15, za referencu |

## Šta NIJE u arhivi (i zašto)

- **API ključevi** — nikad na deljeni storage. Vidi korak 9.
- **`@deepseek-ai/dsh`** — `restore.sh` ga instalira (korak 0). Svaki **sledeći**
  update ide kroz `~/dsh/dsh-update.sh`, ne kroz `npm install -g` (vidi
  „Ažuriranje" niže).
- **`dsh-context` plugin** — `restore.sh` ga instalira ako fali (traži mrežu).
- **`~/.dsh/sessions/`, `.credentials.yaml`, logovi, `.bak` fajlovi, screenshots** —
  tvoje/nepotrebno; arhiva je namerno čista.
- **`~/.dsh/settings.yaml`** — ukinut 2026-10-06: migriran je u
  `settings.yaml.imported`, a `agent-default-model` i `ui-onboarding` sada žive u
  `profile/cordis.patch.yml`. Vraćanje starog fajla bi vratilo pogrešan model.

## Korak 9 — tajne (obavezno ručno)

```bash
umask 077
cat > ~/.config/dsh-secrets.env <<'EOF'
export DEEPSEEK_API_KEY='...'
export GOOGLE_API_KEY='...'        # Gemini (za 😎 gemini-seek-smart)
# opciono:
export GROQ_API_KEY='...'
export HF_READ='...'
export HF_FULL='...'
EOF
chmod 600 ~/.config/dsh-secrets.env
```

⚠️ Ključ **ne** ide u `~/.dsh/.credentials.yaml`. Taj fajl treba da sadrži **samo**
record `client-connection/browser-session` (auth secret za browser cookie) i
`version`. Ako se taj record pregazi, **PWA „DSH 手机版" prestaje da radi**.

## Verifikacija posle restore-a

```bash
# 1. verzija i native delovi
node -p "require('/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/package.json').version"
ls /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/node-pty/build/Release/pty.node
ls /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@koromix/koffi-android-arm64/android_arm64/koffi.node

# 2. da li se profil diže i šta je učitano
dsh --profile web --dump-config | grep -nE 'composer-extras|dsh-context|llm-pi-ai'

# 3. da li su plugini živi (rute odgovaraju) — 400/200, ne 404
curl -s -o /dev/null -w 'composer: %{http_code}\n' \
  -X POST 'http://127.0.0.1:3081/composer-extras/api/fs-tree-workspace'

# 4. da li su zakrpe primenjene
python3 ~/dsh/patch-android-dsh.py --check

# 5. cookie je Lax (za PWA) — vidi Set-Cookie kad otvoriš URL sa tokenom
#    očekuje se: HttpOnly; SameSite=Lax
```

## Ažuriranje — kontrolisano, ručno (od 2026-09-29)

**Auto-update više ne postoji.** Ukinuti su, jedan po jedan:

| Šta je ukinuto | Gde je sada |
|---|---|
| `~/dsh/dsh-auto-update.sh` | **obrisan** (2026-09-29) |
| cron zapis (dnevna provera) | crontab je prazan |
| `crond` servis | **isključen i obrisan** iz `$PREFIX/var/service/`, proces ne radi |
| „>24h fallback" blok u launcheru | uklonjen iz `~/.local/bin/dsh-termux` |
| stamp fajl `~/.dsh/.last-update-check` | ne postoji |

Update se radi **isključivo ručno**, na izričit zahtev korisnika. Stari
`auto-update.log`, `_disabled/` i sve labave kopije van arhive su obrisani
(2026-09-29) — **jedini izvor istine je ova arhiva** (i `~/dsh/` iz koje se pravi).

Launcher pri **svakom** pokretanju samo *ispiše* verzije — ništa ne skida i ne
pokreće:

```
dsh: verzija — instalirano=<verzija> npm-latest=<verzija>
dsh: novija verzija je dostupna; update je ISKLJUCIVO RUCNI -> ~/dsh/dsh-update.sh
```

Druga linija se pojavi samo ako se verzije razlikuju. Kod passthrough poziva
(`dsh <args>`) ispis ide na **stderr** da ne zaprlja stdout, a `npm view` je
ograničen `timeout 12` — mrtav/offline registry ne odlaže boot.

Ručni updater je `~/dsh/dsh-update.sh`:

```bash
~/dsh/dsh-update.sh --check      # samo prijava: instalirano vs npm latest + opsezi plugina
~/dsh/dsh-update.sh              # update na npm latest
~/dsh/dsh-update.sh --version X  # pin na tačno X
~/dsh/dsh-update.sh --no-swap    # sve do validacije, bez diranja instalacije
~/dsh/dsh-update.sh --rollback   # vrati poslednji backup
~/dsh/dsh-update.sh --force      # nastavi i kad opsezi pluginova ne dozvoljavaju
```

Tok ima **10 faza**: lock (`~/.dsh/.dsh-update-lock`, PID + stale detekcija) →
verzije → kompatibilnost plugina (`compat-scan.mjs`) → sandbox instalacija
(`npm install --global --prefix <sandbox> --ignore-scripts`; **nikad** u pravi
globalni root; `--prefer-online` jer bajat keš daje lažni `ETARGET`) →
**4b koffi sa android prebuildom** (`dsh-fs-local` 0.2.x pinuje `koffi@3.1.1`, koji
android-arm64 prebuild nema — bez ove faze ceo `npm install` padne na
CMake/`statx` grešci; default `koffi@3.3.2`, može `DSH_UPDATE_KOFFI_VERSION`) →
**4c `npm rebuild`** (install/postinstall skripte nad već razrešenim drvetom:
`node-pty` `pty.node`, spawn-helper, protobufjs) → zakrpe na sandbox drvo
(`patch-android-dsh.py --root <sandbox> --pwa-samesite`: hardlink, dir-fsync,
ripgrep shim, cache-slot, flock mock, **require-builtin JS fallback**,
**tool_use redosled**, PWA SameSite) → validacija (version match, `npm ls`,
`no-hardlink.cjs`, flock mock, ripgrep shim, **native moduli: koffi i node-pty**,
boot smoke test na izolovanom `DSH_HOME` i slobodnom portu 3089–3092) → atomska
zamena (`mv` stare instalacije u
`<global-root>/.dsh-backup-<verzija>-<timestamp>`, pa `mv` sandboxa na njeno
mesto) → čišćenje sandboxa. **Bilo koja greška pre faze 7 ostavlja staru
instalaciju netaknutu.** Detalji: `SANDBOX-DOKAZ-0.2.0-rc.2.md`.

### Aktivacija — odloženi restart

Nova verzija se aktivira **tek u novom procesu** (stari drži učitane module).
Ako se update pokreće iz same dsh sesije, restart bi ubio tu sesiju, pa postoji
`~/dsh/.restart-after-update.sh`:

```bash
setsid nohup env IDLE=120 bash ~/dsh/.restart-after-update.sh >/dev/null 2>&1 &
```

1. čeka `IDLE` (120 s) mira u `~/.dsh/sessions/**` (ako korisnik piše — čeka
   dalje, najduže `MAX_WAIT`, default 2 h);
2. `pkill -f 'dsh/lib/bin[.]js'` → `~/.local/bin/dsh-termux` (ponovo primeni zakrpe);
3. čeka HTTP 200/301/302/401/403 do 90 s;
4. ako se **nije** digao → sam pokreće `dsh-update.sh --rollback` i diže staru;
5. log: `~/dsh/restart-after-update.log` + Android notifikacija; `DRY=1` = samo prijava.

Sandbox se pravi u `/tmp/dsh-update-sandbox` samo ako je u taj direktorijum
dozvoljeno pisanje; na Termuxu `/tmp` obično nije naš (mode 0731), pa se koristi
`${TMPDIR}/dsh-update-sandbox`. Log: `~/dsh/update.log` (append, ne rotira se).
Poslednji backup ostaje, pointer na njega je `<global-root>/.dsh-backup-latest`.

Ako treba samo vratiti `~/dsh` skripte i zakrpe (bez promene verzije):
`bash ~/dsh/restore-patches.sh` — **sam nađe najnoviju arhivu** u
`~/storage/shared/Download`.

## Pakovanje nove arhive (posle svake promene setup-a)

```bash
bash ~/dsh/make-restore-archive.sh          # datum = danas; folder + .zip
SHARE=1 bash ~/dsh/make-restore-archive.sh  # + Android share sheet
NOZIP=1 bash ~/dsh/make-restore-archive.sh  # samo folder
```

Uzme žive fajlove, prepiše ime arhive u putanjama (stari datum → novi, i u
`~/dsh` i u arhivi), očisti `__pycache__`/`*.bak-*` i spakuje `.zip`
(python `zipfile` — `zip` na Termuxu nije instaliran).

## Redosled pokretanja (važno)

1. `pkg install ripgrep` — sistemski `rg` mora postojati, shim pokazuje na njega
2. `~/dsh/patch-android-dsh.py --pwa-samesite` (launcher ga zove sam pri startu;
   isti prolaz pravi ripgrep shim, flock mock i require-builtin JS fallback)
3. `~/dsh/gemini-catalog-update.py` (isto)
4. dsh start
5. **hard refresh** browsera posle svake izmene klijentskog plugina — dsh ne
   hot-reload-uje klijentske bundlove
6. Za PWA: otvori tokenizovani URL **u aplikaciji** (`dsh-url.sh` to radi sam)

## Ako nešto ne radi

| Simptom | Uzrok | Rešenje |
|---|---|---|
| `npm install -g` padne na `koffi` / `base.cc:2967 statx` | `dsh-fs-local` 0.2.x pinuje `koffi@3.1.1` bez android prebuilda | ne radi `npm install -g`; koristi `~/dsh/dsh-update.sh` ili `restore.sh` (faze 4b/4c) |
| `EACCES ... link ...` | SELinux hard link | `python3 ~/dsh/patch-android-dsh.py` |
| `EACCES ... open '/data/data'` | attachment fsync pretke | isto (dir-fsync zakrpa) |
| PWA traži autentikaciju | cookie je `SameSite=Strict` | `--pwa-samesite` + restart |
| dugmad u composer-u ne reaguju | `props.sessionId` (ne `props.session`) | već rešeno u `client.js`; hard refresh |
| `ripgrep launch failed` / `glob` ne kreće | `@vscode/ripgrep` 1.18+ traži platformski paket `@vscode/ripgrep-android-<arch>`, a android build **ne postoji** na npm-u | `pkg install ripgrep` **+** `python3 ~/dsh/patch-android-dsh.py` (pravi shim paket čiji `bin/rg` pokazuje na sistemski `rg`) |
| dva dsh procesa nad istom sesijom se ne isključuju | `flock(2)` je mock (nema `node-addon-system-android-arm64`) | ne pokreći dva dsh-a nad istom sesijom; stanje: `python3 ~/dsh/patch-android-dsh.py --check` |
| **fatalan boot**: `host preparation failed: No usable native binding found for node-addon-require-builtin-android-arm64 (auto)` | npm ne isporučuje android-arm64 prebuild, a glibc `.node` se na Bionicu ne učitava (`libgcc_s.so.1`) | `python3 ~/dsh/patch-android-dsh.py` (zakrpa **3e**: `require-builtin` JS fallback) |
| terminal alati pucaju, `pty.node` ne postoji | `--ignore-scripts` instalacija bez `npm rebuild` | `npm rebuild --global` (faza 4c), pa restart |
| `dsh --profile is required` | pozvan `/usr/bin/dsh` | koristi bash funkciju `dsh` ili `~/.local/bin/dsh-termux` |
| Gemini se ne vidi u pickeru | katalog | `python3 ~/dsh/gemini-catalog-update.py` |
| posle update-a i dalje stara verzija | živi proces drži staru | restart: `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` (ili `.restart-after-update.sh`) |

Detaljna dijagnostika klijenta: `~/dsh/composer-diag.log` (svaki klik na dugme
composer-extras-a upisuje `propKeys`/`hasSession`/`sessionId`).
