# 05. Održavanje: update, testovi, logovi

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Postupak za
> čoveka: `~/dsh/DSH-Termux-Kompletno-Uputstvo.md`. Update skript:
> `~/dsh/dsh-update.sh` (izvor istine za faze).

## Update je isključivo ručan

- Auto-update **ne postoji**: nema cron-a, nema `crond`, nema „>24h fallback"
  bloka u launcheru, nema `~/.dsh/.last-update-check`.
- Launcher pri svakom startu samo **ispiše** verzije.
- `~/dsh/dsh-update.sh`: `--check`, `--version X`, `--no-swap`, `--rollback`,
  `--force`. **10 faza**, sandbox instalacija, nikad u pravi globalni root.

| # | Faza | Šta radi |
|---|---|---|
| 1 | lock | `~/.dsh/.dsh-update-lock` (PID + stale detekcija); drugi update ne može uporedo |
| 2 | verzije | instalirano vs npm latest, ili `--version X` |
| 3 | kompatibilnost | `~/dsh/compat-scan.mjs` nad `~/.dsh/profiles` — `KRSI`/`NEPOZNATO` prekidaju update osim uz `--force` |
| 4 | sandbox | `npm install --global --prefix <sandbox> --ignore-scripts @deepseek-ai/dsh@<verzija>` — **nikad** u pravi globalni root; `--prefer-online` (bajat keš ume da prijavi lažni `ETARGET`) |
| **4b** | **koffi** | ako `dsh/node_modules/koffi` nema android prebuild, koffi se zamenjuje verzijom koja **ima** (`3.3.2`, `DSH_UPDATE_KOFFI_VERSION`) |
| **4c** | **npm rebuild** | `npm rebuild --global --prefix <sandbox>` — `node-pty` node-gyp build (`pty.node`), spawn-helper, `protobufjs` |
| 5 | zakrpe | `patch-android-dsh.py --root <sandbox> --pwa-samesite` — hardlink, dir-fsync, ripgrep shim, cache-slot, flock mock, require-builtin JS fallback, tool_use redosled, PWA SameSite |
| 6 | validacija | version match, `npm ls`, `no-hardlink.cjs`, flock mock, ripgrep shim, native moduli (`koffi`, `node-pty`), **boot smoke test** na izolovanom `DSH_HOME` i portu 3089–3092 |
| 7 | atomska zamena | `mv` stare instalacije u `<global-root>/.dsh-backup-<verzija>-<timestamp>`, pa `mv` sandboxa na njeno mesto |
| 8 | čišćenje | sandbox se briše |

**Bilo koja greška pre faze 7 ostavlja staru instalaciju NETAKNUTU**, briše
sandbox i ispisuje izveštaj. Log: `~/dsh/update.log` (append, ne rotira se).

**Zašto ne `npm install -g` ručno:** `dsh-fs-local` pinuje `koffi@3.1.1` bez
android-arm64 prebuilda → `cnoke` prevodi iz izvora i pada na Bionicu
(`base.cc:2967`, `statx`) **pre ijednog instaliranog paketa**. Zato faze 4b/4c.

**Boot smoke test iz faze 6 nije formalnost** — on je otkrio regresiju sa
`node-addon-require-builtin`: sveža instalacija **istog** izdanja se dizala sa
fatalnom greškom, pa bi update bez validacije „uspeo", a dsh se posle restarta
**ne bi digao**. HTTP 200/301/302/401/403 = uspeh, smrt procesa u prvim
sekundama = neuspeh.

### Aktivacija — odloženi restart

Nova verzija se aktivira **tek u novom procesu**. Ako se update pokreće iz same
dsh sesije, trenutni restart bi ubio tu sesiju, pa postoji
`~/dsh/.restart-after-update.sh`:

```bash
setsid nohup env IDLE=120 bash ~/dsh/.restart-after-update.sh >/dev/null 2>&1 &
```

