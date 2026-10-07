# Plan: dsh-composer-extras + skills na Termux-u

**Datum:** 2026-09-15 · **Živi dsh:** PID 28847 (`web --port 3081`) — **nije gašen**
**Izvor:** `/storage/emulated/0/Download/` — `DSH-Termux-Kompletno-Uputstvo.md` (839 linija) + 7 pratećih fajlova

---

## 1. Stanje pre intervencije

Uputstvo opisuje pun setup, ali ga telefon **trenutno nema** — `~/dsh/` je imao samo 3 fajla:

| Iz uputstva | Stanje pre |
|---|---|
| `~/dsh/dsh-composer-extras/` | ❌ ne postoji |
| `~/.dsh/skills/{solid,uplati}` | ❌ prazan direktorijum |
| `~/.dsh/AGENTS.md` | ❌ ne postoji |
| `~/dsh/patch-android-dsh.py` (4 zakrpe) | ❌ samo stari `patch-android-hardlink.py` |
| `~/dsh/dsh-auto-update.sh` | ❌ ne postoji — **cron ga je zvao svaki dan i padao** |
| `~/dsh/gemini-catalog-update.py` | ❌ ne postoji |
| `~/.dsh/profiles/headless/` | ❌ ne postoji |
| `vision` alat u `cordis.patch.yml` | ❌ patch je bio `[]` |
| plugin `dsh-context` | ❌ nije instaliran |
| live dsh verzija | `0.1.5-rc.1` (uputstvo piše `0.1.1-rc.2` — drift) |

`cron-trigger.log` je sadržao dokaz: `dsh-auto-update.sh: not found`.

---

## 2. Šta je urađeno — i šta je od toga već živo

### ✅ Živo odmah (bez restarta)
- **Skills** `~/.dsh/skills/solid/` i `~/.dsh/skills/uplati/SKILL.md` — dsh ih čita live;
  potvrđeno: pojavili se u katalogu sesije iste sekunde.
  `uplati.py` **nije** kopiran (po uputstvu se zove sa `~/.claude/skills/uplati/uplati.py`,
  da se dve kopije ne raziđu).

### 📦 Stage-ovano (inertno — aktivira se restartom)
- **`~/dsh/dsh-composer-extras/`** — `client.js` (50 KB), `index.js` (28 KB),
  `package.json`, `cordis.patch.yml`. Oba fajla prošla `node --check`.
- **`~/.dsh/profiles/node_modules/dsh-composer-extras`** → symlink na `~/dsh/dsh-composer-extras`
  (`require.resolve` potvrđen).
- **`~/.dsh/profiles/web/package.json`** → `dsh.profile.bundles` sad:
  `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-composer-extras"]`
- **`~/.local/bin/dsh-termux`** — nova verzija (backup: `dsh-termux.bak-20260915-002622`):
  `DSH_PERMISSION_MODE=danger-full-access` default, source `~/.config/dsh-secrets.env`,
  auto-pokretanje `patch-android-dsh.py` / `gemini-catalog-update.py`, >24h auto-update fallback.
- **`~/dsh/dsh-auto-update.sh`** — vraćen (cron ga je već zvao).
  **Bezopasan večeras:** `npm latest` = instalirana = `0.1.5-rc.1` → skripta izlazi odmah.
  Ima i zaštitu: odbija update van `0.1.x`, radi smoke-test na portu 3082 i rollback.

### 🔬 Validacija (bez diranja živog procesa)
1. `--dump-config` sa `--patch` overlay-em → `composer-extras` u komponovanom stablu, **0 grešaka**.
2. **Izolovani boot** u `DSH_HOME=~/dsh/.pretest`, port **3082** → server se digao i odgovorio
   (HTTP 401 = traži token). **Nema** `did not activate` / `pending` / `failed to load`.
   → plugin je zdrav, ne obara profil.
3. Scratch home (sadržao kopiju `.credentials.yaml`) **obrisan** posle testa.
4. Živi dsh na 3081 proveravan posle svakog koraka — **radi**.

---

## 3. Aktivacija plugina — ✅ ZAVRŠENO (restartom)

Klijentski/server deo plugina se učitava **pri bootu profila**.

