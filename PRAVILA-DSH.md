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
6. **Posle izmene klijentskog bundla (`client.js`) → hard refresh.** Server drži
   bajtove bundla **u memoriji od boota** (dsh-client-modules:
   `initialBundleSnapshot` → `bundle: readFileSync`, a ruta servira
   `record.bundle`), pa *nije* dovoljno samo sačekati. U plusu, `client-hmr`
   (server) svakih 500 ms stat-uje fajl i preko `/plugins/events` (SSE) kaže
   browseru `reload(id, rev)` — pa se u **otvorenom** tabu bundle ipak
   osveži sam. Ako ni posle hard refresh-a nema promene (npr. tab je bio
   zatvoren u trenutku izmene) → `restart-dsh`.
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

- Menjan klijentski bundle → **hard refresh** u browseru (ili samo osvežavanje
  taba, jer `client-hmr` reload-uje bundle preko SSE-a — vidi §0.6).
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
- **Klijentski bundle (`client.js`) se ne čita ponovo po zahtevu** — boot ga
  učita u memoriju, a `client-hmr` ga stat-pollingom (500 ms) i SSE-jem
  (`/plugins/events` → `reload(id, rev)`) osveži u **otvorenom** tabu. Zato:
  otvoren tab → promena dođe sama; zatvoren tab / sumnja → **hard refresh**;
  ako i to ne pomogne → `restart-dsh`.
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
- **Svaka površina koja preuzme ceo ekran nosi `data-dsh-overlay-surface`**
  (npr. file-picker „Dodaj u kontekst" = `file-picker`). To je ugovor sa
  strelicama (§5, `dsh-chat-jump-arrows`): `shell.overlay` je iznad composera,
  pa se jedino tako zna da treba da se sklone. Context-guard kartica to ne
  mora — ona je pravi `role="dialog"` + `aria-modal="true"`.

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
- **Dok je otvoren picker/dijalog/meni, strelica NEMA** (od 2026-10-08). Seat
  `shell.overlay` stoji **iznad** composera, pa `z-index: 10000` iz pickera to
  ne može da nadjača — strelice bi lebdele preko pickera i kradle dodire
  (🗑️ se teško kliknuo, a prevlačenje preko kartice je skrolovalo transkript).
  Zato `computeState` vraća `HIDDEN` kad postoji **renderovan** element koji
  odgovara `OVERLAY_SELECTOR`:
  `[role="dialog"][aria-modal="true"], [role="menu"]` (DSH-ov `modalSelector`
  ugovor, isti na kome `dsh-client-shortcuts` blokira prečice) **ili**
  `[data-dsh-overlay-surface]` — oznaka koju `dsh-composer-extras` stavlja na
  svoj „Dodaj u kontekst" picker (to je običan `fixed` div, nije `role="dialog"`,
  pa ga prvi deo selektora ne vidi). Picker se montira u **portal van
  transkripta**, zato `JumpArrows` drži i drugi `MutationObserver` nad
  `document.documentElement` (`role`, `aria-modal`, `data-dsh-overlay-surface`)
  — bez njega otvaranje pickera ne bi uopšte probudilo skeniranje. Element bez
  layout-a (`display: none`, `hidden`) se ne računa, da zaglavljen meni ne
  sakrije strelice zauvek. **Novi overlay površina = obavezno označi je
  `data-dsh-overlay-surface`** (ili `role="dialog"` + `aria-modal="true"`).
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
node ~/dsh/tests/test-composer-extras-context-guard.mjs      # 73 provere — context guard (prag 50%), modal, branch, newline
node ~/dsh/tests/test-preset-compaction.mjs                  # 16 provera — auto: false + prag 60%
node ~/dsh/tests/test-chat-jump-arrows.mjs                   # 53 provere — ▲▼ kroz moje poruke + sklanjanje pod pickerom
python3 ~/dsh/tests/test-gemini-catalog-update.py            # 22 provere — `!!js` u cordis.patch.yml + auto-ispravka kataloga
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
  sva tri preseta imaju `auto: false` i `thresholdRatio: 0.6`, i efektivni prag
  ispadne tačno 60% za oba rutirana modela. **Ovo je test koji pada ako DSH
  update promeni preset** (tada pokreni `~/dsh/preset-compaction-sync.py` i
  ponovo ga pusti).