1. čeka `IDLE` (120 s) mira u `~/.dsh/sessions/**` (ako korisnik piše — čeka
   dalje, najduže `MAX_WAIT`, default 2 h);
2. `pkill -f 'dsh/lib/bin[.]js'` → `~/.local/bin/dsh-termux` (zakrpe se
   primenjuju ponovo);
3. čeka HTTP 200/301/302/401/403 do 90 s;
4. ako se **nije** digao → sam pokreće `dsh-update.sh --rollback` i diže staru;
5. log: `~/dsh/restart-after-update.log` + Android notifikacija; `DRY=1` = samo
   prijava.

Ako treba samo vratiti `~/dsh` skripte i zakrpe (bez promene verzije):
`bash ~/dsh/restore-patches.sh` — sam nađe najnoviju arhivu u
`~/storage/shared/Download`.

## Rutina posle svakog update-a (checklist)

1. `python3 ~/dsh/gemini-catalog-update.py` — mora da kaže `[ok] katalog
   podesen (2 gemini modela, deepseek na native ruti)`.
2. `python3 ~/dsh/preset-compaction-sync.py` — prepiše `auto: false` +
   `thresholdRatio: 0.6` u deklaracije preseta
   ([`03-kontekst-i-kompakcija.md`](03-kontekst-i-kompakcija.md)).
3. `node ~/dsh/compat-scan.mjs <verzija> ~/.dsh/profiles` — `KRSI`/`NEPOZNATO`
   na pluginovima znače da plugin treba ažurirati ili `--force`.
4. `python3 ~/dsh/patch-android-dsh.py` — zakrpe (launcher ih ionako primenjuje).
5. Svi testovi (tabela ispod) — moraju biti zeleni.
6. `restart-dsh`, pa **hard refresh** i provera da su oba lokalna plugina tu.

## Testovi (dokazuju pravila, ne samo tvrde)

Žive u **`~/dsh/tests/`** i putuju u arhivu kao `tests/` (isti relativni put
`../dsh-composer-extras/client.js` radi i u `~/dsh` i u arhivi).

```bash
node ~/dsh/tests/test-composer-extras-smart-default.mjs      # 31 provera — smart pravilo + restart regresija
node ~/dsh/tests/test-composer-extras-context-guard.mjs      # 73 provere — context guard (prag 50%), modal, pill, branch
node ~/dsh/tests/test-preset-compaction.mjs                  # 16 provera — auto: false + prag 60%
node ~/dsh/tests/test-chat-jump-arrows.mjs                   # 53 provere — ▲▼ kroz moje poruke + sklanjanje pod pickerom
python3 ~/dsh/tests/test-gemini-catalog-update.py            # 22 provere — `!!js` u cordis.patch.yml + auto-ispravka kataloga
```

- `test-composer-extras-smart-default.mjs` — **obavezno zelen posle svake
  promene smart pravila.** Pokriva: prazna sesija → smart ON, lista još
  `pending` → OFF, postojeći razgovor → OFF, `…-on-` oznaka → ON, `…-off-` klik →
  OFF, server `branch-info.smart:true` → ON, i **restart regresiju**: neblank
  sesija sa `…-on-` oznakom i **nepoznatim** kontekstom ne sme da prebaci model
  na Gemini (a kad projekcija stigne sa >300k → OFF + „off" oznaka; sa <300k →
  ON). Harness ima deterministički `setTimeout`, pa se čekanje na projekciju
  (12 × 250 ms) pušta ručno — test ne spava 3 s.
- `test-preset-compaction.mjs` — čuva `auto: false` i prag 60% na sva tri
  preseta. **Ovo je test koji pada ako dsh update promeni preset** (tada pokreni
  `~/dsh/preset-compaction-sync.py` i ponovo ga pusti).
