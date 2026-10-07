# DeepSeek Harness (dsh) na Termux/Android — kompletno uputstvo

**Uređaj:** Nothing A142, Android 16, aarch64, bez root-a
**Termux uid:** `u0_a335`, paket `com.termux`
**Zapisano:** 2026-08-28 · **Ažurirano:** 2026-08-29 (Prepreke 4–5, `vision` alat, tajne, Full access default, `dsh-composer-extras` file-picker/rename/delete/slash komande/mtime sort/Try again)
**Status:** radi — instalacija, čitanje/pisanje fajlova, Termux API pristup, čitanje slika i skladištenje API ključeva su potvrđeni na uređaju

> Ovaj dokument zamenjuje stariji `DeepSeekHarnessTermuxUputsvo.md` u istom folderu.
> Taj stariji je napisao sam dsh dok problem sa hard link-ovima **još nije bio rešen**,
> pa njegov "PART 2: The Execution Roadblock" i lista neuspelih pokušaja više ne važe.
> Rešenje je opisano ovde u delu **Prepreka 1**.

Uz ovaj fajl ide i skripta `dsh-termux-install.py` (isti folder) koja izvodi sve
korake automatski i idempotentna je — bezbedno je pokrenuti je više puta:

```bash
python3 ~/storage/shared/Documents/markor/dsh-termux-install.py              # sve
python3 ~/storage/shared/Documents/markor/dsh-termux-install.py --patch-only # samo hard-link zakrpa
python3 ~/storage/shared/Documents/markor/dsh-termux-install.py --check      # samo dijagnostika
python3 ~/storage/shared/Documents/markor/dsh-termux-install.py --no-npm     # preskoči pkg/npm
```

Skripta nikad ne dira `~/.dsh/.credentials.yaml` — API ključ unosiš sam kroz dsh UI.

---

## 1. Verzije koje su korišćene

| Komponenta | Verzija |
|---|---|
| `@deepseek-ai/dsh` | 0.1.1-rc.2 |
| Node.js | v24.18.0 |
| npm | 11.19.1 |
| npm prefix | `/data/data/com.termux/files/usr` |
| termux-am | 0.8.0 |
| Termux:API app | instaliran i radi |

---

## 2. Preduslovi

```bash
pkg update && pkg upgrade -y
pkg install nodejs cmake build-essential which python -y
```

`cmake` i `build-essential` trebaju **samo** tokom instalacije (native moduli se
kompajliraju iz izvora). Posle uspešne instalacije mogu da se uklone:

```bash
pkg uninstall cmake build-essential -y && pkg autoremove -y
```

Iz Play prodavnice / F-Droida mora biti instaliran i **Termux:API** (companion
aplikacija). Bez nje `termux-*` komande ne rade.

```bash
pkg install termux-api -y     # CLI deo; aplikacija se instalira zasebno
```

---