- `context-guard` harness je **ceo zelen** od 2026-10-08 (**73/0**). Ranija 3
  crvena su bila stvarna neusklađenost, ne artefakt: dva su tražila prag od 500k
  dok je kod imao 40% prozora (sad 50% — poklapa se), a treće je testiralo staru
  implementaciju dugmeta (draft + `submit`), dok dugme odavno zove
  `POST /composer-extras/api/compact`. Ako se crveni vrate — to je regresija.
  Sekcija **4b** čuva modal (portal u `document.body`, centriranje, klik na
  masku, Esc) i **mesto pill-a** (nema `right`, merenje preko
  `[data-composer-card]` + `aria-haspopup="listbox"`), a sekcija **7** trenutno
  sklanjanje kartice na klik + pill „📦 Kompaktujem…".

- `test-chat-jump-arrows.mjs` — 53 provere §5 (strelice). Lažni DOM ima pravu
  geometriju skrola, pa se proverava samo ponašanje: `steering` se broji,
  skrivene/ugnježdene ne, DSH-ova kompenzacija pozicije se ispravlja, pozicija
  je uz ivicu **razgovora**, i **sekcija 10**: dok postoji
  `[data-dsh-overlay-surface]` (picker), `role="dialog"`+`aria-modal` ili
  `role="menu"`, ništa se ne renderuje; kad se overlay zatvori, strelice se
  vraćaju sa istim badge-om; **skriven** meni (`hidden`) ne sakriva strelice.

- `test-gemini-catalog-update.py` — 22 provere §0/§2 za
  `~/dsh/gemini-catalog-update.py`. Čuva `!!js` regresiju: cordis dozvoljava JS
  izraze (`disabled: !!js process.platform === 'win32'`) i PyYAML ih rešava u
  `tag:yaml.org,2002:js`, pa je multi-konstruktor registrovan samo pod `"!"`
  propuštao taj tag → **ceo patch sloj se nije parsirao pri svakom startu** i
  Gemini katalog se tiho nije osvežavao (popravljeno 2026-10-08). Test pokriva i
  duplikat ključa, `diagnose()` slučajeve (DUPLICATE_ADAPTER, model koji fali) i
  da se **tuđi** `cordis.patch.yml` nikad ne prepisuje.

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

### Auto-compact je ISKLJUČEN — kompakciju uvek odobrava korisnik

**Odluka 2026-10-07:** DSH nikad ne sme da kompaktuje sam. U profilu stoji
`auto: false` na `compaction-basic`, pa su jedini putevi:

1. **Predlog na 50% konteksta** — `dsh-composer-extras` „context guard" popup
   (dugmad: *Branch into new session* / *Compact session* / *Nastavi dalje*).
2. **Ručni `/compact`** iz komande trake (ili `/clear-context`, koji je samo
   alias preko `ctx.commands.execute`).

Zato **nema `compaction/start` bez tvog klika**. Automatski bi se u logu video
kao `compaction/start` **bez** `sourceCommandId` i bez `command/run`; ručni ima
`sourceCommandId: cmd-…` (detalji u tabeli ispod).

#### Context guard (predlog, ne akcija)

