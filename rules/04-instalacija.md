# 04. Instalacija (dsh, profil, pluginovi, Android zamke)

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Korak-po-korak
> postupak za čoveka je u `~/dsh/DSH-Termux-Kompletno-Uputstvo.md`; ovde su
> **pravila** koja se ne smeju pogaziti.

## Šta je instalirano (stanje 2026-10-08)

| Komponenta | Verzija |
|---|---|
| `@deepseek-ai/dsh` | **0.2.0-rc.2** (globalno, `npm -g`) |
| Node.js | v26.4.0 |
| Python | 3.14.6 |
| profil | **web**, port **3081** |
| lokalni pluginovi | `dsh-composer-extras`, `dsh-chat-jump-arrows` |

Profil `~/.dsh/profiles/web/package.json`:

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
  "dsh-composer-extras", "dsh-chat-jump-arrows" ], "patchReload": "live" } }
```

Lokalni pluginovi se u profil vešu **symlinkom** u
`~/.dsh/profiles/web/node_modules/<ime>` → `~/dsh/<ime>`, a njihov `package.json`
nosi `dsh.client.inject` (slotovi/layout). Oba fajla (`package.json` i symlink)
drži `~/dsh/patch-android-dsh.py` (koraci **4b** i **4c**).

## Pravila profilа i patch sloja

- **Nova plugina ili nova ruta traže restart.**
- **Ručna izmena `cordis.patch.yml` važi od sledećeg starta.** `patchReload:
  live` stoji u `package.json` profila, ali se u 0.2.0-rc.2 **nigde u kodu ne
  čita** (provereno 2026-10-07); launcher čita patch fajl jednom, pri bootu
  (`readProfilePatches`). U letu se primenjuju samo izmene koje GUI (Settings →
  Plugins) pošalje kroz loader. Zato: posle ručne izmene patcha → `restart-dsh`.
- Patch sa `id` **zamenjuje `config` celog reda** (nikad se ne spaja dubinski) —
  vidi [`03-kontekst-i-kompakcija.md`](03-kontekst-i-kompakcija.md).
- `cordis.patch.yml` sme da nosi `!!js` izraze (cordis ih evaluira). Python
  alati koji ga čitaju moraju da registruju konstruktor za
  `tag:yaml.org,2002:js` — regresija iz 2026-10-08 je tiho obarala osvežavanje
  kataloga pri svakom startu ([`05-odrzavanje.md`](05-odrzavanje.md)).
- `deepseek-flash` se **ne deklariše** u `llm-pi-ai` (ruta `deepseek-official`
  pripada native `llm-deepseek` adapteru) — duplikat se odbija kao
  `DUPLICATE_ADAPTER`.

## Dodavanje novog lokalnog plugina (pravilo)

1. Kod u `~/dsh/<ime>/` (`client.js` + `index.js` + `package.json` +
   `cordis.patch.yml`).
2. `index.js` je host polovina (server), `client.js` je **klijentski bundle** —
   dsh loader **nije** običan ESM: bundle se registruje kroz
   `window.__ModuleLoader__.load({ id: "<ime>", factory })`, gde je `id` ime
   paketa. Pogrešan omot = „Failed to load plugins" i **nijedan** plugin se ne
   učita.
3. `package.json` profila: dodaj ime u `dsh.profile.bundles` **i** napravi
   symlink u `profiles/web/node_modules`. Oba koraka radi
   `patch-android-dsh.py` (**4b**/**4c**) — ne piši ih ručno ako možeš da pustiš
   skriptu.
4. **Nikad `dsh plugin --profile web add …` dok dsh radi.** Uvek prvo restart
   /gašenje:
   ```bash
   bash ~/.dsh/skills/restart-dsh/restart-dsh.sh   # ili ugasi, pa instaliraj
   ```
   pnpm prepisuje profil pod živim procesom i obara dsh.
5. `node -c client.js && node -c index.js`, pa `restart-dsh`, pa hard refresh.
6. Preko `dsh plugin add` se dodaje **samo** plugin sa npm-a; local plugin se ne
   instalira preko pnpm-a (postoji kao symlink).
7. Novi plugin ulazi i u **tri spiska** koja moraju da se poklope:
   `dsh.profile.bundles` (živi profil), `patch-android-dsh.py` `LOCAL_PLUGINS`,
   `make-restore-archive.sh` + `restore.sh` (`for plugin in …`).

Ako pnpm ipak mora da se koristi: `allowBuilds: { node-pty: true }` u
`~/.dsh/profiles/web/pnpm-workspace.yaml`, i **nikad** dok dsh radi.

## Launcher — zašto je obavezan

`~/.local/bin/dsh-termux` pri **svakom** bootu:

1. primenjuje Android zakrpe (`python3 ~/dsh/patch-android-dsh.py`),
2. osveži Gemini katalog (`python3 ~/dsh/gemini-catalog-update.py`),
3. uskladi preset-compaction blok (`python3 ~/dsh/preset-compaction-sync.py`),
4. tek onda diže dsh sa profilom `web` na portu 3081.

`/usr/bin/dsh` i `dsh` alias **preskaču** sve to (i traže `--profile`), zato se
restart radi isključivo preko wrappera
([`01-sesije.md`](01-sesije.md)).

## Android / Termux zamke (i šta ih rešava)

| Zamka | Rešenje |
|---|---|
| `EACCES … link` (SELinux) | `python3 ~/dsh/patch-android-dsh.py` (hard-link zakrpa) |
| `EACCES … open '/data/data'` | isto (dir-fsync zakrpa) |
| `ripgrep launch failed` / glob mrtav | `pkg install ripgrep` + `patch-android-dsh.py` (shim) |
| `No usable native binding … require-builtin-android-arm64` | `patch-android-dsh.py` (3e — JS fallback) |
| `pty.node` ne postoji | `npm rebuild --global` (faza 4c update-a), pa restart |
| `flock(2)` mock | **ne pokreći dva dsh-a nad istom sesijom** |
| `dsh --profile is required` | pozvan `/usr/bin/dsh`; koristi wrapper |
| `koffi` bez android prebuilda | nikad `npm install -g` ručno; samo `~/dsh/dsh-update.sh` |
| attachment store fsync-uje `/`, `/data`, `/data/data` | `patch-android-dsh.py` (Prepreka 4) |

## PWA („DSH 手机版")

- Cookie `SameSite=Lax` (zakrpa `--pwa-samesite`); `Strict` obara PWA auth.
- `~/.dsh/.credentials.yaml` nosi samo `client-connection/browser-session` +
  `version` — nikad ključeve ([`08-tajne.md`](08-tajne.md)).