- `context-guard` harness je **ceo zelen** od 2026-10-08 (**73/0**). Ranija 3
  crvena su bila stvarna neusklađenost, ne artefakt: dva su tražila prag od 500k
  dok je kod imao 40% prozora (sad 50% — poklapa se), a treće je testiralo staru
  implementaciju dugmeta (draft + `submit`), dok dugme odavno zove
  `POST /composer-extras/api/compact`. Sekcija **4b** čuva modal (portal u
  `document.body`, centriranje, klik na masku, Esc) i **mesto pill-a** (nema
  `right`, merenje preko `[data-composer-card]` + `aria-haspopup="listbox"`), a
  sekcija **7** trenutno sklanjanje kartice na klik + pill „📦 Kompaktujem…".
- `test-chat-jump-arrows.mjs` — 53 provere
  ([`06-pluginovi.md`](06-pluginovi.md)). Lažni DOM ima pravu geometriju skrola,
  pa se proverava ponašanje: `steering` se broji, skrivene/ugnježdene ne,
  dsh-ova kompenzacija pozicije se ispravlja, pozicija je uz ivicu **razgovora**,
  i **sekcija 10**: dok postoji `[data-dsh-overlay-surface]` (picker),
  `role="dialog"`+`aria-modal` ili `role="menu"`, ništa se ne renderuje; kad se
  overlay zatvori, strelice se vraćaju sa istim badge-om; **skriven** meni
  (`hidden`) ne sakriva strelice.
- `test-gemini-catalog-update.py` — 22 provere za
  `~/dsh/gemini-catalog-update.py`. Čuva `!!js` regresiju: cordis dozvoljava JS
  izraze (`disabled: !!js process.platform === 'win32'`) i PyYAML ih rešava u
  `tag:yaml.org,2002:js`, pa je multi-konstruktor registrovan samo pod `"!"`
  propuštao taj tag → **ceo patch sloj se nije parsirao pri svakom startu** i
  Gemini katalog se tiho nije osvežavao (popravljeno 2026-10-08). Test pokriva i
  duplikat ključa, `diagnose()` slučajeve (DUPLICATE_ADAPTER, model koji fali) i
  da se **tuđi** `cordis.patch.yml` nikad ne prepisuje.

Harness ne pokreće browser: lažni React (`useEffect` se stvarno izvršava u smart
testu), lažni `window.__ModuleLoader__`, `localStorage`, `ctx.sessions.list`/
`binding` (uključujući `contextPressure` projekciju) i model-directory koji
beleži `select()` pozive.

## Logovi

| Fajl | Šta piše |
|---|---|
| `~/dsh/dsh-web.log` | stdout celog dsh procesa (launcher) — prvo mesto za „plugin se nije učitao" |
| `~/dsh/restart-dsh.log` | svaki restart iz skilla/GUI-ja |
| `~/dsh/restart-after-update.log` | odloženi restart posle update-a (+ rollback) |
| `~/dsh/update.log` | `dsh-update.sh` (append, ne rotira se) |
| `~/dsh/composer-diag.log` | `reportDiag()` iz composer-extras (klikovi, propovi, greške) |

- Logovi **nikad ne idu u arhivu** (`*.log` je u `.gitignore`), pa se **ručno
  brišu** kad postanu smeće. Kad se obriše neka probe-skripta, obriši i njen log
  (npr. `restart-when-idle.log`).
- Korisni filteri: `grep -i "composer-extras\|ModuleLoader\|Failed to load"
  ~/dsh/dsh-web.log`.

## Redosled pokretanja (važno)

1. `pkg install ripgrep` — sistemski `rg` mora postojati (shim pokazuje na njega).
2. `~/dsh/patch-android-dsh.py --pwa-samesite` (launcher ga zove sam).
3. `~/dsh/gemini-catalog-update.py` (isto).
4. `~/dsh/preset-compaction-sync.py` (isto).
5. dsh start preko `~/.local/bin/dsh-termux`.
6. **hard refresh** browsera posle svake izmene klijentskog plugina.
