# 01. Sesije: restart, refresh, modeli, grananje

> Deo [`rules/`](README.md) — indeks i TL;DR: [`README.md`](README.md).
> Kod je istina; ako se ovo razilazi sa kodom, ispravi dokument.

## Restart — jedna komanda, jedan skript

Restart ima **tačno jednu implementaciju**:
`~/.dsh/skills/restart-dsh/restart-dsh.sh` (fizički:
`~/.claude/skills/restart-dsh/restart-dsh.sh`, u `~/.dsh/skills` je symlink).

| Ulaz | Kako zove skript |
|---|---|
| **„+" meni u dsh GUI-ju** → `/restart-dsh` | serverska komanda iz `dsh-composer-extras` plugina: detaširano `bash restart-dsh.sh --delay 2 --quiet` |
| **Skill `restart-dsh`** (agent/terminal) | agent pokrene `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` |
| **Ručno iz terminala** | isto: `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` |

Ime je na oba mesta isto — **`restart-dsh`**. Skill nosi
`user-invocable: false` da se isti naziv ne pojavi dvaput u „+" meniju (jednom
kao *Skills*, jednom kao *Commands*); model ga i dalje vidi i poziva.

### Agent NE može da restartuje dsh iz sopstvenog tool poziva (2026-11-15)

Ako agent pokrene `restart-dsh.sh` **sinhrono** iz `bash` alata, skripta ubije
dsh — a dsh je taj koji izvršava taj `bash` poziv. Rezultat: alat vrati
„tool call aborted", iako je **restart uspeo**. Izmereno 2026-11-15 14:20:20:
log ima `kill + relaunch (delay=2s)` i `TERM na 1563`, dsh se vratio na novom
PID-u, a poziv je prijavljen kao prekinut.

Zato:

- **Restart iz agenta znači prekid razgovora** — pre njega pitaj korisnika i
  reci mu da će sesija na kratko stati.
- Posle njega **ne tvrdi da je pao** dok ne proveriš: `curl -s -o /dev/null -w
  '%{http_code}\n' http://127.0.0.1:3081` (401 = živ) i `tail ~/dsh/restart-dsh.log`.
- Iz GUI-ja (`/restart-dsh`) nema ovog problema: komanda skriptu pokreće
  **detaširano**, pa restart preživi.

**Zašto (istorija):** ranije su postojale **dve** komande za istu stvar —
`/restart` (plugin) i skill `restart-dsh`, sa odvojenom logikom, pa su se
razlikovale i unosile zabunu. Ujedinjeno 2026-10-07: plugin više ne zna kako se
restartuje, samo pozove skript.

### Šta skript radi (i šta se NIKAD ne radi ručno)

1. `pkill -f 'dsh/lib/bin[.]js'` (pa `-9` ako se ne preda u ~3 s);
2. detaširano `setsid nohup ~/.local/bin/dsh-termux >> ~/dsh/dsh-web.log 2>&1 &`;
3. čeka da port 3081 odgovori: **200/301/302/401/403 = živ**, `000` = mrtav;
4. log u `~/dsh/restart-dsh.log` + Android notifikacija;
5. exit 0 ako je živ, 1 ako nije.

Argumenti: `--delay SEKUNDI`, `--quiet`.

**Zabranjeno:** `pkill -f 'dsh/lib/bin[.]js' && dsh` (preskače wrapper i Android
zakrpe) i `nohup dsh` (nohup ne prolazi kroz bash funkciju `dsh`, nego gađa
`/usr/bin/dsh`, kome treba `--profile`).

**Ne restartuj živi dsh bez izričite dozvole korisnika** (kroz njega razgovara) —
restart ide na zahtev, preko `restart-dsh`.

## Šta posle čega: restart ili samo refresh