- Prag: **50% prozora** (`CONTEXT_GUARD_WINDOW_FRACTION = 0.5`, uz apsolutni
  `CONTEXT_GUARD_TOKENS = 500000` — za 1M prozor se poklope). **Ispod 50% se
  panel ne prikazuje** — to je korisnikov zahtev od 2026-10-08 („updejtuj da ga
  ne vidim ispod 50%").
  - **Prag se više ne spušta ni privremeno.** 2026-10-08 je bio privremeno
    0.25, pa 0.05, samo da bi se novi modal video odmah; obe vrednosti su
    uklonjene zajedno sa `⚠️ TEMP` markerom. Za proveru izgleda modala služi
    `~/dsh/panel-preview.html`, a **ne** spuštanje praga i **ne** klik na
    „Compact session" (to je prava kompakcija, ne test).
  - Test prag **čita iz koda** (`CONTEXT_GUARD_WINDOW_FRACTION`) *i* traži da je
    tačno 0.5 — pa padne ako se prag opet spusti.
  - Posle svake izmene klijenta sledi **hard refresh** (bundle se čita u
    memoriju na bootu; `client-hmr` ga reload-uje u otvorenom tabu preko SSE,
    ali refresh je siguran put); config (`auto: false`) traži restart, klijent ne.
- Meri **isključivo** `contextPressure` (`projectedTokens / contextWindow`),
  nikad `tokenUsage` — taj drugi je kumulativni saobraćaj (test to čuva).
- Ponavlja se svakih `CONTEXT_GUARD_RENUDGE = 100000` tokena iznad praga
  (≈ na 60%, 70%, 80%…), a „Nastavi dalje" pamti odbačeni opseg po sesiji
  (`localStorage`).
  - **Odbacivanje nije ćorsokak:** dok je opseg odbačen, ostaje mali pill
    `📦 Kontekst N%` koji na klik vraća pun panel (bez toga se panel ne može
    dozvati do +100k tokena — 2026-10-07: „ne vidim panel"). Zato se
    odbacivanje pamti **jedan opseg niže**, pa je isti opseg ponovo iznad njega.
  - **Pill stoji dole LEVO, ispod „+" dugmeta — nikad uz desnu ivicu.**
    2026-10-08 (drugi krug): `right: 12; bottom: 96` je na telefonu seo preko
    reda sa dugmadima. Mesto se **meri iz DOM-a** (`useComposerPillAnchor`):
    kartica composera je `[data-composer-card]`, a „+" je jedino dugme u njoj sa
    `aria-haspopup="listbox"` (stabilni core atributi — heširane CSS klase se
    menjaju pri svakom build-u). Red sa dugmadima se na telefonu **lomi u dva
    reda** (`tools` pa `trailing`), pa je leva polovina drugog reda, tačno ispod
    „+", prazna — pill ide tamo, poravnat sa levom ivicom „+". Ako tog prostora
    nema (širok ekran, red se ne lomi), pill ide u prazan levi deo dock trake na
    dnu ekrana. Meri se ponovo na `resize` i `scroll`. Bez DOM-a (test harness,
    prvi render) koristi se statični fallback `left: 16; bottom: 52` — i on je
    levo/dole, nikad desno.
- „Compact session" **ne dira draft** i ne submit-uje iz composera: zove našu
  rutu `POST /composer-extras/api/compact` (`{sessionId, waitMs: 90000}`), koja
  čeka da agent pređe u `idle` i vraća **pravi ishod**. Kartica se **sklanja
  odmah na klik** (`📦 Kompaktujem…` ostaje u pill-u), a ako server odbije
  (npr. „agent nije idle") panel se **sam vraća** sa porukom servera — neuspeh
  se nikad ne završava tišinom.
- Zašto ruta, a ne `/compact` u draft: `compactNow` traži **idle** agenta, a
  guard se pali usred turna; ruta sačeka kraj turna umesto da ti pojede draft.
- **Modal je centriran i ide kroz `createPortal` u `document.body`** (isto kao
  core `SettingsPanel`). `position: fixed` unutar slota u composeru nije vezan
  za viewport ako neki predak napravi containing block (transform/filter), pa je
  kartica 2026-10-08 ispadala **uz desnu ivicu** („izašao je sa strane"). U
  portalu je preko celog ekrana: `fixed` overlay + `flex/center` + maska.
  Zatvaranje: **klik na masku** (bilo gde van kartice), **Esc**, i svako od tri
  dugmeta. Maska je zaseban element (kao u core-u), pa klik na karticu ne može
  da je pogodi — nema `stopPropagation`-a.
- **Svi hookovi idu PRE svakog `return`-a** (prag, opseg i `dismissed` se
  računaju iznad `useState`/`useEffect`). Rani `return` ispred hooka menja broj
  hookova između render-a i React baca „Rendered fewer hooks than expected" —
  tj. puca ceo composer onog trenutka kad sesija pređe (ili padne ispod) praga.
- **Panel mora da ima NEPROVIDNU podlogu.** `--dsw-specific-menu` je u svetloj
  temi `#f8f9fa94` (58% alfa) i u core-u ide uz `backdrop-filter`; u inline
  stilu bez blura se tekst iza panela providi (viđeno 2026-10-07). Zato panel
  koristi `--dsw-alias-bg-base` (#fff / #151517) + `backdrop-filter` kao pojas i
  šraf + amber obod, a „Compact session" je vizuelno primarno dugme. Test
  (`sekcija 8`) to čuva.
  - Tokeni (`--dsw-*`) su definisani na `body` (`dsh-client-ui-theme`), pa ih
    portalan modal u `document.body` i dalje nasleđuje — zato portal ne menja
    temu, samo geometriju.

#### Kako se u logu prepoznaje (ručni vs auto)

| | ručni `/compact` | auto (kad bi bio uključen) |
|---|---|---|
| pre njega | `command/run {name:"compact", source:{kind:"user"}}` | nema tog događaja |
| `compaction/start` | ima `sourceCommandId: cmd-…` | **nema** polje `sourceCommandId` |
| gde stoji | van turn-a (`turn: null`) | unutar turn-a, između `step/end` i `step/start` |
| posle | `command/done` („Compacted N history items (~M tokens)") | ništa u UI-ju |
| server log | — | `compaction (step pressure): shadowed N surface nodes …` |

### Config: menja se na **deklaraciji preseta**, ne na host redu

`compaction-basic` **ne postoji kao aktivan host red** — `dsh-web-app` ga
isključuje (`disabled: true`) jer compaction živi u realm-u agent preseta.
Aktivne kopije su u deklaracijama `preset-standard`, `preset-ptc`, `preset-cordis`.

- Patch sa `id` menja red, ali **`config` se zamenjuje u celosti** — nikad se ne
  spaja dubinski. Zato override preseta mora da ponovi ceo `config.plugins`.
- To se **ne piše rukom**: `~/dsh/preset-compaction-sync.py` prepisuje
  deklaracije iz instaliranog `dsh-web-app/presets/*.patch.yml` i ubacuje
  `auto: false` (+ `thresholdRatio: 0.6`). Blok stoji između markera
  `# >>> preset-compaction` u `~/.dsh/profiles/web/cordis.patch.yml`.
- Launcher (`~/.local/bin/dsh-termux`) ga zove pri **svakom** startu (kao gemini
  katalog), pa posle `npm install -g @deepseek-ai/dsh` sam uđe u sync.

#### Ako se auto ikada vrati: efektivni prag nije `window × ratio`

```
threshold = min(window × ratio, window − maxTokens − headroomTokens)
```

- `headroomTokens` default **65.536**; `maxTokens` iz request headera
  (deepseek-flash 256.000, gemini 32.768).
- Default `thresholdRatio` = **0.8** → deepseek-flash: `min(800.000, 678.464)` =
  **678.464 ≈ 68%** prozora — **ne čeka 90%**.
- Naš zapisani `thresholdRatio` = **0.6** → deepseek **600.000** (60,0%), gemini
  **629.145** (60,0%); sa `auto: false` to ništa ne okida, tu je samo da prag bude
  tačan ako se auto ponovo uključi.
- `retainRatio`/`retainTokens` važe **samo za automatski put**. Ručni `/compact`
  ide preko `compactNow`, koji interno traži `retainTokens: 0` — dakle **reže
  najviše što može** (u jednoj merenoj sesiji: 339 stavki / ~160k tokena, pa je
  sledeći zahtev bio 2,5k). Zato je guard i koristan: trenutak biras ti, ali rez
  je agresivan.
- **Izmene patcha važe od sledećeg starta** (§5) → posle sync-a `restart-dsh`.
  Klijentski deo (guard, prag) traži **hard refresh** (ili ga `client-hmr`
  reload-uje u otvorenom tabu).