> **STATUS 2026-09-15 00:35 — plugin je ŽIV.** Korisnik je sam pokrenuo restart
> (Opcija B). Nova instanca: PID **3627**. Verifikovano sondama:
> `/composer-extras/api/debug-provider-check` → **200**, `/composer-extras/api/fs-tree-workspace`
> → **405** (ruta postoji), nepoznata ruta → 404; a u HTML-u se servira
> `composer-extras/client.js&rev=7981ecc9f4d27a72-44`. U logu nema
> `did not activate` / `failed to load`. Treba samo **hard-refresh** browsera.

### ❌ Opcija A — hot-load: ISPROBANO, NE RADI na ovoj verziji

Profil ima `patchReload: "live"`, i živi proces **stvarno drži inotify watch** na
`~/.dsh/profiles/web/cordis.patch.yml` (potvrđeno iz `/proc/28847/fdinfo/23`:
`wd:4 ino:b4bf2` = inode 740338 tog fajla; nadgledan je i sam direktorijum).

Insert je upisan tačno u taj fajl (uz automatski rollback):

```yaml
- insert:
    - id: composer-extras
      name: 'dsh-composer-extras'
```

…ali je ruta plugina ostala **404 punih 24 s**. Sonda je prethodno **validirana** na
izolovanoj instanci gde je plugin učitan preko `bundles` — tamo ista ruta vraća **200**,
nepoznata 404. Znači: hot-load **novog** čvora se u `0.1.5-rc.1` ne primenjuje na živi
proces, iako se fajl prati.

Skripta je odradila rollback (patch fajl → `[]`, `bundles` → sa pluginom). Živi dsh je
sve vreme bio živ (`/` → 401). Backup: `~/.dsh/profiles/web/{cordis.patch.yml,package.json}.bak-20260915-002923`.

**Zaključak: aktivacija zahteva restart → Opcija B.**

### ✅ Opcija B — restart (jedini način koji radi)
```bash
pkill -f 'dsh/lib/bin[.]js'
nohup ~/.local/bin/dsh-termux > ~/dsh/dsh-web.log 2>&1 & disown
sleep 8
curl -sf http://127.0.0.1:3081 -o /dev/null -w 'HTTP:%{http_code}\n'
```
Posle prvog restarta `/restart` slash komanda (iz samog plugina) radi isto iz UI-ja.

### Verifikacija (posle bilo koje opcije)
```bash
dsh --profile web --dump-config | grep -n composer-extras      # red postoji
node -c ~/dsh/dsh-composer-extras/client.js                    # syntax
```
Na ekranu: 📎 paperclip levo od „+", `/clear-context` i `/restart` u „+" meniju,
🔁 Try again / 👍 Proceed, 😎 gemini-seek-smart.

### Rollback
```bash
cp ~/dsh/dsh-composer-extras.bak/* ~/dsh/dsh-composer-extras/   # ili obrisi insert
# i vrati bundles na: base + web-app
```

---

## 4. Otvoreno (nije dirano — traži odluku)

