# PRAVILA DSH setup-a (Termux / Android)

> Konsolidovana pravila ovog setup-a — **jedan dokument za sve odluke koje se
> ne smeju pogaziti**. Nastao 2026-10-07 iz `DSH-Termux-Kompletno-Uputstvo.md`
> i iz stvarnih bug-ova/žalbi korisnika. Ako se dokument i kod razilaze, **kod
> je istina**, pa se ovo ažurira uz svaku izmenu.
>
> Stanje na dan pisanja: dsh **0.2.0-rc.2**, port **3081**, profil **web**,
> pluginovi **dsh-composer-extras** i **dsh-chat-jump-arrows** (oba lokalna,
> `link:` u profil).

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
| **Prazna nova sesija** (dugme „+", `SessionSummary.blank === true`, lista `ready`) | **DA** — podrazumevano |
| Postojeći razgovor sa istorijom | **NE** |
| Sesija koju je `branch-into-new-session` označila kao smart (`…-on-<id>`) | DA — ali samo ako je kontekst poznat i ≤300k |
| Bilo koja sesija sa eksplicitnim 😎 „off" (`…-off-<id>`) | NE — klik pobeđuje sve |
| **Restart / hard refresh** velike sesije sa `…-on-<id>` oznakom | **NE** — vidi „Nepoznat kontekst" ispod |

- „Prazna" = DSH-ov sopstveni `blank` flag iz `sessions.list`, i to **samo kad
  je lista stvarno stigla** (`phase === "ready"`). DSH klijent za nepoznatu
  sesiju počinje kao „conservatively blank" (`session.d.ts`), pa bi `blank:
  true` iz liste koja još učitava vratio smart u razgovor sa istorijom.
- **Zašto tako:** prva verzija fix-a ugasila je auto-paljenje svuda (žalba
  „sam se uključio Smart mode kada sam se prebacio na razgovor"), pa je i
  obična nova prazna sesija ostala bez smart-a — korisnik je to odbio. Sada je
  prazna sesija smart, a **postojeći** razgovori nisu.
- Stari globalni `localStorage` ključ
  `composer-extras-gemini-seek-default-enabled` se **namerno ne čita** (da
  ranije upisano `true` ne bi ponovo palilo smart svuda).
- **Svako gašenje se PAMTI** (`…-off-<id>` u `localStorage`): i 😎 klik, i
  granica od 300k, i **ručni izbor modela** u dropdownu. Do 2026-10-07 je
  ručni izbor gasio smart samo u memoriji, pa ga je prvi reload/restart vratio.

### Nepoznat kontekst NE SME da prebaci model (fix 2026-10-07)

Žalba: „restart dsh je uzrokovao da se smart dugme uključi za ovu sesiju, a
kontekst je već velik." Uzrok je bio **fail-open** guard: `sessionContextTokens`
čita `contextPressure` projekciju, a ona je posle restarta/hard refresh-a
prazna dok se sesija ne uveze i ne replay-uje — pa je `undefined` značilo
„nije prevelika", `activateGeminiSeek` je prebacio model na Gemini, i tek je
sledeći submit otkrio da je sesija >300k (a do tada je već bio na Gemini-ju).

Pravilo sada:

- `geminiContextVerdict()` vraća tri stanja: `"ok"` / `"too-big"` / `"unknown"`.
- **Automatsko paljenje** (prazna sesija ili `…-on-` oznaka) sa `"unknown"` i
  sesijom koja **nije dokazano prazna** → **čeka** projekciju (12 × 250 ms ≈ 3 s)
  pa odlučuje; ako i posle toga nema broja → **ostaje isključeno**. Model se
  **nikad** ne prebacuje na slepo.
- **Dokazano prazna sesija** se pali odmah (nema istorije koju bi merio).
- **Ručni 😎 klik** ostaje trenutan, ali dobija watchdog: ako se ispostavi da je
  kontekst >300k, smart se gasi, model se vraća na DeepSeek i upisuje se „off".
- **Submit sa >300k** sada **vraća model na DeepSeek PRE slanja** (ranije je
  gasio smart, ali je zahtev ipak išao na Gemini koji je ostao izabran).

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
  `dsh-composer-extras`, `dsh-chat-jump-arrows` (oba lokalna).
- **Nova plugina ili nova ruta traže restart.**
- **Ručna izmena `cordis.patch.yml` važi od sledećeg starta.** `patchReload: live`
  stoji u `package.json` profila, ali se u 0.2.0-rc.2 **nigde u kodu ne čita**
  (provereno 2026-10-07); launcher čita patch fajl jednom, pri bootu
  (`readProfilePatches`). U letu se primenjuju samo izmene koje GUI
  (Settings → Plugins) pošalje kroz loader. Zato: posle ručne izmene patcha →
  `restart-dsh`.
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

### `dsh-chat-jump-arrows` — ▲▼ kroz MOJE poruke (od 2026-10-07)

Namena: jedan odgovor agenta na telefonu ume da bude hiljade piksela procesa, a
korisnikovo pitanje ostane visoko iznad ekrana. Ovaj plugin daje dva lebdeća
chevrona uz **desnu ivicu razgovora** (ne ekrana):

- **▲** = prethodna **moja** poruka (`user` ili `steering`) — sleti 12px pod vrh;
- **▼** = sledeća moja poruka, a sa poslednje pada na **dno** (time se i DSH-ov
  `follow-tail` sam ponovo uključi);
- badge između njih pokazuje `n/m` (koja sam od koliko svojih poruka).

Pravila koja se ne smeju pogaziti:

- **Seat je `shell.overlay`** (root, click-through sloj iz `dsh-client-ui-layout`)
  — jedini zvanični „frame-wide floating" seat. Ništa u chatu se ne patchuje, pa
  `npm install -g @deepseek-ai/dsh@latest` ne može da ga obriše.
- **Strelice se vide samo kad postoji bar jedna moja poruka** u DOM-u; bez
  razgovora ili u tuđem view-u (npr. Trajectory) ne renderuje se ništa.
- **DSH-ova kompenzacija pozicije se brani:** ako paginacija stare istorije
  pomeri sadržaj posle sletanja, plugin jednom ispravi `scrollTop` — ali samo
  dok se skrol ne smiri i samo ako korisnik nije dirao ekran (gest otkazuje).
- **Ne koristi DSH interne iz `ui-chat`** (nema importa `viewport`/`scrollToTurn`);
  čita samo DOM atribute koje je DSH sam proglasio stabilnim:
  `[data-conversation-scroll]` (`.scrollBody`, pravi scrollport — unutrašnji
  `.scroll` je `overflow: visible`) i `[data-chat-flow-kind="user"|"steering"]`
  (najspoljašnji `.flowItem` sa `data-chat-anchor-key`).
- **Zašto ne ugrađeni turn rail:** `TurnNavigator` šeta TURN-ove (ne pitanja) i
  sakriven je na uskim ekranima (`@container (width<=900px){display:none}`), a
  ugrađeno „to bottom" dugme je samo jednosmerna polovina ovoga.
- Veze: `dsh.profile.bundles` + link u `profiles/web/node_modules`
  (vidi §5), `patch-android-dsh.py` 4b/4c ih čuvaju, `make-restore-archive.sh` i
  `restore.sh` ih nose u arhivi.

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

---

## 12. TESTOVI (dokazuju pravila, ne samo tvrde)

Žive u **`~/dsh/tests/`** i putuju u arhivu kao `tests/` (isti relativni put
`../dsh-composer-extras/client.js` radi i u `~/dsh` i u arhivi).

```bash
node ~/dsh/tests/test-composer-extras-smart-default.mjs      # 31 provera — smart pravilo + restart regresija
node ~/dsh/tests/test-composer-extras-context-guard.mjs      # context guard, branch, newline
node ~/dsh/tests/test-preset-compaction.mjs                  # 13 provera — compact prag 60%
node ~/dsh/tests/test-chat-jump-arrows.mjs                   # 43 provere — ▲▼ kroz moje poruke
```

- `test-composer-extras-smart-default.mjs` — **obavezno zelen posle svake
  promene smart pravila.** Pokriva: prazna sesija → smart ON, lista još
  `pending` → OFF, postojeći razgovor → OFF, `…-on-` oznaka → ON, `…-off-` klik
  → OFF, server `branch-info.smart:true` → ON, i **restart regresiju**: neblank
  sesija sa `…-on-` oznakom i **nepoznatim** kontekstom ne sme da prebaci model
  na Gemini (a kad projekcija stigne sa >300k → OFF + „off" oznaka; sa <300k →
  ON). Harness ima deterministički `setTimeout`, pa se čekanje na projekciju
  (12 × 250 ms) pušta ručno — test ne spava 3 s.

- `test-preset-compaction.mjs` — čuva §13: host `compaction-basic` je disabled,
  sva tri preseta imaju `thresholdRatio: 0.6`, i efektivni prag ispadne tačno 60%
  za oba rutirana modela. **Ovo je test koji pada ako DSH update promeni preset**
  (tada pokreni `~/dsh/preset-compaction-sync.py` i ponovo ga pusti).

- `context-guard` harness ima **3 poznata crvena** (compact/draft interakcija u
  `useEffect`-less fake React-u) — postoje i pre 2026-10-07 i nisu regresija.
  Gledaj da se **broj** crvenih ne poveća.

Harness ne pokreće browser: lažni React (`useEffect` se stvarno izvršava u
smart testu), lažni `window.__ModuleLoader__`, `localStorage`,
`ctx.sessions.list`/`binding` (uključujući `contextPressure` projekciju) i
model-directory koji beleži `select()` pozive.

---

## 13. KONTEKST, TOKEN-METAR I KOMPAKCIJA (od 2026-10-07)

### Dva broja koja se stalno mešaju

| Gde | Šta je | Da li samo raste |
|---|---|---|
| pill „… tok" u composer stats traci (ikona baze) | `tokenUsage.totals` — **kumulativni saobraćaj cele sesije** (`uncached + cacheRead + cacheWrite + output`, sabrano preko svih zahteva) | da, nikad ne pada |
| kružić desno od inputa | `contextPressure.projectedTokens / contextWindow` — **trenutna zauzetost konteksta** | ne — pada posle compacta |

- **Restart ne resetuje ni jedan broj.** Sesija se pri otvaranju replay-uje iz
  `session.v4.jsonl.zstd` kroz projekcije, pa zbirovi ispadnu isti.
- Reset metra = **nova sesija** (`+`); za postojeću reset ne postoji.
- **Keširani tokeni se ponovo broje u svakom zahtevu** — u jednoj merenoj sesiji
  98% metra je `cacheRead` (isti prompt se čita iz keša 200×). Cache hit je 50×
  jeftiniji od miss-a, ali nije 0 i nije „već jednom brojan".
- `compact` **ne kešira ništa** — on skraćuje prompt; keš gradi provajder sam.
  Prvi zahtev posle compacta je zato skoro ceo cache **miss** (puna cena), pa se
  keš u sledećih par zahteva vrati na ~99% hit.

### Prozor (`contextWindow`) je per-provider/model

- Prozor dolazi iz adaptera, ne iz sesije: `deepseek-official/deepseek-flash` →
  **1.000.000**, `google/gemini-flash-lite-latest` → **1.048.576**. DSH emituje
  `request/context` čim se provider/model/prozor promeni.
- Brojilac (`contextPressure.pressureTokens`, iz usage-a) i imenilac
  (`contextWindow`, iz `request/context`) su **dva nezavisna last-wins slota**,
  pa posle promene modela procenat može **jedan zahtev** da bude netačan.
- Zato hook/provera treba da gleda **procenat iz kružića**, nikad kumulativni
  „… tok" (greška koja je već jednom napravljena: prag od 500.000 tokena na
  metru koji meri saobraćaj, ne zauzetost).

### Auto-compact: prag se menja na **deklaraciji preseta**, ne na host redu

`compaction-basic` **ne postoji kao aktivan host red** — `dsh-web-app` ga
isključuje (`disabled: true`) jer compaction živi u realm-u agent preseta.
Aktivne kopije su u deklaracijama `preset-standard`, `preset-ptc`, `preset-cordis`.

- Patch sa `id` menja red, ali **`config` se zamenjuje u celosti** — nikad se ne
  spaja dubinski. Zato override preseta mora da ponovi ceo `config.plugins`.
- To se **ne piše rukom**: `~/dsh/preset-compaction-sync.py` prepisuje
  deklaracije iz instaliranog `dsh-web-app/presets/*.patch.yml` i ubacuje
  `thresholdRatio`. Blok stoji između markera `# >>> preset-compaction` u
  `~/.dsh/profiles/web/cordis.patch.yml`.
- Launcher (`~/.local/bin/dsh-termux`) ga zove pri **svakom** startu (kao gemini
  katalog), pa posle `npm install -g @deepseek-ai/dsh` sam uđe u sync.

Efektivni prag **nije** `window × ratio`:

```
threshold = min(window × ratio, window − maxTokens − headroomTokens)
```

- `headroomTokens` default **65.536**; `maxTokens` iz request headera
  (deepseek-flash 256.000, gemini 32.768).
- Default `thresholdRatio` = **0.8** → deepseek-flash: `min(800.000, 678.464)` =
  **678.464 ≈ 68%** prozora. **Ne čeka 90%.**
- Naš `thresholdRatio` = **0.6** → deepseek **600.000** (60,0%), gemini
  **629.145** (60,0%) — ratio veže, pressure budget ne seče.
- `retainRatio` default 0.16 → posle compacta ostaje ~119k (deepseek) verbatim
  repa; ako rez treba da bude blaži, podigni ga (mora ostati `< thresholdRatio`).
- `/compact` je **ručna** komanda (`command-compact`) i radi isto kad je auto
  isključen; auto-compact se vidi u logu kao `compaction/start` bez `command/run`
  od korisnika.
- **Izmene patcha važe od sledećeg starta** (§5) → posle sync-a `restart-dsh`.