| Promenjeno | Šta treba |
|---|---|
| `client.js` (klijentski bundle) | **hard refresh** taba; `client-hmr` ga u otvorenom tabu obično osveži sam |
| `index.js` / `package.json` / `cordis.patch.yml` | **`restart-dsh`** |
| nov plugin, nova ruta, nova `bundles` stavka | **`restart-dsh`** |
| skills / `AGENTS.md` | nova sesija (ili restart) |
| `gemini-catalog-update.py`, `preset-compaction-sync.py` | sami se pokrenu pri startu; ručno `python3 ~/dsh/<skript>` |

**Klijentski bundle se ne čita ponovo po zahtevu** — boot ga učita u memoriju
(`dsh-client-modules`: `initialBundleSnapshot` → `bundle: readFileSync`, ruta
servira `record.bundle`), pa čekanje nije dovoljno. U plusu, `client-hmr`
(server) svakih 500 ms stat-uje fajl i preko `/plugins/events` (SSE) kaže
browseru `reload(id, rev)` — zato **otvoren tab** promenu često dobije sam.
Zatvoren tab / sumnja → **hard refresh**; ako i to ne pomogne → `restart-dsh`.

- „Failed to load plugins" → bundle nije umotan u
  `window.__ModuleLoader__.load({id, factory})`; dsh loader **nije** običan ESM.
- Provera da je dsh živ:
  `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081`.

## Modeli

- Default agent model: **`deepseek-official/deepseek-flash`**,
  `reasoningEffort: high` (`profile/cordis.patch.yml`, čvor `agent-default-model`).
- Gemini ide preko `llm-pi-ai` adaptera, ruta `google`, ključ `GOOGLE_API_KEY`.
- `deepseek-flash` se **ne deklariše** u `llm-pi-ai` — servira ga native
  `llm-deepseek` adapter iz `dsh-base`; drugi adapter na istoj ruti se odbija
  kao `DUPLICATE_ADAPTER`.
- `gemini-flash-lite-latest` **ne sme da se izbaci iz kataloga** — bez njega
  nema smart moda ([`02-smart-mode.md`](02-smart-mode.md)). Katalog održava
  `~/dsh/gemini-catalog-update.py` (launcher ga zove pri startu).

## Sesije i grananje

- **`blank` sesija se reuse-uje:** „+" ne pravi uvek novu — dsh preuzme
  postojeću praznu sesiju u istom workspace-u.
- **Grupa = workspace.** `branch-into-new-session` pravi novu praznu sesiju u
  **istom** workspace-u kao pozivajuća i **odmah se zaustavlja**.
- **Zaštita od ponovnog grananja:** branch ruta upisuje oznaku u
  `~/dsh/.branch-into-new-session/children/<sessionId>` i uz prompt šalje
  `<system-reminder>` koji modelu zabranjuje da sam pozove skill grananja. Bez
  oba, model u novoj sesiji pročita prompt o grananju i napravi **još** jednu
  sesiju (izmereno 2026-10-07).
- Oznaka „ova sesija je smart-branched" je u `localStorage` i preživljava
  reload i restart.

## Grananje u novu sesiju — JEDAN mehanizam, dva moda (od 2026-11-15)

**Mod bira ULAZ, nikad tekst prompta** — nema markera u promptu.

| Ulaz | Mod |
|---|---|
| dropdown na dugmetu (strelice) → *Fork (sa istorijom)* | fork |
| dropdown na dugmetu → *Nova (prazna)* | prazna |
| `/branch <prompt>` | fork |
| `/branch-new <prompt>` | prazna |
| `branch.sh <fajl>` | prazna (default) |
| `branch.sh --history <fajl>` | fork |

- **Jedna implementacija:** `sendToNewSession` u
  `~/dsh/dsh-composer-extras/index.js`; zovu je ruta, obe komande i oba moda
  dugmeta. Ruta: `POST /composer-extras/api/branch-session` sa
  `{prompt, parentSession, cwd, mode}`.