## 3. Instalacija dsh-a

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm install -g @deepseek-ai/dsh
```

`--max-old-space-size=4096` je obavezan: podrazumevani V8 heap u Termuxu je
prenizak i `npm install` pukne na kompajliranju.

Ako `sharp` (obrada slika) padne zato što nema zvaničan `android-arm64` binarni
build, ubaci WASM fallback:

```bash
cd $PREFIX/lib/node_modules/@deepseek-ai/dsh
NODE_OPTIONS="--max-old-space-size=4096" npm install sharp @img/sharp-wasm32
```

---

## 4. Prepreke koje su morale da se reše

Instalacija sama po sebi nije dovoljna. Bez ovih stvari dsh se digne, ali ne
može ni da sačuva sesiju, ni da piše fajlove, ni da otvori aplikaciju, ni da
pročita sliku, ni da pretraži fajlove po sadržaju.

> Sve zakrpe iz Prepreka 1, 4 i 5 su danas u **jednoj** skripti,
> `~/dsh/patch-android-dsh.py` (naslednik starijeg `patch-android-hardlink.py`
> pomenutog niže — taj naziv je istorijski, ostavljen radi konteksta). Skripta
> je idempotentna i `~/.local/bin/dsh-termux` je pokreće **automatski pri
> svakom startu**, pa `npm install -g` više ne može trajno da razvali
> instalaciju. Ručno: `python3 ~/dsh/patch-android-dsh.py`.

### Prepreka 1 — SELinux blokira hard link (`EACCES`)

**Simptom:** čim se pošalje bilo koja poruka, agent pukne sa:

```
EACCES: permission denied, link '.../session.jsonl.zstd.tmp' -> '.../session.jsonl.zstd'
```

**Uzrok:** dsh objavljuje fajlove atomično po šablonu *upiši `.tmp` → `link()` →
obriši `.tmp`*. Android SELinux zabranjuje `link(2)` unutar privatnog app-data
direktorijuma. Nije u pitanju bug dsh-a niti Termuxa — to je politika sistema.

Tri paketa to rade:

- `@deepseek-ai/dsh-session-persistence-jsonl` — snimanje sesija
- `@deepseek-ai/dsh-attachment-local` — attachment store (dedup po sha256)
- `@deepseek-ai/dsh-fs-local` — **`write` alat**, tj. sposobnost agenta da piše fajlove

⚠️ **Zamka sa putanjom:** ova tri paketa **nisu** u gornjem
`$PREFIX/lib/node_modules/@deepseek-ai/`, nego u ugnježdenom node_modules-u
unutar samog dsh paketa:

```
$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<paket>/lib/index.js
```

Ako se zakrpa primeni na pogrešan nivo, tiho ne uradi ništa.

**Rešenje:** zameni `link(src, dst)` sa `copyFile(src, dst, COPYFILE_EXCL)`.
Krajnji rezultat je isti, a `COPYFILE_EXCL` čuva istu `EEXIST` semantiku — što
je bitno, jer se na nju oslanjaju i dedup po sha256 i pravilo "ko prvi kreira,
taj pobeđuje" u `write` alatu. Jedina razlika je da se ne deli inode.

Primenjeno je u **dva sloja**, namerno:

1. **Zakrpa fajlova** — `~/dsh/patch-android-hardlink.py` prepravlja
   `import { link } from "node:fs/promises"` u sva tri paketa.
   *Nedostatak:* `npm install -g` je pregazi.
2. **Preload backstop** — `~/dsh/no-hardlink.cjs` se učitava kroz
   `node --require`, **pre** nego što dsh bilo šta importuje, pa presretne i ESM
   import. Preživi update.

> ⚠️ **Posle svakog `npm install -g @deepseek-ai/dsh` ponovo pokreni:**
> ```bash
> python3 ~/dsh/patch-android-hardlink.py
> ```
> Ako ikad opet vidiš `EACCES ... link ...` — zakrpa je izgubljena.

**Šta NE raditi** (sve je isprobano i ne radi):

- `sed` zamena `fs.linkSync` → `fs.copyFileSync` po celom stablu — promaši ESM importe
- isključivanje `session-persistence-jsonl` kroz `cordis.patch.yml` (`$remove`) — loader ga svejedno instancira
- `--persistence-backend=sqlite` — `error: unknown option`
- `ln -s /sdcard/Download/.dsh ~/.dsh` — shared storage ne podržava symlink, dsh pukne pri startu
- premeštanje samo `sessions/` na `/sdcard` — ne rešava `dsh-fs-local`, tj. `write` alat i dalje ne radi

### Prepreka 2 — sandbox

Radi **isključivo `danger-full-access`**.

`workspace-write` zahteva bubblewrap ili Landlock; ni jedno ni drugo ne postoji
na Androidu.

**Full access je sada podrazumevan za svaku sesiju.** Launcher
`~/.local/bin/dsh-termux` postavlja:

```bash
export DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-danger-full-access}"
```

Tu jednu promenljivu čitaju **sve tri** sklopke dozvola u profilu
(`sandbox-policy` → režim, `approval` → politika `never`, `permission-presets`
→ selektor u UI-ju), pa nove sesije kreću na "Full access" bez ručnog biranja.
Okolina i dalje ima prednost (`${VAR:-default}`), a izmena živi van npm-a, pa je
`npm install -g` ne briše. Važi od sledećeg pokretanja dsh-a.

### Prepreka 3 — `am start` ne otvara aplikacije

**Simptom:** `am start` ispiše `Starting: Intent { ... }`, izađe sa kodom 0, a na
ekranu se ništa ne desi.

Tri **nezavisna** uzroka — svaki maskira sledeći, pa moraju svi da se reše:

1. **Pogrešan `am` binarni fajl.** Koristi `$PREFIX/bin/am` (termux-am 0.8.0,
   pokreće svoj apk kroz `app_process`). Golo `am` već pokazuje na njega.
   Dva lažnjaka:
   - `/system/bin/am` → `SecurityException: package=com.android.shell does not belong to uid=10335` (i dalje izlazi sa 0!)
   - `termux-am` (socket klijent) → `Could not connect to socket`, server ne radi
2. **Background Activity Launch (BAL).** Android odbacuje pokretanje aktivnosti
   iz aplikacije koja nije vidljiva na ekranu. Pošto dsh UI živi u Chrome-u,
   Termux je **uvek** u pozadini — bez ove dozvole ne radi nijedan `am start`.
   Rešenje: Termuxu dati **"Display over other apps"** (`SYSTEM_ALERT_WINDOW`).
   ```bash
   am start -a android.settings.action.MANAGE_OVERLAY_PERMISSION
   ```
   Dozvola ide na **`com.termux`**, ne na `com.termux.api` — `am` se izvršava kao
   taj paket. Odobreno 2026-08-28.

   **Provera bez otvaranja ekrana:**
   ```bash
   am start --check-draw-over-apps-permission -a com.termux.probe.NOOP
   # "unable to resolve Intent"          -> dozvola POSTOJI
   # 'requires the "Display over other apps" permission' -> dozvola FALI
   ```
   ⚠️ Zamka: `--check-draw-over-apps-permission` proveri dozvolu pa **nastavi da
   pokrene aktivnost**. Ako se kao provera pošalje `-a android.settings.SETTINGS`,
   korisniku se bukvalno otvore Settings svaki put — to je bug, ne dijagnostika.
   Zato se šalje akcija koju nijedna aplikacija ne registruje: provera se odigra,
   intent se ne razreši, ekran ostane netaknut. Izlazni kod je tada 1 u oba
   slučaja, pa se odgovor čita iz **poruke**, ne iz koda.
3. **Pogrešan intent.** Vidi primer za Solid Explorer niže.

> **Izlazni kod 0 ne znači da se aplikacija otvorila.** Pogrešan mimeType,
> zakucana komponenta i sistemsko odbijanje izgledaju identično. Uvek pitaj
> korisnika šta vidi na ekranu.

**Redosled dijagnostike** kad se ništa ne otvori:

1. Pročitaj `am`-ov **stderr**. `Warning: Activity not started, its current task
   has been brought to the front` = fale `-f` flagovi.
2. Neutralna kontrola: `am start -a android.settings.SETTINGS`. Ako ni Settings
   ne izađe — problem je BAL/dozvola, **prestani da doteruješ intent**.
3. Tek onda diraj sam intent.

### Prepreka 4 — attachment store fsync-uje `/`, `/data`, `/data/data`

**Simptom:** svaki `read_image` ili attachment upload puca sa

```
EACCES: permission denied, open '/data/data'
```

**Uzrok:** `dsh-attachment-local` (`ensureDurableHome` → `syncDirectory`) posle
upisa fsync-uje **svakog pretka** `$DSH_HOME`-a, sve do `/`, da bi upis bio
durable i posle iznenadnog gašenja. Na Androidu `/`, `/data` i `/data/data` app
uid ne sme ni da otvori — pa cela operacija puca, iako je sam fajl uspešno
sačuvan.

**Rešenje:** `syncDirectory` postaje best-effort — ako `open()` ili `fsync()`
nad pretkom vrati `EACCES`/`EPERM` (ili `EINVAL`/`ENOTSUP`/`EOPNOTSUPP` za
fsync na nekim spoljnim volume-ima), taj korak se tiho preskoči umesto da obori
ceo upis. Deo je paketa `@deepseek-ai/dsh-attachment-local`, isti fajl gde živi
i attachment store.

### Prepreka 5 — nema `android-arm64` build za ripgrep

**Simptom:** `glob` i `grep` alati pucaju sa "ripgrep launch failed" /
"glob could not start its search command".

**Uzrok:** `@vscode/ripgrep` (koji dsh koristi za `glob`/`grep`) objavljuje
prekompajlirane binarne fajlove po platformi, ali ne postoji paket za
`android-arm64`.

**Rešenje:** `@vscode/ripgrep/lib/index.js` pada na `$DSH_RG_PATH`, a ako ni
to nije postavljeno — na sistemski `rg` sa `$PATH`-a:

```bash
pkg install ripgrep
```

---

## 5. Dozvole — čitanje, pisanje i Termux API

Ovo je deo koji je dsh-u dao prava da radi kako treba.

### Deljeno skladište (shared storage)

```bash
termux-setup-storage
```

Otvara Android dijalog — mora se odobriti ručno. Napravi `~/storage/*` prečice i
otključava `/storage/emulated/0` (`Download/`, `Documents/`, `Install/`, …).

**Bitno:** sve pod `/data/data/com.termux/` je privatno i **nevidljivo svakoj
drugoj aplikaciji**. Da bi se fajl predao drugoj aplikaciji, prvo se kopira u
`/storage/emulated/0/Download/`.

### Pisanje fajlova (`write` alat)

Radi tek posle zakrpe iz **Prepreke 1** — `dsh-fs-local` je jedan od tri
patchovana paketa. Bez nje agent može da čita, ali svaki upis pukne sa `EACCES`.

### Termux API

CLI: `pkg install termux-api` + instalirana **Termux:API** aplikacija.

Komande koje ne otvaraju ekran rade pouzdano i iz pozadine:

```
termux-battery-status   termux-clipboard-get   termux-clipboard-set
termux-notification     termux-contact-list    termux-sms-list
termux-tts-speak        termux-toast           termux-vibrate
termux-share            termux-speech-to-text
```

Komande koje otvaraju ekran (`termux-share`, `termux-speech-to-text`, `am start`)
dodatno zavise od overlay dozvole iz **Prepreke 3**.

### Pokretanje drugih aplikacija — primer Solid Explorer

```bash
am start -f 0x10008000 -a android.intent.action.VIEW \
         -d "file:///storage/emulated/0/Comics" -t "resource/folder"
```

Oba argumenta nose težinu:

- `-t "resource/folder"` — filter aktivnosti se poklapa **samo po mimeType-u**
  (`resource/folder`, `inode/directory`, `vnd.android.document/directory`) i ne
  deklariše `file` šemu. Bez tipa Android ne nađe poklapanje i pokaže generički
  "Open with" u kom Solid Explorer nije ni izlistan.
- `-f 0x10008000` (`NEW_TASK | CLEAR_TASK`) — aktivnost je `launchMode="singleTask"`,
  pa bez ovih flagova samo podigne već pokrenuti Solid Explorer na **prethodnom**
  folderu.

**Nikad ne dodavati** `-n pl.solidexplorer2/pl.solidexplorer.SolidExplorer` —
zakucavanje komponente preskače poklapanje filtera, aktivnost se pokrene bez tipa
koji očekuje i odmah se zatvori. Prazan ekran, izlaz 0.

Pojedinačni fajlovi se poklapaju samo sa arhivskim filterima (zip/gzip/tar/7z/rar) —
za deljenje nekog drugog fajla otvori njegov **roditeljski folder**.

Prave filtere bilo koje aplikacije uvek možeš pročitati:

```bash
aapt2 dump xmltree --file AndroidManifest.xml "$(pm path pl.solidexplorer2 | sed s/^package://)"
```

---

## 5b. Slike: Pro model ne vidi, delegiraj `vision` alatu (Pattern B)

Podrazumevani model (`deepseek-v4-pro`) je **tekstualni** — ne prima sliku kao
ulaz. `read_image` traži da *pozivajuća ruta* bude image-capable, pa na Pro
modelu puca sa `model "…" does not declare image input`.

Goli `subagent` alat **ne pomaže**: njegova šema ka modelu ima samo
`description`/`prompt`/`run_in_background` — dete nasleđuje roditeljski,
tekstualni model i udara u istu grešku. Model detetu ne može da izabere model,
to ide isključivo kroz `agentOptions` u plugin configu.

**Rešenje:** profili `web` i `headless` imaju drugu instancu
`@deepseek-ai/dsh-tool-subagent`, izloženu kao alat **`vision`**
(id `tool-subagent-vision`), zakucanu na `deepseek-official` /
`deepseek-v4-flash-vision-exp`, sa dozvoljenim `read_image`/`read`/`glob`.
Pro model treba da zove **`vision`** sa putanjom slike i onim što mu treba —
dete vraća čist tekst (transkripcija, opis layout-a, boje...), koji Pro dalje
koristi. Nikad ne zvati `read_image` direktno sa Pro-a.

Provera da red stvarno postoji u profilu:

```bash
dsh --profile web --dump-config | grep -n vision
```

Konfiguracija reda: `~/.dsh/profiles/web/cordis.patch.yml` i
`~/.dsh/profiles/headless/cordis.patch.yml` (isti `- insert:` blok u oba).
Detaljno objašnjenje i primer promptа: `~/.dsh/AGENTS.md`.

## 5c. Tajne (API ključevi) van trag-a sesije

`~/.dsh/.credentials.yaml` ima prava `600` i sam po sebi je bezbedan — nijedna
druga aplikacija ga ne vidi. Problem je posredan: dsh ima `read` alat i ume
**sam, neisprovociran**, da ga pročita (npr. dok razgleda `~/.dsh/` u potrazi
za `settings.yaml`). Rezultat svakog poziva alata upisuje se doslovno u
`session.jsonl`, a "export session" ga pakuje u zip **na deljenom storage-u**
(`/storage/emulated/0/Download/`) bez ikakve redakcije — ključ tako izađe iz
sandboxa čim se ta sesija podeli ili exportuje.

**Rešenje:** ključevi se drže van `$DSH_HOME`, u `~/.config/dsh-secrets.env`
(prava `600`, `export KEY='vrednost'` linije). `~/.local/bin/dsh-termux` taj
fajl source-uje pre starta dsh procesa. `dsh-credentials-local` daje env
prioritet nad `.credentials.yaml` (`source: "env"`, `writable: false`), pa dsh
vidi identičan ključ — samo što `.credentials.yaml` sad stoji prazan i `read`
nad njim ne vraća ništa.

Migracija je četvrti, idempotentni korak u istoj skripti kao i Prepreke 1/4/5
(`~/dsh/patch-android-dsh.py`) — pokreće se sama pri svakom `dsh` startu.
Novi ključ se dodaje direktno u `dsh-secrets.env`, nikad u `.credentials.yaml`.
Kompletno uputstvo (rotacija, dodavanje ključa, šta ovo ne rešava):
`~/dsh/SECRETS.md`.

---

## 6. Pokretanje

Launcher: `~/.local/bin/dsh-termux`

```bash
node --expose-internals --max-old-space-size=4096 \
     --require "$HOME/dsh/no-hardlink.cjs" \
     $PREFIX/lib/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 3081
```

- `--expose-internals` — traži ga `cordis-plugin-hmr`; **ne može** se proslediti
  kroz `NODE_OPTIONS`, mora direktno u komandnu liniju
- `--max-old-space-size=4096` — isti razlog kao pri instalaciji
- `--require .../no-hardlink.cjs` — backstop iz Prepreke 1
- port **3081** — 3080 je držala starija, sandboxovana instanca

U `~/.bashrc`:

```bash
dsh() { command "$HOME/.local/bin/dsh-termux" "$@"; }
```

Funkcija zasenjuje `/usr/bin/dsh`, koji bi pao. Bez argumenata diže Web UI na
3081; sa argumentima je čist passthrough (`dsh plugin ...`, `dsh --profile headless "..."`).

⚠️ Funkcija `dsh` živi u `~/.bashrc`, koji **`bash -lc` ne čita**. U skriptama,
`nohup`-u i cron-u zovi launcher punom putanjom — inače se pozove
`/usr/bin/dsh` i dobiješ `error: --profile <name> is required`:

```bash
nohup ~/.local/bin/dsh-termux > ~/dsh/dsh-web.log 2>&1 &
```

Provera da radi:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081   # očekuje se 200
pkill -f 'dsh/lib/bin[.]js'                                      # gašenje
```

### PWA na početnom ekranu

"DSH 手机版" je Chrome WebAPK (`org.chromium.webapk.a4493d0bfd9f0758e_v2`) koji
pokazuje na `http://127.0.0.1:3081/`. Nije zasebna aplikacija — samo prečica ka
lokalnom serveru. **Ne dirati** ovaj paket.

---

## 7. Konfiguracija

| Putanja | Šta je |
|---|---|
| `~/.dsh/AGENTS.md` | globalna uputstva agentu — sve o Termux okruženju, `am`, hard link zakrpi, sandboxu |
| `~/.dsh/settings.yaml` | model (`deepseek-v4-flash-vision-exp`, `reasoningEffort: high`) |
| `~/.dsh/.credentials.yaml` | namerno prazan (`version: 1` + komentar) — pravi ključevi su u `dsh-secrets.env`, vidi **5c** |
| `~/.config/dsh-secrets.env` | stvarni API ključevi (`DEEPSEEK_API_KEY`, ...), mode 600, source-uje ga launcher |
| `~/.dsh/skills/<ime>/SKILL.md` | skills; postoje `solid` i `uplati` |
| `~/.dsh/profiles/{web,headless}/` | cordis profili; `cordis.patch.yml` ima `tool-subagent-vision` red (alat `vision`, vidi **5b**) |
| `~/.dsh/profiles/web/node_modules/dsh-better-sidebar/lib/index.js` | sidebar host; ovde je zakrpljen `fs.delete` metod (vidi sekciju 9) |
| `~/dsh/dsh-composer-extras/` | lokalni plugin: spajalica + kantica za brisanje (klijent deo) |
| `~/.local/bin/dsh-termux` | launcher; postavlja `DSH_PERMISSION_MODE=danger-full-access` (Full access default) |
| `~/.dsh/sessions/` | snimljene sesije |

dsh traži globalna uputstva u `$DSH_HOME` po redu: `AGENTS.md`, `CLAUDE.md`,
`AGENTS.local.md`, `CLAUDE.local.md`. Skills traži u `~/.dsh/skills/` i
`.agents/skills`; frontmatter mora imati `name` i `description`.

Skill `uplati` **poziva zajedničku skriptu na licu mesta**
(`python3 ~/.claude/skills/uplati/uplati.py`) i namerno je ne kopira — inače bi
dve kopije počele da se razilaze. Šabloni u `~/.uplati/` (mode 0700/0600) su
time već zajednički sa Claude-om. Brojevi računa ne smeju da izađu iz tog
direktorijuma — ni u chat, ni u log, ni u fajl.

---

## 8. Održavanje

Posle **svakog** update-a:

```bash
npm install -g @deepseek-ai/dsh
python3 ~/dsh/patch-android-dsh.py     # OBAVEZNO — sve 4 zakrpe odjednom
pkill -f 'dsh/lib/bin[.]js' && dsh
```

U praksi ni ovo ne treba raditi ručno — `~/.local/bin/dsh-termux` pokreće
`patch-android-dsh.py` sam, pri svakom startu.

Restart je potreban i posle izmene `AGENTS.md` ili bilo kog `SKILL.md`.

---

## 9. Plugini (Cordis) — mobilni UI

dsh je građen na Cordis arhitekturi ("sve je plugin"), pa se web UI može
proširiti. Instalirano i provereno na ovom uređaju:

- **`dsh-better-sidebar`** 0.16.1 (MIT, `github.com/omdsh-dev/DSH-better-sidebar`)
  — VSCode-oliki desni sidebar: file explorer, editor, terminal drawer, git
- **`dsh-context`** 0.34.0 (Apache-2.0, `github.com/bowenliang123/dsh-context`)
  — context dashboard i `/context` komanda: od čega se kontekst sastoji i kako
  raste. Ovo je pravi analogon izmišljenog `dsh-context-doctor`.
- **`dsh-composer-extras`** (lokalni, `~/dsh/dsh-composer-extras`, linkovan u
  profil preko `link:`) — paperclip dugme koje otvara pravi file-picker nad
  workspace-om (browse, upload sa telefona, mkdir, rename, delete, image
  preview) plus `/clear-context` i `/restart` slash komande. Vidi dole
  "9b. `dsh-composer-extras`" za punu dokumentaciju.

Sva tri su potvrđena na ekranu, ne samo u konfiguraciji.

### Gde se `dsh-context` vidi

Nije na početnom ekranu — pojavljuje se na tri mesta:

1. **Tab `Context`** pored `Chat` i `Trajectory`, **samo unutar otvorene sesije**
2. **`/context`** u chat polju (ili iz `/` menija) — isti prikaz kao modal
3. **Settings → Plugins → Plugin configuration**, kartica `Context` —
   granularnost trenda (Step/Turn), režim (Total/Delta), sortiranje File Activity

Tab sadrži `Context Stats` (turns, steps, injections, compactions, tool calls,
cache hit, cost), `Plugin Info`, `Current Context` (šestobojna traka: system
prompt / tool schemas / user messages / injected context / assistant messages /
tool results, skalirana na ceo prozor modela) i `Context Trend` (jedan stubić po
zahtevu, ✂ označava kompakciju).

Prikaz ima smisla tek kad sesija ima istoriju — na svežoj sesiji je skoro prazan.

### Ažuriranje plugina

```bash
dsh plugin --profile web update dsh-context@latest
cd ~/.dsh/profiles/web && pnpm install     # ako plugin ima native zavisnost
pkill -f 'dsh/lib/bin[.]js' && dsh
```

`Plugin Info` kartica sama javlja kad postoji novija verzija (npr.
`dsh-context (v0.34.0) ↑ v0.37.0`). pnpm ume da razreši stariju verziju od
najnovije zbog peer dependency-ja na tvoju `dsh 0.1.1-rc.2` — to nije greška.

### Tačan postupak (5 koraka, svaki je bio neophodan)

```bash
# 1. pnpm — `dsh plugin` je samo omotač oko pnpm-a, bez njega odmah pukne
npm install -g pnpm
termux-fix-shebang $PREFIX/bin/pnpm      # npm pise #!/usr/bin/env, sto u Termuxu ne postoji

# 2. node-gyp — node-pty nema android-arm64 prebuild, mora da se kompajlira
npm install -g node-gyp
termux-fix-shebang $PREFIX/bin/node-gyp

# 3. instalacija plugina u profil (--profile je OBAVEZAN)
dsh plugin --profile web add dsh-better-sidebar

# 4. dozvoli build native modula: u ~/.dsh/profiles/web/pnpm-workspace.yaml
#    pnpm je sam upisao placeholder `node-pty: set this to true or false`
#    allowBuilds:
#      node-pty: true
cd ~/.dsh/profiles/web && pnpm install

# 5. registruj plugin kao bundle u ~/.dsh/profiles/web/package.json:
#    "dsh": { "profile": { "bundles": [
#        "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
#        "dsh-better-sidebar" ] } }
pkill -f 'dsh/lib/bin[.]js' && dsh
```

Provera da je plugin stvarno učitan (ne samo instaliran):

```bash
dsh --profile web --dump-config | grep -nE 'name: (dsh-better-sidebar|dsh-context)'
# ocekuje se po jedan red za svaki plugin
```

Ovo je jedina provera koja stvarno nešto znači. `pnpm ls` pokazuje da je paket
na disku, što ne govori ništa o tome da li ga dsh učitava.

### Pet grešaka koje ovo obara

| Greška | Poruka | Rešenje |
|---|---|---|
| `dsh plugin add <pkg>` bez profila | `required option '--profile <name>' not specified` | `dsh plugin --profile web add <pkg>` |
| pnpm nije instaliran | `pnpm not found on PATH — install pnpm to manage profile plugins` | `npm install -g pnpm` |
| npm shebang u Termuxu | `/usr/bin/env: bad interpreter` | `termux-fix-shebang $PREFIX/bin/<alat>` |
| pnpm 11 blokira build skripte | `ERR_PNPM_IGNORED_BUILDS: node-pty` | `allowBuilds: {node-pty: true}` u `pnpm-workspace.yaml` |
| **instaliran ≠ učitan** | nema poruke, plugin se prosto ne pojavi | vidi napomenu ispod |

Poslednja je najpodmuklija, i lako se pogrešno dijagnostikuje — meni se to i
desilo iz prve.

`dsh plugin --profile web add <pkg>` **sam upisuje paket u
`dsh.profile.bundles`** — to je provereno na `dsh-context`, koji je prošao iz
prve i sam se registrovao. Ali registracija je *poslednji* korak: ako pnpm
usput pukne (kod nas na `ERR_PNPM_IGNORED_BUILDS` zbog `node-pty`), komanda
izađe sa kodom 1 i **do upisa nikad ne dođe**. Paket ostane na disku, `pnpm ls`
ga vidi, a dsh ga ne učitava.

Zato: **greška 4 nije samo upozorenje — ona tiho obara i korak 5.** Ako je
`dsh plugin add` izašao sa kodom ≠ 0, uvek proveri `bundles` rukom:

```bash
python3 -c "import json;print(json.load(open('$HOME/.dsh/profiles/web/package.json'))['dsh']['profile']['bundles'])"
```

> ⚠️ **`pnpm` piše u `~/.local/share/pnpm/store/v11`** i to nije pokriveno
> hard-link zakrpom. Ovde je prošlo jer pnpm na ovom FS-u koristi kopiranje
> ("Packages are cloned from the content-addressable store"). Ako ikad iskoči
> `EACCES ... link ...` iz pnpm-a, dodaj u `~/.npmrc`:
> `package-import-method=copy`

### Imena paketa — proveri pre instalacije

Od plugina koje predlažu LLM-ovi, dobar deo ne postoji. Provereno na npm-u
2026-08-28:

| Ime | Status |
|---|---|
| `dsh-better-sidebar` | ✅ postoji, 0.17.1 |
| `dsh-routing-suite` | ✅ postoji |
| `@openguardrails/dsh-tui` | ✅ postoji |
| `dsh-context-doctor` | ❌ 404 — pravi analogon je **`dsh-context`**, instaliran i radi |
| `dsh-todo-guard` | ❌ 404 — todo je ionako ugrađen (`@deepseek-ai/dsh-tool-todo`) |
| `cleverer-dsh` | ❌ 404 |
| `dsh-mini` | ❌ 404 |

Uvek proveri pre nego što instaliraš:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/<ime-paketa>
# 200 = postoji, 404 = izmisljeno
curl -s "https://registry.npmjs.org/-/v1/search?text=dsh%20plugin&size=50" | grep -o '"name":"[^"]*dsh[^"]*"'
```

### Sitnica: `dsh web --host 127.0.0.1 --port 8080`

`--host` i `--port` postoje, ali port 8080 nema prednost nad 3081 — a launcher
`~/.local/bin/dsh-termux` ionako pinuje 3081 i proverava da li je slobodan.
Ostani na 3081.

---

## 9b. `dsh-composer-extras` — paperclip file-picker, slash komande

Sopstveni plugin, **potpuno odvojen od `dsh-better-sidebar`** — nikad ne
patch-uje tuđi kompajlirani kod, pa `dsh plugin --profile web update ...` ili
`pnpm install` na sidebar-u ga ne mogu pokvariti. Živi u `~/dsh/dsh-composer-extras/`
(van npm-a; kopija zbog arhive je u ovom folderu, `dsh-composer-extras/`) i
linkuje se u profil preko `link:` u `~/.dsh/profiles/web/package.json`.
Dva fajla:

- **`client.js`** — browser deo. Mora biti umotan u
  `window.__ModuleLoader__.load({id: "dsh-composer-extras", factory})` — dsh-ov
  loader NIJE plain ESM; goli `import`/`export` fajl se učita kao script ali se
  nikad ne registruje, i loader onda odbije da podigne SVE pluginove ("Failed
  to load plugins"). Ovo je pukло dvaput u razvoju, pazi ako se fajl ikad
  prepisuje ručno.
- **`index.js`** — server deo (ESM, obično `apply`/`inject`/`name` export).

### Paperclip dugme (levo od composer-ovog "+")

Klik **odmah otvara file-picker nad workspace-om** (bez međukoraka menija).
Modal prikazuje trenutni folder; ".." vodi nagore. Slike u listi imaju pravu
malu sličicu (22×22, preko `/composer-extras/api/image-preview`), ne generičku
ikonicu.

**Selekcija je dvostepena, namerno**: klik na fajl ga samo markira (plava
pozadina); atačuje se tek na klik **Select** (plavo dugme, krajnje desno —
primarna akcija, deaktivirano dok ništa nije markirano). Ovo je zamenilo raniju
verziju koja je za slike i vision-capable model koristila core
`conversation.createDraftImages`/`input.addImages` seam direktno (brži put, ali
druga mentalna mapa od `@putanja` fajlova) — sad SVE, slika ili ne, ide kroz
isti tok: upload/postojeći fajl u direktorijumu → markiraj → Select.

Dugmad u donjem redu (levo grupa, sve workspace-scoped — sakrivena kad se
izađe iz workspace-a preko unrestricted moda, vidi dole):

- **📷 Galerija** — `<input type="file" accept="image/*">`, native Android
  photo picker.
- **📎 Sa telefona** — isti input BEZ `accept` filtera → pravi native chooser
  (Camera / Camera Video / Files) sa slike na strani 2. Files app u tom
  chooseru vidi deljeni storage/cloud, ali **ne** vidi Termux-ov privatni
  workspace (ista sandbox granica koja sprečava Solid Explorer da otvori
  `~/dsh` direktno) — zato oba dugmeta i dalje postoje, pokrivaju suprotne
  smerove.
- **📂 Novi folder** — pravi podfolder tu gde se trenutno pregleda.
- **🗑️ (footer)** — briše trenutno markirani fajl.

I 📷 i 📎 upload-uju **u folder koji se trenutno pregleda** (ne u fiksni
podfolder) preko `/composer-extras/api/upload-to-workspace`
(`{sessionId, filename, contentBase64, targetDir}`) — binary-safe write (za
razliku od sidebar-ovog `fs.write`, koji piše `content` kao utf8 tekst i
pokvario bi bajtove slike). Posle upload-a, picker se osveži i novi fajl je
automatski markiran — samo se još klikne Select.

**Rename i delete su na SVAKOM redu** (✏️/🗑️, i za fajlove i za foldere), ne
samo kroz footer — manje taps na telefonu je bio eksplicitan cilj. `stopPropagation`
sprečava da klik na akcionu ikonicu okine navigaciju/selekciju reda ispod.
Delete je rekurzivan za foldere i odbija brisanje samog korena workspace-a.

> ⚠️ **Bag koji je ovde postojao i nikad nije radio**: ranija verzija je zvala
> `sidebarApi("fs.delete", ...)`, a `dsh-better-sidebar` **nema** `fs.delete`
> (ni `fs.rename`) — proveren ceo route table u njegovom `src/index.ts`, samo
> `session.cwd/fs.tree/fs.search/fs.read/fs.write` i git rute postoje. Ta stara
> kantica je tiho padala na svaki klik. Rename i delete sad idu kroz SOPSTVENE
> workspace-scoped rute (`/composer-extras/api/{delete,rename}-in-workspace`),
> koje jesu curl-testirane na stvarnim fajlovima.

### "Unrestricted" mod — browse van workspace-a

Klik na ".." dok si već u korenu workspace-a prebacuje picker u unrestricted
mod (oznaka "🔓 van workspace-a" u modalu) — dalje penjanje ide preko cele
particije, preko `/composer-extras/api/fs-tree-unrestricted`, namerno BEZ
`dsh-better-sidebar`-ove `assertWithinWorkspace` provere. Ovo je eksplicitno
odobreno (korisnik je svesno tražio da picker može da čita van workspace-a);
sve write akcije (upload/mkdir/rename/delete) ostaju workspace-scoped i
sakrivaju se u ovom modu — samo čitanje je prošireno, ne i pisanje.

### `/clear-context` i `/restart` slash komande

Vide se u composer-ovom "+" meniju.

- **`/clear-context`** — zove `ctx.compaction.compactNow()` (isti seam kao
  ugrađeni `/compact`). **Nije pravo brisanje na nulu** — dsh nema izloženi API
  za to u ovoj verziji; ovo istoriju sažme na minimum preko LLM sumarizacije.
  Radi samo ako je `compaction-basic` uključen u profilu (u ovom setup-u jeste,
  preko `cordis.patch.yml` patch-a — dsh-web-app bundle ga po defaultu
  isključuje).
- **`/restart`** — restartuje ceo dsh proces iznutra (spawn-uje detached shell
  koji čeka 2s da se port 3081 oslobodi pa exec-uje `~/.local/bin/dsh-termux`).
  Isto što i `/restart-dsh` Claude Code skill sa terminala, samo bez potrebe da
  se izađe iz dsh-a.

### 🔁 Try again / 👍 Proceed dugmad

Dva dugmeta u composer toolbar-u (desno od paperclip-a), ista mehanika,
razni tekst: klik popuni draft (`"try again"` odn. `"Looks good, go ahead."`)
i odmah pošalje — nema dodatnog tap-a na Send. Zajednička funkcija
`sendQuickText(ctx, sessionId, text)` koristi `input.submit()` (default mode
`"queue"`) sa istog `SessionInputShell` objekta na kom `appendToDraft` već
zove `setDraft` — to je **pravi** send-trigger koji i sâm Enter taster
interno zove (`dsh-client-ui-conversation/lib/client.js`,
`SessionInputShell.actions.submit`), ne simulacija tastature ni zaobilazni
put. (Ranija verzija je imala samo Try again, sa posebnom `sendTryAgain`
funkcijom — sad je generalizovana da posluži i Proceed dugmetu.)

### 😎 gemini-seek-smart — auto rotacija Gemini/DeepSeek + 429 detekcija

Četvrto dugme, desno od Proceed-a. Uključeno po defaultu (pamti se preko
`localStorage` ključa `composer-extras-gemini-seek-default-enabled` — samo
eksplicitan klik na 😎 menja tu podrazumevanu vrednost; automatsko gašenje
opisano ispod NE dira je). Cilj: iskoristi Gemini Flash-Lite dokle god ide, a
kad ga rate-limit stigne, sam se prebaci na DeepSeek Flash i vrati kad prođe.

Raspored (`GEMINI_SEEK_SCHEDULE`):

1. **Gemini Flash-Lite** — 2 prompta (`kind: "count"`), sa dodatnim
   `windowMs: 60000` pravilom: ako od početka segmenta prođe 60s a nije
   poslat 2. prompt (korisnik pauzirao pa nastavio kasnije), stvarni upstream
   rate-limit prozor se već verovatno resetovao — brojač se vraća na 0/2
   umesto da se tretira kao "skoro potrošen".
2. **DeepSeek Flash** — 60s cooldown (`kind: "cooldown"`), pa nazad na
   Gemini, bez obzira koliko poruka stigne u tih 60s.

Ciklus se vrti dok je dugme uključeno. Wrap se instalira na
`input.submit()` (isti seam kao Try again/Proceed) tako da broji **svaki**
poslati prompt — ručni Enter, Send dugme, ili naša sopstvena dugmad — ne
samo klikove na svoje UI elemente.

**Immediate 429 reakcija** (ne čeka da se budžet potroši): kači se na
`session.notifier` (dsh-client-runtime-ova `Session` klasa, dobijena preko
`ctx.sessions.binding(sessionId)?.session` — NE `ctx.sessions.get(...)`,
koji ne postoji na `SessionRuntime`-u i tiho je bacao `TypeError` progutan
spoljnim `catch`-om, pa 429-watcher nikad nije bio instaliran). Prati
`session.lastAgentError` protiv `AGENT_ERROR_429_PATTERN`
(`/RESOURCE_EXHAUSTED|"code"\s*:\s*429/`) — čim se pojavi 429 dok je aktivan
Gemini segment, odmah preskače na DeepSeek (bez čekanja na count/window) i
sam pošalje `"try again"` preko `sendQuickText`.

**Auto-gašenje na ručni izbor modela**: `directory.store.subscribe` prati da
li se aktivni model promenio na nešto što gemini-seek-smart nije sam
postavio — ako jeste (korisnik ručno izabrao model iz padajućeg menija),
toggle se gasi. Zastavica `applyingSwitch` blokira sve watcher reakcije za
CELO trajanje sopstvenog `select()` poziva (ne samo trenutnu vrednost) — bez
nje su tranzicioni store-eventi tokom sopstvenog prebacivanja izgledali kao
"korisnik je ručno promenio model" i gasili toggle na svaki auto-switch,
što je tiho kvarilo i 60s auto-povratak na Gemini.

Title/tooltip na dugmetu (`geminiSeekLabel`) uživo pokazuje trenutni segment
i napredak (`"gemini-seek-smart: Gemini Flash-Lite (1/2)"` ili
`"... DeepSeek Flash (cooldown 37s)"`).

### Floating model status badge

Fiksni bedž pri vrhu ekrana (`position: fixed`, `pointerEvents: 'none'`) —
uvek prikazuje trenutno aktivan model (`current.model`), sa `" 😎"` sufiksom
kad je gemini-seek-smart uključen. Živi preko
`useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)`
— isti subscribe-kontrakt koji `dsh-client-ui-model-selection`-ov sopstveni
padajući meni koristi iznutra — pa se ažurira i na gemini-seek-smart-ov
`directory.select()` i na ručni izbor iz menija, bez razlike.

### Sortiranje fajlova u pickeru (najstariji → najnoviji)

`dsh-better-sidebar`-ov `fs.tree` (`SidebarFsEntry` u njegovom `fs-tree.ts`)
**nema polje za datum izmene uopšte** — nije se moglo sortirati po vremenu a
ostati na toj ruti. Zato workspace mod picker-a sad koristi SOPSTVENU
`/composer-extras/api/fs-tree-workspace` rutu (workspace-scoped, `ensureWithinCwd`)
umesto sidebar-ovog `fs.tree`; `session.cwd` i dalje ide preko sidebar-a (jedina
preostala zavisnost). I ta i `fs-tree-unrestricted` sad vraćaju `mtimeMs` po
stavci; klijent sortira rastuće (`a.mtimeMs - b.mtimeMs`) — najstariji na vrhu,
najnoviji na dnu, bez grupisanja foldera napred (to je bila stara VSCode-olika
konvencija, namerno izbačena).

### Diagnostika: `/composer-extras/api/debug-provider-check`

`GET ?provider=&model=` → šta god `ctx.llm.resolveModelInfo()` vrati, ili
grešku razrešavanja doslovno. Služi da se potvrdi da je izmena
`settings.yaml`-ovog `llm-pi-ai.providers` (npr. dodat drugi Gemini ključ)
stvarno primenjena, bez otvaranja browser sesije i čitanja picker
padajućeg menija. Vraća samo metapodatke kataloga, nikad vrednost kredencijala
— ostaje iza istog golog loopback fenca kao sve ostalo ovde.

### Primena / provera posle izmene

```bash
node -c ~/dsh/dsh-composer-extras/client.js   # syntax check pre restart-a
node -c ~/dsh/dsh-composer-extras/index.js
pkill -f 'dsh/lib/bin[.]js'; sleep 1
nohup ~/.local/bin/dsh-termux > ~/dsh/dsh-web.log 2>&1 & disown
sleep 8
curl -sf http://127.0.0.1:3081 -o /dev/null -w 'HTTP:%{http_code}\n'
grep -i "composer-extras\|ModuleLoader\|Failed to load" ~/dsh/dsh-web.log
```
`HTTP:200` i prazan grep = čisto. Hard-refresh browser-a posle (da dohvati
novi `client.js` — dsh ne hot-reload-uje plugin bundlove).

## 10. Brza tabela problema

| Simptom | Uzrok | Rešenje |
|---|---|---|
| `EACCES ... link ...` | SELinux blokira hard link | `python3 ~/dsh/patch-android-dsh.py` |
| `EACCES ... open '/data/data'` | attachment store fsync-uje pretke do `/` | `python3 ~/dsh/patch-android-dsh.py` (Prepreka 4) |
| `ripgrep launch failed` / glob ne kreće | nema `android-arm64` build | `pkg install ripgrep` + `python3 ~/dsh/patch-android-dsh.py` (Prepreka 5) |
| `model "…" does not declare image input` | Pro model je tekstualni | zovi alat `vision`, ne `read_image` direktno (5b) |
| ključ izašao u exportovan zip sesije | `.credentials.yaml` pročitan `read` alatom | ključevi u `~/.config/dsh-secrets.env`, vidi 5c i `~/dsh/SECRETS.md` |
| `npm install` pukne pri kompajliranju | premali V8 heap | `NODE_OPTIONS="--max-old-space-size=4096"` |
| `am start` izađe 0, ništa se ne otvori | BAL / pogrešan intent / pogrešan `am` | overlay dozvola → neutralna kontrola → intent |
| `Could not connect to socket` | pokrenut `termux-am` | koristi golo `am` |
| `SecurityException ... com.android.shell` | pokrenut `/system/bin/am` | koristi golo `am` |
| `Activity not started, ... brought to the front` | `singleTask` | dodaj `-f 0x10008000` |
| `unknown option '--expose-internals'` | prosleđeno kroz `NODE_OPTIONS` | mora direktno u komandnu liniju |
| sandbox greška pri startu | `workspace-write` | prebaci na `danger-full-access` (sada je i default, vidi Prepreka 2) |
| delete dugme vraća "unknown sidebar API method" | `fs.delete` izgubljen posle update-a `dsh-better-sidebar` | vrati metod u `lib/index.js` + restart (sekcija 9) |
| port 3081 zauzet | stara instanca radi | `pkill -f 'dsh/lib/bin[.]js'` |
| `required option '--profile'` | `dsh plugin add` bez profila | `dsh plugin --profile web add <pkg>` |
| `pnpm not found on PATH` | pnpm nije instaliran | `npm install -g pnpm` + `termux-fix-shebang` |
| `bad interpreter: /usr/bin/env` | npm-ov shebang | `termux-fix-shebang $PREFIX/bin/<alat>` |
| `ERR_PNPM_IGNORED_BUILDS` | pnpm blokira build skripte | `allowBuilds: {node-pty: true}` |
| plugin instaliran ali se ne vidi | nije u `dsh.profile.bundles` | dopiši ga u `package.json` profila |
| `dsh` javlja `--profile is required` | pozvan `/usr/bin/dsh`, ne bash funkcija | koristi `~/.local/bin/dsh-termux` |