| Stavka | Zašto nije urađeno |
|---|---|
| `~/dsh/patch-android-dsh.py` (4 zakrpe) | Ne postoji u Download-u; treba ga **napisati** (hardlink + dir-fsync + ripgrep + migracija tajni). Hardlink deo pokriva `no-hardlink.cjs` preload, pa zasad radi. |
| `~/dsh/gemini-catalog-update.py` | Nema izvora u Download-u. |
| `~/.dsh/AGENTS.md` | Nema izvora — treba generisati iz uputstva (trenutno dsh ne zna Termux kontekst). |
| `~/.dsh/profiles/headless/` + `vision` alat | Nije bilo u batch-u; `vision` red ide u `cordis.patch.yml` (live-watched → isti rizik kao A). |
| `dsh-context` plugin | Nije instaliran; instalater ga podržava (`WEB_PLUGINS = ["dsh-context"]`). `dsh-better-sidebar` namerno izbačen (React #130). |
| Restore `~/.claude/skills/{restart-dsh,voice-input,wa-message*}` u `~/.dsh/skills` | Uputstvo pominje samo `solid` i `uplati`; ostalo čeka potvrdu. |

---

## 10. Zašto dugmad nisu reagovala — i fix (2026-09-15 01:2x)

**Simptom:** dugmad composer-extras-a (📎/📷/📂/🗑️, i ceo picker) se **vide** ali klik
ne radi ništa.

**Uzrok:** `client.js` je za prvi korak pickera rešavao cwd preko
`sidebarApi("session.cwd", …)` → `/sidebar/api/session.cwd`. Taj namespace pripada
**`dsh-better-sidebar`-u, koji nije instaliran** (fixed installer ga izbacuje zbog
React #130), pa poziv ne uspe → promise se odbije pre nego što se lista učita.
Server je cwd ionako umeo sam (`sessionCwdOf` → `session.header.cwd`), samo to nije
bilo izloženo klijentu.

**Fix (u samom pluginu, bez tuđeg koda):**
- `index.js`: nova ruta `/composer-extras/api/session-cwd` (+ `handleSessionCwd`,
  isti `isLoopbackRequest` fence i `{ok,value}` envelope kao ostale rute)
- `client.js`: `callApi("/composer-extras/api/session-cwd", …)` umesto `sidebarApi`

**Validacija:** `node --check` oba fajla OK; na izolovanoj instanci —
GET → **405**, POST `{}` → **400**, POST `{sessionId}` → **200**
`{"ok":true,"value":{"cwd":"…"}}`; stara sidebar ruta nije radna.
→ Plugin sada **nema nijednu** zavisnost od `dsh-better-sidebar`.

**Dodatno u istom ciklusu:** `dsh-context@0.52.0` instaliran (sam se upisao u bundles),
`SameSite=Strict → Lax` zakrpan na oba primerka (validirano: `Set-Cookie … SameSite=Lax`),
stari backup ključa obrisan. Boot test sa OBA plugina: bez grešaka.

**Sledeće:** jedan restart (`~/dsh/dsh-url.sh`) + **hard refresh** browsera
(dsh ne hot-reload-uje klijentske bundlove).

---

## 11. REŠENO — zašto dugmad nisu radila (2026-09-15 01:28)

**Uzrok (dokazan merenjem, ne nagađanjem):** slot `conversation.input.left` **ne
prosleđuje `session` kao običan prop** — prosleđuje **`sessionId`** direktno.
`client.js` je čitao `props.session.sessionId` → uvek `undefined` → svaki handler
oblika `if (sessionId !== undefined) ...` je tiho ne radio ništa.

Dokaz iz `~/dsh/composer-diag.log` (instrumentacija ubačena u plugin):

```
propKeys: [...,"sessionId","inputActions","useSession",...]   <- ima sessionId, NEMA session
23:25  quicktext-click  sessionId=null        (pre fixa)
23:28  quicktext-click  sessionId=POPUNJEN    (posle fixa — i poruka je stigla)
```

**Fix:** 4 mesta u `client.js` sada čitaju `props.sessionId` (uz fallback na stari
`props.session`). Backup: `client.js.bak-20260915-012810`.

**Instrumentacija ostaje** (korisna): `/composer-extras/api/diag` →
`~/dsh/composer-diag.log`, loguje svaki klik sa `propKeys`/`hasSession`/`sessionId`.
Ukloniti kad ne treba: obriši rutu u `index.js` + `reportDiag` pozive u `client.js`.

**PWA:** proradila posle reinstalacije WebAPK-a (svež cookie iz Chrome jar-a) +
`SameSite=Lax` zakrpa — sada trajno.

---

## 12. Gemini modeli (2026-09-15 01:30)

**Cilj:** u pickeru drzati samo Gemini "latest" Flash i DeepSeek.

**Kako:** id-targeted override cvora `llm-pi-ai` u `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GOOGLE_API_KEY
        models:
          - id: gemini-flash-latest
          - id: gemini-flash-lite-latest
```

Navedeni `models:` **suzava** pi-ai katalog (ostali modeli se ne prikazuju), a
`id`-ovi zadrzavaju katalog default-e. DeepSeek ruta se ne dira.

**Vazno otkrice:** config override na **postojecem** cvoru se primenjuje
**hot-reload-om, bez restarta** — za razliku od `insert`-a NOVOG cvora
(Opcija A u sekciji 3, koja nije radila). Provereno live:
`/composer-extras/api/provider-check?provider=google&model=gemini-flash-latest`
→ `resolved:true`, ctx **1 048 576**.

**Odrzavanje:** `~/dsh/gemini-catalog-update.py` (idempotentan, launcher ga zove
pri svakom startu). Ne prepisuje fajl ako u njemu ima tudjih izmena.

**Rezultat:** `gemini-flash-latest` (1M ctx), `gemini-flash-lite-latest` (1M ctx),
`deepseek-v4-flash-vision-exp` — svi `resolved:true`.