- **fork** = `controller.fork` → dete nasleđuje prefiks do zadnjeg
  **završenog** turna, prompt ide na kraj kopije. Granica je završen turn, pa
  snimak nikad nema nedovršene `tool-call`-ove (`history ends with unresolved
  tools`), a prefiks zahteva ostaje identičan → provider-ov keš pogađa.
  Ako sesija nema završen turn → `409`.
- **prazna** = `controller.create`; dete ne vidi istoriju.
- **Model:** dete dobija **isti** model kao izvor, preko `agent.model.select()`
  — NAMERNO ne `sessionController.selectModel`, jer taj put trajno prepiše
  profilni default ([`02-smart-mode.md`](02-smart-mode.md)).
- **Keš izvorne sesije se NE kvari** grananjem — ona ne dobija ni jedan nov
  event (izmereno 2026-11-15: `cacheRead` nastavlja da raste oko grananja).
- **Prikaz:** GUI se prebacuje na novu sesiju i za dugme i za komande
  (klijent sluša `command/executed` za `branch`/`branch-new`). Server ne zna
  koji prozor gledaš, zato je prebacivanje klijentska stvar.
- **Zaštita od ponovnog grananja** ostaje: ruta upisuje oznaku u
  `~/dsh/.branch-into-new-session/children/<sessionId>`, a prompt nosi
  `<system-reminder>` koji modelu zabranjuje da sam grana dalje (2026-10-07:
  model je u novoj sesiji sam pozvao skill i napravio treću).

## Poruka drugoj sesiji (`message-session`)

- **Kanal:** `POST /composer-extras/api/prompt-session` (loopback, bez tokena)
  sa `{sessionId, text, mode}`. Host prosleđuje u
  `sessionController.prompt`: `mode === "steer"` → `agent.steer()`, svaka druga
  vrednost → `agent.followup()`.
- **Skill:** `message-session` (`~/.claude/skills/message-session`, symlink u
  `~/.dsh/skills`). Skripta `message-session.sh`.
- **Session ID je OBAVEZAN argument — nikad se ne pogađa.** 2026-11-15 je prva
  poruka poslata tako što je ciljna sesija pronađena `grep`-om po logovima; to
  je pogodilo, ali je rizik: ako se u međuvremenu jedna sesija završi a druga
  počne, poruka ode **pogrešnoj**. Zato skripta pre slanja ispiše identitet
  cilja (naslov iz `session/title` eventa, cwd, model, broj turn-ova, vreme
  poslednje aktivnosti), a `--check` samo prikaže bez slanja.
- **`--steer` je default (odluka 2026-11-15):** poruka ulazi u **sledeći korak**
  tekućeg turna; ako sesija miruje, `send(..., wakeup=true)` → `wakeDriver()`
  otvara novi turn odmah (`while (await this.turn())`), pa steer nikad ne
  „izvisi". `--queue` (`followup`) se obrađuje tek na granici turna i koristi
  se kad poruka sme da čeka.
- **Provereno 2026-11-15:** poruka poslata mirnoj GLM sesiji je probudila,
  obradila i odgovorila `OK` (turn 4, `user/message → assistant/message →
  step/end → turn/end`).
- Skripta odbija slanje sebi (`--from` == cilj, exit 3) osim uz `--force`.

## Pravila za agenta u sesiji

- **„uplati" = `uplati` skill** — učitaj skill, ne izmišljaj IPS QR. Broj računa
  samo iz šablona/korisnika. Skill fizički živi u `~/.claude/skills/uplati`
  (symlink u `~/.dsh/skills`); ako ga nema u katalogu, proveri symlink.
- **Operacije duže od 5 minuta:** prekini petlju/retry, sačuvaj napredak u
  JSON/tekst, vrati kontrolu korisniku sa statusom. **Ne ostavljaj** aktivne
  `session.lock` fajlove ni zombi procese.
- Globalna uputstva koja dobija svaka sesija su `~/.dsh/AGENTS.md`; ona samo
  upućuju na ovaj folder, ne dupliraju pravila.
