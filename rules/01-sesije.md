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
  **istom** workspace-u kao pozivajuća, sa **smart startom** (prvi prompt ide
  Gemini) i **odmah se zaustavlja**.
- **Zaštita od ponovnog grananja:** branch ruta upisuje oznaku u
  `~/dsh/.branch-into-new-session/children/<sessionId>` i uz prompt šalje
  `<system-reminder>` koji modelu zabranjuje da sam pozove skill grananja. Bez
  oba, model u novoj sesiji pročita prompt o grananju i napravi **još** jednu
  sesiju (izmereno 2026-10-07).
- Oznaka „ova sesija je smart-branched" je u `localStorage` i preživljava
  reload i restart.

## Pravila za agenta u sesiji

- **„uplati" = `uplati` skill** — učitaj skill, ne izmišljaj IPS QR. Broj računa
  samo iz šablona/korisnika. Skill fizički živi u `~/.claude/skills/uplati`
  (symlink u `~/.dsh/skills`); ako ga nema u katalogu, proveri symlink.
- **Operacije duže od 5 minuta:** prekini petlju/retry, sačuvaj napredak u
  JSON/tekst, vrati kontrolu korisniku sa statusom. **Ne ostavljaj** aktivne
  `session.lock` fajlove ni zombi procese.
- Globalna uputstva koja dobija svaka sesija su `~/.dsh/AGENTS.md`; ona samo
  upućuju na ovaj folder, ne dupliraju pravila.
