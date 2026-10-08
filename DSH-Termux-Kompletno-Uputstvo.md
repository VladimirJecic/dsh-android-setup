# DeepSeek Harness (dsh) na Termux/Android — kompletno uputstvo

**Uređaj:** Nothing A142, Android 16, aarch64, bez root-a
**Termux uid:** `u0_a335`, paket `com.termux`
**Zapisano:** 2026-08-28 · **Ažurirano:** 2026-08-29 (Prepreke 4–5, `vision` alat, tajne, Full access default, `dsh-composer-extras` file-picker/rename/delete/slash komande/mtime sort/Try again) · **Ažurirano:** 2026-09-29 (auto-update ukinut, `dsh-update.sh` — vidi sekciju **AŽURIRANJA — 2026-09-29** na kraju) · **Ažurirano:** 2026-09-29 (dugmad u file viewer-u: 📤 Podeli / 📂 Folder; multi-select + 🗑️ brisanje u pickeru — vidi **9b** i **AŽURIRANJA — 2026-09-29 / G**) · **Ažurirano:** 2026-10-06 (**0.2.0-rc.2** — `koffi` zamka, faze 4b/4c u `dsh-update.sh`; vidi **AŽURIRANJA — 2026-10-06** na kraju)
**Status:** radi — instalacija, čitanje/pisanje fajlova, Termux API pristup, čitanje slika i skladištenje API ključeva su potvrđeni na uređaju

> Ovaj dokument zamenjuje stariji `DeepSeekHarnessTermuxUputsvo.md` u istom folderu.
> Taj stariji je napisao sam dsh dok problem sa hard link-ovima **još nije bio rešen**,
> pa njegov "PART 2: The Execution Roadblock" i lista neuspelih pokušaja više ne važe.
> Rešenje je opisano ovde u delu **Prepreka 1**.

Uz ovaj fajl ide `restore.sh` (isti folder) koji izvodi sve korake automatski i
idempotentan je — bezbedno ga je pokrenuti više puta:

```bash
bash ~/storage/shared/Download/DSH-Restore-20261007/restore.sh --dry-run  # pogledaj šta bi uradio
bash ~/storage/shared/Download/DSH-Restore-20261007/restore.sh            # primeni
```

Skripta nikad ne dira `~/.dsh/.credentials.yaml` — API ključ unosiš sam kroz dsh UI.

> ⚠️ **Stari instalater `dsh-termux-install.py` (i `_fixed` varijanta) je
> OBRISAN 2026-09-29.** Bio je pisan za stanje od 2026-08-28/09-15: ugrađivao je
> launcher **bez** ispisa verzija i zvao stari `patch-android-hardlink.py`.
> Obrisane su i kopija u Markor folderu i one na deljenom storage-u — namerno,
> da ne postoji drugi, pogrešan put za instalaciju.
> **Kanonski put danas:**
>
> ```bash
> bash ~/storage/shared/Download/DSH-Restore-20261007/restore.sh   # ceo setup
> bash ~/dsh/restore-patches.sh                                   # skripte + Android zakrpe
> ```
>
> `restore-patches.sh` čita skripte iz arhive (`DSH-Restore-20261007/dsh/`) i
> ponovo primenjuje zakrpe; ne dira tajne. Update samog dsh-a je
> **isključivo ručni**: `~/dsh/dsh-update.sh`.

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

> ⚠️ Ovo je **prva** instalacija (kad dsh još ne postoji na disku). Od 2026-09-29
> je za svaki **update** zadužen `~/dsh/dsh-update.sh`: ručni `npm install -g`
> više nije preporučeni put jer preskače sandbox, kompatibilnost plugina i
> validaciju, a zakrpe se posle njega moraju ponovo primeniti. Detalji:
> **AŽURIRANJA — 2026-09-29**, sekcija C.

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

1. **Zakrpa fajlova** — `~/dsh/patch-android-dsh.py` (sekcija 1) prepravlja
   `import { link } from "node:fs/promises"` u sva tri paketa. Stari
   `patch-android-hardlink.py` je **uklonjen 2026-09-29** (naslednik pokriva i
   njega i sve ostale zakrpe).
   *Nedostatak:* `npm install -g` je pregazi.
2. **Preload backstop** — `~/dsh/no-hardlink.cjs` se učitava kroz
   `node --require`, **pre** nego što dsh bilo šta importuje, pa presretne i ESM
   import. Preživi update.

> ⚠️ **Posle svakog `npm install -g @deepseek-ai/dsh` ponovo pokreni:**
> ```bash
> python3 ~/dsh/patch-android-dsh.py
> ```
> Ako ikad opet vidiš `EACCES ... link ...` — zakrpa je izgubljena.
>
> Od 2026-09-29 update ne ide tako: `~/dsh/dsh-update.sh` sam pravi sandbox
> instalaciju, primenjuje **sve** zakrpe pre zamene i validira boot, pa zakrpe
> nikad ne ostaju neprimenjene. Ručni `npm install -g` preskače sve to — ako ga
> ipak pokreneš, posle njega obavezno `python3 ~/dsh/patch-android-dsh.py`.

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

> ⚠️ **Od 2026-09-29 to više nije dovoljno.** `@vscode/ripgrep` 1.18+ ne
> bundluje `rg` u paket, nego traži platformski paket
> `@vscode/ripgrep-android-<arch>/bin/rg` — a android build **ne postoji na
> npm-u**. Zato je potrebno i `python3 ~/dsh/patch-android-dsh.py`, koja pravi
> shim paket čiji `bin/rg` pokazuje na Termux-ov sistemski `rg`. Detalji:
> **AŽURIRANJA — 2026-09-29**, sekcija E.

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

> Napomena (2026-09-29): u ovom setup-u **cron više ne postoji** — ni zapis ni
> `crond` servis (vidi **AŽURIRANJA — 2026-09-29**, sekcija A). Pravilo iznad
> i dalje važi za svaku buduću zakazanu/`nohup` komandu.

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
| `~/dsh/dsh-composer-extras/` | lokalni plugin: spajalica + file-picker, 📤 Podeli / 📂 Folder u viewer-u, multi-select + 🗑️ brisanje (vidi **9b**) |
| `~/.local/bin/dsh-termux` | launcher; postavlja `DSH_PERMISSION_MODE=danger-full-access` (Full access default) i pri svakom startu ispisuje verzije |
| `~/dsh/dsh-update.sh` | kontrolisani **ručni** update dsh-a (10 faza, sandbox + validacija) — vidi **AŽURIRANJA — 2026-09-29** i **AŽURIRANJA — 2026-10-06** |
| `~/dsh/compat-scan.mjs` | provera da ciljna verzija dsh-a zadovoljava opsege instaliranih pluginova |
| `~/dsh/update.log` | log ručnih update-a (append, ne rotira se) |
| `~/dsh/` | posle čišćenja (2026-09-29) u njemu su samo skripte u upotrebi — penzionisani auto-update i `_disabled/` su obrisani |
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

**Od 2026-09-29:** update dsh-a ide kroz `~/dsh/dsh-update.sh`, ne kroz
`npm install -g` (vidi **AŽURIRANJA — 2026-09-29**). Skraćeno:

```bash
~/dsh/dsh-update.sh --check            # samo prijava (instalirano vs npm latest)
~/dsh/dsh-update.sh                    # sandbox -> validacija -> atomska zamena
~/dsh/dsh-update.sh --rollback         # vrati prethodnu verziju
pkill -f 'dsh/lib/bin[.]js' && dsh     # restart — novu verziju preuzima novi proces
```

Ručni `npm install -g @deepseek-ai/dsh` preskače sandbox, proveru kompatibilnosti
plugina i boot smoke test, pa zakrpe moraš ponovo primeniti:

```bash
npm install -g @deepseek-ai/dsh
python3 ~/dsh/patch-android-dsh.py     # hardlink, dir-fsync, ripgrep shim, cache-slot, flock, samesite
pkill -f 'dsh/lib/bin[.]js' && dsh
```

> ⛔ **Od 0.2.0-rc.2 taj ručni put uopšte ne prolazi.** `dsh-fs-local` pinuje
> `koffi@3.1.1`, koji nema `@koromix/koffi-android-arm64` prebuild, pa `npm
> install -g` padne na CMake/`statx` grešci **pre ijednog instaliranog paketa**.
> Jedini put je `~/dsh/dsh-update.sh` (faze 4b/4c to rešavaju) — vidi odeljak
> **AŽURIRANJA — 2026-10-06** niže u ovom uputstvu.

U praksi ni to ne treba raditi ručno — `~/.local/bin/dsh-termux` pokreće
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
  preview) plus `/clear-context` i `/restart-dsh` slash komande. Vidi dole
  "9b. `dsh-composer-extras`" za punu dokumentaciju.
- **`dsh-chat-jump-arrows`** (lokalni, `~/dsh/dsh-chat-jump-arrows`, od
  2026-10-07) — dve lebdeće strelice ▲▼ uz desnu ivicu razgovora koje šetaju
  **tvoje** poruke (dsh-ov ugrađeni rail šeta turn-ove i sakriven je na uskom
  ekranu). Vidi dole „9c. `dsh-chat-jump-arrows`".

Sva četiri su potvrđena na ekranu, ne samo u konfiguraciji.

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

### 📤 Podeli / 📂 Folder — dugmad u file viewer-u (desni sidebar)

Kad se u desnom sidebar-u otvori tab za dokument (bilo koji fajl — slika, video,
zip...), u headeru se pojavljuju dva dugmeta kroz slot
`sidebar.right.tab.document.actions` (slot-props nose `{ absolutePath }`):

- **📤 Podeli** — otvara Android share sheet (`termux-open`; `--view` za
  sliku/video, npr. VLC, `--send --chooser` za ostalo). Ruta
  `POST /composer-extras/api/android-share` (`{path, action?}`).
- **📂 Folder** — otvara **roditeljski folder** fajla u Solid Exploreru
  (`pl.solidexplorer2`) preko
  `am start -f 0x10008000 -a android.intent.action.VIEW -d file://<dir> -t resource/folder`.
  Ruta `POST /composer-extras/api/android-folder` (`{path}`).

**Zamke (dokazane na uređaju 2026-09-29):**

- **Photos traži MediaStore URI**, ne `file://`; zato `android-share` privatne
  putanje prvo **stage-uje** u deljeni storage (slike u
  `/storage/emulated/0/Pictures/dsh`, ostalo u
  `/storage/emulated/0/Download/dsh-share`), pa `termux-media-scan`, pa otvara.
- **Solid Explorer ne čita `/data/data/com.termux/...`** — privatni fajl se
  stage-uje, a privatni **folder** se odbija (`private-directory`); otvori fajl
  pa „Podeli" ili kopiraj u Download.
- `-t resource/folder` i `-f 0x10008000` su **obavezni**; bez njih se ili ne
  nađe primalac ili se podigne stara Solid instanca na pogrešnom folderu.
- `handleAndroidFolder` je pucao sa `dirname is not defined` (nedostajao import)
  → popravljeno na `path.dirname(target)`.

### Multi-select + 🗑️ brisanje u file-pickeru

- **☑️** ulazi u select mode; redovi dobiju **⬜** (nije označen) / **✅**
  (označen). Tap na red u select modu markira/skida oznaku.
- **✅** = označi sve u folderu, **⬜** = očisti selekciju, **✖️** = izađi iz
  selekcije.
- **🗑️ N** = prvi tap **armira** (dugme pocrveni i piše „Potvrdi (N)"), drugi tap
  briše. Brisanje je **trajno** (nema recycle bin-a).
- U select modu se kriju write akcije (Galerija / Sa telefona / Novi folder);
  ostaju selekcija, trash i izlaz.
- Server: `POST /composer-extras/api/delete-paths` (`{paths:[...],
  confirm:true}`). Bez `confirm:true` → `400 confirm-required`. Radi `lstat`
  (ne prati symlink), **neprazan folder odbija**, vraća rezultat po putanji.
- Na svakom redu i dalje postoje ✏️ (rename), 🗑️ (pojedinačno brisanje) i —
  novina — **📤 / 📂** za taj fajl.

### "Unrestricted" mod — browse van workspace-a

Klik na ".." dok si već u korenu workspace-a prebacuje picker u unrestricted
mod (oznaka "🔓 van workspace-a" u modalu) — dalje penjanje ide preko cele
particije, preko `/composer-extras/api/fs-tree-unrestricted`, namerno BEZ
`dsh-better-sidebar`-ove `assertWithinWorkspace` provere. Ovo je eksplicitno
odobreno (korisnik je svesno tražio da picker može da čita van workspace-a);
sve write akcije (upload/mkdir/rename/delete) ostaju workspace-scoped i
sakrivaju se u ovom modu — samo čitanje je prošireno, ne i pisanje.

### `/clear-context` i `/restart-dsh` slash komande

Vide se u composer-ovom "+" meniju.

- **`/clear-context`** — zove `ctx.compaction.compactNow()` (isti seam kao
  ugrađeni `/compact`). **Nije pravo brisanje na nulu** — dsh nema izloženi API
  za to u ovoj verziji; ovo istoriju sažme na minimum preko LLM sumarizacije.
  Radi samo ako je `compaction-basic` uključen u profilu (u ovom setup-u jeste,
  preko `cordis.patch.yml` patch-a — dsh-web-app bundle ga po defaultu
  isključuje).
- **`/restart-dsh`** — **JEDINA komanda za restart** (ujedinjeno 2026-10-07).
  Ime je isto kao kod istoimenog skill-a, a implementacija je jedna jedina:
  skript `~/.dsh/skills/restart-dsh/restart-dsh.sh`. Plugin je samo detaširano
  pozove sa `--delay 2 --quiet`; skript ubije stari proces (`pkill`, pa `-9`
  ako se ne preda u ~3 s), sačeka da se port 3081 oslobodi i podigne
  `~/.local/bin/dsh-termux` (koji pri svakom bootu ponovo primenjuje Android
  zakrpe), pa verifikuje HTTP i upiše `~/dsh/restart-dsh.log`.
  **Ranije su postojale DVE komande** — `/restart` iz plugina i skill
  `restart-dsh` — sa odvojenom logikom; to je izbačeno. Skill nosi
  `user-invocable: false` da se isti naziv ne pojavi dvaput u meniju (jednom
  pod „Skills", jednom pod „Commands"); agent ga i dalje vidi i poziva kad
  korisnik kaže „restartuj dsh".

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

Četvrto dugme, desno od Proceed-a. Cilj: iskoristi Gemini Flash-Lite dokle god
ide, a kad ga rate-limit stigne, sam se prebaci na DeepSeek Flash i vrati kad
prođe.

**KADA se pali SAM (pravilo od 2026-10-07):**

| Sesija | Smart |
|---|---|
| Prazna nova sesija (dugme „+", `SessionSummary.blank === true`) | **DA** — podrazumevano uključen |
| Postojeći razgovor sa istorijom | NE — samo ako ga `branch-into-new-session` označi kao smart start, ili korisnik klikne 😎 |
| Sesija koju je branch ruta označila kao smart (`…-on-<id>`) | DA |
| Bilo koja sesija sa eksplicitnim 😎 „off" klikom (`…-off-<id>`) | NE — klik pobeđuje sve |

Prva verzija fix-a od 2026-10-07 ugasila je automatsko paljenje **svuda** (zbog
žalbe „sam se uključio Smart mode kada sam se prebacio na razgovor"), pa je i
obična nova prazna sesija ostajala bez smart-a; korisnik je to eksplicitno
odbio („obična nova prazna sesija treba da bude na smart"). Sada je prazna
sesija ponovo smart, a **postojeći** razgovori nisu.

Stari globalni `localStorage` ključ `composer-extras-gemini-seek-default-enabled`
se NAMERNO više ne čita — da ranije upisano `true` ne bi ponovo palilo smart
svuda. Stanje je per-session: `composer-extras-gemini-seek-on-<id>` i
`composer-extras-gemini-seek-off-<id>`.

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
bash ~/.dsh/skills/restart-dsh/restart-dsh.sh   # JEDINA komanda za restart
grep -i "composer-extras\|ModuleLoader\|Failed to load" ~/dsh/dsh-web.log
```

Skript sam ubije stari proces, podigne wrapper i verifikuje HTTP
(200/301/302/401/403 = živo; 000 = palo). Ručni `pkill` + `nohup` **ne
koristi** — to je stara, duplirana logika (vidi 9b). Hard-refresh browser-a
posle (da dohvati novi `client.js` — dsh ne hot-reload-uje plugin bundlove).

## 9c. `dsh-chat-jump-arrows` — ▲▼ kroz moje poruke

**Problem:** na telefonu jedan odgovor agenta ume da bude hiljade piksela
„procesa", a tvoje pitanje ostane visoko iznad ekrana. dsh-ov ugrađeni
`TurnNavigator` šeta **turn-ove** (ne pitanja) i njegov CSS ga sakriva na uskim
ekranima (`@container (width<=900px){display:none}`), a ugrađeno „to bottom"
dugme je samo jednosmerno.

**Rešenje:** lokalni plugin sa dva lebdeća chevrona uz **desnu ivicu razgovora**
(ne ekrana), po sredini visine:

| Element | Šta radi |
|---|---|
| **▲** | prethodna **moja** poruka (`user`, i `steering` = poslato dok agent radi). Sleće 12px pod vrh. |
| **▼** | sledeća moja poruka; sa poslednje pada na **dno** razgovora (time se i dsh-ov follow-tail sam ponovo uključi). |
| **`n/m`** | badge između strelica — koja sam od koliko svojih poruka. `0/3` = iznad svih. |

Detalji koji se ne smeju pogaziti:

- **Seat je `shell.overlay`** — zvanični „frame-wide floating" sloj iz
  `dsh-client-ui-layout` (`kind: list`, `scope: root`, `pointer-events: none`
  uz `> * { pointer-events: auto }`). **Ništa u chatu se ne patchuje**, pa
  `npm install -g @deepseek-ai/dsh@latest` ne može da ga obriše.
- Čita **samo DOM atribute koje je dsh proglasio stabilnim**:
  `[data-conversation-scroll]` (pravi `overflow-y: auto` scrollport) i
  `[data-chat-flow-kind="user"|"steering"]` na najspoljašnjem `.flowItem`.
- **Dok je otvoren picker / dijalog / meni, strelica nema.** Sloj strelica je
  iznad composera, pa `z-index: 10000` pickera ne pomaže — strelice bi lebdele
  preko njega i kradle dodire (🗑️ se teško klikne, a prevlačenje preko kartice
  skroluje transkript iza nje). Zato se plugin sklanja kad u dokumentu postoji
  `[role="dialog"][aria-modal="true"]`, `[role="menu"]` ili
  **`[data-dsh-overlay-surface]`** — oznaka koju picker iz 9b nosi. **Nova
  overlay površina mora da nosi tu oznaku** (ili `role="dialog"` +
  `aria-modal="true"`).

Primena / provera posle izmene:

```bash
node -c ~/dsh/dsh-chat-jump-arrows/client.js
node ~/dsh/tests/test-chat-jump-arrows.mjs      # 53 provere, offline
# klijentski bundle (samo client.js) → dovoljan je HARD REFRESH taba;
# restart treba samo ako se menja package.json/index.js/cordis.patch.yml
bash ~/.dsh/skills/restart-dsh/restart-dsh.sh
```

Puna dokumentacija: `UPUTSTVO-strelice.md`; pravila: `rules/06-pluginovi.md`.

## 10. Brza tabela problema

| Simptom | Uzrok | Rešenje |
|---|---|---|
| `EACCES ... link ...` | SELinux blokira hard link | `python3 ~/dsh/patch-android-dsh.py` |
| `EACCES ... open '/data/data'` | attachment store fsync-uje pretke do `/` | `python3 ~/dsh/patch-android-dsh.py` (Prepreka 4) |
| `ripgrep launch failed` / glob ne kreće | `@vscode/ripgrep` 1.18+ traži `@vscode/ripgrep-android-<arch>/bin/rg`, a android build ne postoji na npm-u | `pkg install ripgrep` **+** `python3 ~/dsh/patch-android-dsh.py` (pravi shim paket — Prepreka 5 i sekcija E) |
| dva dsh procesa nad istom sesijom se ne isključuju | `flock(2)` je mock (`node-addon-system` nema android-arm64) | ne pokreći dva dsh-a nad istom sesijom; stanje: `python3 ~/dsh/patch-android-dsh.py --check` |
| `fatal uncaught exception: host preparation failed: No usable native binding found for node-addon-require-builtin-android-arm64 (auto)` | nema android-arm64 prebuild; glibc `.node` se na Bionicu ne učitava (`libgcc_s.so.1`) | `python3 ~/dsh/patch-android-dsh.py` (zakrpa **3e** — sekcija E) |
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
| strelice ▲▼ se ne vide posle izmene | klijentski bundle se ne čita ponovo | **hard refresh** taba (restart treba samo za `package.json`/`index.js`) |
| strelice ▲▼ nema dok je picker otvoren | namerno — sloj strelica je iznad composera | ništa; sklone se da picker prima dodire (9c) |

---
---

# AŽURIRANJA — 2026-09-15 (dsh 0.1.5-rc.1)

Sve ispod je **potvrđeno merenjem na uređaju**, ne pretpostavkama. Zamenjuje
odgovarajuće delove gore gde se razlikuju.

## A. Verzije su se pomerile

| Komponenta | Bilo u dokumentu | Sada |
|---|---|---|
| `@deepseek-ai/dsh` | 0.1.1-rc.2 | **0.1.5-rc.1** |
| Node.js | v24.18.0 | **v26.4.0** |
| Python | — | 3.14.6 |
| `dsh-context` | 0.34.0 | **0.52.0** |

Uputstvo je pisano za 0.1.1-rc.2 i **deo zakrpa u međuvremenu nije bio
primenjen** — ono što sledi to rešava trajno.

## B. `patch-android-dsh.py` — sada postoji i pokriva SVE

Uputstvo ga je pominjalo, ali fajl **nije postojao** (postojao je samo stari
`patch-android-hardlink.py`, i to sa **pogrešnom putanjom**:
`~/.dsh/profiles/web/node_modules/@deepseek-ai` — prava je
`$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`).

| # | Zakrpa | Stanje pre 2026-09-15 |
|---|---|---|
| 1 | hardlink (`link` → `copyFile`, 3 paketa) | ❌ nije primenjeno, spašavao samo `no-hardlink.cjs` |
| 2 | dir-fsync (EACCES na `/`, `/data`, `/data/data`) | ❌ nije primenjeno → `read_image`/attachment ranjiv |
| 3 | ripgrep (sistemski `rg`) | ✅ |
| 4 | migracija tajni | ✅ (uz ključnu zaštitu, vidi D) |
| 5 | `--pwa-samesite` (vidi C) | ❌ novo |

```bash
python3 ~/dsh/patch-android-dsh.py --check          # dijagnostika
python3 ~/dsh/patch-android-dsh.py --pwa-samesite   # primeni
```

Launcher ga zove pri **svakom** startu sa `--pwa-samesite`, pa `npm install -g`
ne može trajno da ga obriše.

## C. NOVA PREPREKA 6 — PWA („DSH 手机版") traži autentikaciju

**Simptom:** u Chrome-u radi, aplikacija prikazuje
`dsh web authentication required; reopen the URL printed by dsh web`.

**Kako auth radi (iz `dsh-client-connection`):**

| Deo | Gde živi | Traje |
|---|---|---|
| launch token | `randomBytes()`, **samo u memoriji procesa** | jedan proces |
| cookie | HMAC-potpisan, ime vezano za `authority` | **30 dana** |
| signing secret | `~/.dsh/.credentials.yaml` → record `client-connection/browser-session` | **trajno** |

**Uzrok:** cookie je bio `HttpOnly; SameSite=Strict`. Kada WebAPK pokrene Android
lansir, to je za Chrome cross-site navigacija — a `Strict` cookie se tada **ne
šalje**, pa aplikacija dobija 401 bez obzira što cookie postoji.

**Rešenje:** `SameSite=Strict` → `Lax` (`patch-android-dsh.py --pwa-samesite`).
Cookie se tada šalje pri top-level navigaciji, pa i pri pokretanju iz lansera.

**Dodatno:** ako se `~/.dsh` recreate-uje (nova instalacija), nastaje **novi
signing secret** i svi stari cookie-ji su nevažeći → aplikaciju treba ponovo
autentikovati. Pomaže i **reinstalacija WebAPK-a** (dobjje svež cookie iz
Chrome-ovog jar-a).

**Token se ne može pročitati iz fajla** (samo iz stdout-a procesa). Zato:
`~/dsh/dsh-url.sh` — restartuje, ispiše URL i **sam ga pošalje u aplikaciju**
preko `am start` (overlay dozvola za `com.termux` je potrebna).

## D. Tajne — `.credentials.yaml` se NE SMIJE tek tako isprazniti

Uputstvo (5c) kaže „`.credentials.yaml` namerno prazan". To je **polovično tačno**:
fajl mora da sadrži `version` + record **`client-connection/browser-session`**.

⚠️ Ako migracija tajni pregazi taj record, **rotira se signing secret i PWA
trajno pukne**. `patch-android-dsh.py` zato odbija da dira fajl ako record nije
tu. Ključevi žive u `~/.config/dsh-secrets.env` (mode 600), a `credentials-local`
daje **env prioritet** nad fajlom.

## E. `dsh-composer-extras` — tri prava buga

### E1. Zavisnost od `dsh-better-sidebar` (picker mrtav)

`client.js` je za prvi korak pickera zvao `sidebarApi("session.cwd", …)` →
`/sidebar/api/session.cwd`. Taj namespace pripada **`dsh-better-sidebar`-u koji
nije instaliran** (fixed installer ga izbacuje zbog React #130) → promise se
odbije i picker ne učita ništa.

**Fix:** plugin sada ima **svoju** rutu `/composer-extras/api/session-cwd`
(`handleSessionCwd`, isti loopback fence + `{ok,value}` envelope). Server je cwd
ionako umeo sam (`sessionCwdOf` → `session.header.cwd`).

### E2. `props.session` ne postoji — dugmad tiho mrtva ⭐

**Ovo je bio pravi uzrok „dugmad se vide ali klik ne radi".**

Slot `conversation.input.left` **ne prosleđuje `session`** kao običan prop —
prosleđuje **`sessionId`** direktno. Kod je čitao `props.session.sessionId` →
`undefined` → svaki handler oblika `if (sessionId !== undefined) …` je **tiho ne
radio ništa**.

Dokaz (instrumentacija, vidi E3):
```
propKeys: [...,"sessionId","inputActions","useSession",...]   <- ima sessionId, NEMA session
pre fixa:   sessionId=null
posle fixa: sessionId=POPUNJEN
```

**Fix (4 mesta u `client.js`):**
```js
var sessionId = props.sessionId !== undefined && props.sessionId !== null
    ? props.sessionId
    : (session ? session.sessionId : undefined);
```

### E3. Dijagnostika — `/composer-extras/api/diag`

Android Chrome **nema devtools**, pa je klijent instrumentiran: svaki klik na
dugme šalje `{where, propKeys, hasSession, sessionId}` na tu rutu, a server to
dopisuje u `~/dsh/composer-diag.log`. Tako se „handler nije ni pokrenuo" razlikuje
od „zahtev je pao" bez browsera.

## F. Hot reload — šta radi, a šta ne

Profil ima `patchReload: "live"`, ali to **nije univerzalno**:

| Izmena u `cordis.patch.yml` | Efekat |
|---|---|
| **config override postojećeg čvora** (npr. `llm-pi-ai`) | ✅ primenjuje se **bez restarta** |
| **`insert` novog čvora** (npr. `composer-extras`) | ❌ **ne** primenjuje se (dokazano: ruta ostala 404 punih 24 s) |

Zato: nova plugina traže **restart**, a konfiguracija postojećih se menja u letu.

## G. Modeli — Gemini + DeepSeek, sve ostalo izbačeno

`~/.dsh/profiles/web/cordis.patch.yml` sužava pi-ai katalog (`models:` zadržava
samo navedene `id`-ove):

```yaml
- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GOOGLE_API_KEY
        models:
          - id: gemini-flash-latest
          - id: gemini-flash-lite-latest   # 😎 gemini-seek-smart, MORA ostati
      deepseek-official:
        models:
          - id: deepseek-flash   # = "DeepSeek-V41-Flash" (v4.1) — prima i slike
```

⚠️ **`deepseek-flash` je DeepSeek v4.1** i koristi se za sve: i kao
`agent-default-model` u `settings.yaml` i kao meta 😎 gemini-seek-smart smene
(`GEMINI_SEEK_SCHEDULE` u `client.js`).

⚠️ **Ne vraćati** `deepseek-v4-flash` (to je **v4**, tekstualni) ni
`deepseek-v4-flash-vision-exp` (zastareli experimental). Oba su izbačena.
Razlika je zbunjujuća, pa je proveri pre svake izmene:

| id | ime u katalogu | ulaz |
|---|---|---|
| `deepseek-flash` | **DeepSeek-V41-Flash** | text + **image** |
| `deepseek-v4-flash` | DeepSeek-V4-Flash | text |
| `deepseek-v4-flash-vision-exp` | DeepSeek-V4-Flash-Vision-Exp | text + image |

Sva tri se mogu proveriti jednom komandom:
```bash
for m in deepseek-flash deepseek-v4-flash deepseek-v4-flash-vision-exp; do
  curl -s "http://127.0.0.1:3081/composer-extras/api/debug-provider-check?provider=deepseek-official&model=$m"; echo
done
```

Održava: `~/dsh/gemini-catalog-update.py` (idempotentan, launcher ga zove pri
startu; ne prepisuje fajl ako u njemu ima tuđih izmena).

## H. `dsh-context` — instaliran

`dsh plugin --profile web add dsh-context` (0.52.0), sam se upisao u
`dsh.profile.bundles`. Daje tab `Context` i `/context`.
`dsh-better-sidebar` **ostaje izbačen** (React #130).

## I. Brza tabela (dopuna sekcije 10)

| Simptom | Uzrok | Rešenje |
|---|---|---|
| PWA traži autentikaciju | `SameSite=Strict` | `python3 ~/dsh/patch-android-dsh.py --pwa-samesite` + restart + hard refresh |
| dugmad composer-a ne reaguju | `props.session` umesto `props.sessionId` | već rešeno; hard refresh |
| picker se ne otvara | `/sidebar/api` bez sidebara | već rešeno (sopstvena `session-cwd` ruta) |
| Gemini nema u pickeru | prazan `providers` | `python3 ~/dsh/gemini-catalog-update.py` |
| `read_image` puca | dir-fsync na `/data/data` | `python3 ~/dsh/patch-android-dsh.py` |
| posle restarta stara UI | klijentski bundle se ne hot-reload-uje | **hard refresh** |
| `pm clear` ne radi | nema `CLEAR_APP_USER_DATA` | ručno: Settings → Apps → DSH 手机版 → Storage |

## J. Sekcija 5b (vision alat / „Pro model ne vidi") je ZASTARELA

Originalna sekcija **5b** polazi od toga da je podrazumevani model
`deepseek-v4-pro`, da je **tekstualni**, i da slike moraju da se delegiraju
posebnom `vision` alatu (subagent zakucan na `deepseek-v4-flash-vision-exp`).

**To više ne važi.** Podrazumevani model je sada **`deepseek-flash`
(DeepSeek v4.1)** i on **prima slike direktno**:

```
deepseek-flash       ->  DeepSeek-V41-Flash  |  inputModalities: ['text', 'image']
gemini-flash-latest  ->  Gemini Flash Latest |  inputModalities: ['text', 'image']
```

`gemini-flash-lite-latest` **ne sme da se izbaci** — 😎 gemini-seek-smart je
tako definisan (`GEMINI_SEEK_SCHEDULE` u `client.js`); bez njega smena puca.

Praktične posledice:

- **`read_image` radi sa podrazumevanim modelom** — nema potrebe za `vision`
  alatom ni za redom `tool-subagent-vision` u `cordis.patch.yml`.
- Ako negde (u `AGENTS.md`, skill-u ili navici) piše „nikad ne zvati
  `read_image` direktno sa Pro-a" — **taj savet je prevaziđen**.
- `vision` alata u ovom setup-u **nema** (nije nikad ni dodat), i ne treba ga
  dodavati.
- **`deepseek-v4-pro` je izbačen iz kataloga** — zvanično je slabiji od
  najnovijeg modela. Isto važi za `deepseek-v4-flash` (v4) i
  `deepseek-v4-flash-vision-exp`.

⚠️ Napomena o proveri: `debug-provider-check` ume da resolvuje i modele koji
**nisu** u konfigurisanom spisku (rezolver čita ceo pi-ai katalog). Merodavan je
**picker u UI-ju**, koji prikazuje samo `models:` iz `cordis.patch.yml`.

---
---

# AŽURIRANJA — 2026-09-29 (kontrolisano ručno ažuriranje)

Sve ispod je provereno **čitanjem fajlova na uređaju** 2026-09-29. Zamenjuje
svako pominjanje automatskog/dnevnog update-a u gornjem tekstu.

## A. Auto-update je ukinut

Auto-update **više ne postoji u nijednom obliku**. Uklonjeno je, jedan po jedan:

| Šta je uklonjeno | Gde je sada | Kako se proverava |
|---|---|---|
| `~/dsh/dsh-auto-update.sh` | **obrisan** (2026-09-29); sačuvan samo u istoriji ove sesije | `ls ~/dsh/dsh-auto-update.sh` → „No such file" |
| cron zapis (dnevna provera) | nema ga — crontab je prazan | `crontab -l` → prazno / „no crontab for …" |
| `crond` runsv servis | **isključen i obrisan** iz `$PREFIX/var/service/` (dir uklonjen) | `pgrep -a crond` → ništa; `ls $PREFIX/var/service/` → samo `sshd`, `ssh-agent` |
| „>24h fallback" blok u launcheru | uklonjen iz `~/.local/bin/dsh-termux` | u launcheru nema poziva update skripte, samo ispis verzija |
| stamp fajl `~/.dsh/.last-update-check` | ne postoji | `ls ~/.dsh/.last-update-check` → „No such file" |

Sve staro je **obrisano** (2026-09-29) — nema „prikolica":

- `~/dsh/auto-update.log`, `~/dsh/cron-trigger.log`, `~/dsh/_disabled/` i
  `~/dsh/patch-android-hardlink.py`, `patch-cache-slot.py`, `dsh-cache-stats.py`,
  `flock_shim.c/.so` — obrisani.
- labave kopije na deljenom storage-u (stara skripta, `dsh-termux`,
  `dsh-termux.txt`, `dsh-update.sh`, `compat-scan.mjs`) — obrisane;
  **jedini izvor istine je arhiva `DSH-Restore-20261007`**.
- stari instalateri `dsh-termux-install.py` i `dsh-termux-install_fixed.py`
  (i kopija u Markor folderu) — obrisani; kanonski put je `restore.sh` iz
  arhive, odn. `~/dsh/restore-patches.sh` za skripte + zakrpe.

**Update se od sada radi isključivo ručno, na izričit zahtev korisnika.**

## B. Verzije pri pokretanju

`~/.local/bin/dsh-termux` pri **svakom** pokretanju ispiše (informativno, bez
ikakve akcije i bez instaliranja):

```
dsh: verzija — instalirano=<verzija> npm-latest=<verzija>
dsh: novija verzija je dostupna; update je ISKLJUCIVO RUCNI -> ~/dsh/dsh-update.sh
```

| Detalj | Vrednost |
|---|---|
| instalirano | `node -p "require('<global-root>/dsh/package.json').version"` |
| npm latest | `timeout 12 npm view @deepseek-ai/dsh version \| tail -1` |
| druga linija | samo ako se `instalirano` i `npm-latest` razlikuju |
| passthrough (`dsh <args>`) | ispis ide na **stderr** da ne zaprlja stdout podkomandi |
| offline registry | `timeout 12` — boot se ne odlaže |

Trenutno stanje na uređaju (pročitano iz `package.json` globalne instalacije):
**`0.2.0-rc.2`** (od 2026-10-06; pre toga `0.1.7-rc.2`). `npm-latest` se ne
fiksira u dokumentu — to je mrežna vrednost koja se menja, a ispisuje je
launcher sam.

## C. `dsh-update.sh` — 10 faza

```bash
~/dsh/dsh-update.sh --check              # samo prijava (nista se ne skida)
~/dsh/dsh-update.sh                      # update na npm latest
~/dsh/dsh-update.sh --version 0.2.0-rc.2 # update/pin na tacno tu verziju
~/dsh/dsh-update.sh --no-swap            # sve do validacije, bez diranja instalacije
~/dsh/dsh-update.sh --rollback           # vrati poslednji backup
~/dsh/dsh-update.sh --force              # nastavi i kad plugin opsezi ne dozvoljavaju
```

| # | Faza | Šta radi |
|---|---|---|
| 1 | lock | `~/.dsh/.dsh-update-lock` (PID + stale detekcija); drugi update ne može uporedo |
| 2 | verzije | instalirano vs npm latest, ili `--version X` |
| 3 | kompatibilnost | `~/dsh/compat-scan.mjs` nad `~/.dsh/profiles` — `KRSI`/`NEPOZNATO` prekidaju update osim uz `--force` |
| 4 | sandbox | `npm install --global --prefix <sandbox> --ignore-scripts @deepseek-ai/dsh@<verzija>` — **nikad** u pravi globalni root; `--global` drži sve zavisnosti **ugnježdene** u `dsh/node_modules` (kao živa instalacija), a `--ignore-scripts` je tu zbog faze 4b. `--prefer-online` (ne `--prefer-offline`): bajat keš ume da prijavi **lažni `ETARGET`** za pakete koji na npm-u postoje |
| **4b** | **koffi** | ako `dsh/node_modules/koffi` nema `@koromix/koffi-android-arm64/android_arm64/koffi.node`, koffi se zamenjuje verzijom koja **ima** android prebuild (default `3.3.2`, `DSH_UPDATE_KOFFI_VERSION`). Bez toga `cnoke` prevodi iz izvora i na Bionicu puca (`base.cc:2967`, `statx`), pa **ceo `npm install` pada pre ijednog paketa** |
| **4c** | **npm rebuild** | `npm rebuild --global --prefix <sandbox>` — pokreće install/postinstall skripte nad **već razrešenim** drvetom (faza 4 ih je preskočila): `node-pty` node-gyp build (`pty.node`), `dsh-subprocess-local` spawn-helper, `protobufjs`. Bez ovoga terminal alati pucaju u radu |
| 5 | zakrpe | `python3 ~/dsh/patch-android-dsh.py --root <sandbox-dsh> --pwa-samesite` — **hardlink**, **dir-fsync**, **ripgrep shim**, **cache-slot**, **flock mock**, **require-builtin js-fallback**, **tool_use redosled**, **PWA SameSite** (sve osim 4–4c radi i u sandboxu) |
| 6 | validacija | version match, `npm ls`, `no-hardlink.cjs` (`fs.linkSync` mora biti `copyFileSync`), flock mock import, ripgrep shim (`rg --version`), **native moduli** (`require("koffi")` i `require("node-pty")` — paket koji ne postoji se preskače), boot smoke test nove instalacije na izolovanom `DSH_HOME` i slobodnom portu **3089–3092** (heap 2048, `--no-open`); boot se prihvata na HTTP 200/301/302/401/403 |
| 7 | atomska zamena | `mv` stare instalacije u `<global-root>/.dsh-backup-<verzija>-<timestamp>`, pa `mv` sandboxa na njeno mesto (isti filesystem); posle provere verzije stariji backupi se brišu, poslednji ostaje |
| 8 | čišćenje | sandbox se briše |

**Bilo koja greška pre faze 7 ostavlja staru instalaciju NETAKNUTU**, briše
sandbox i ispisuje izveštaj. Log: `~/dsh/update.log` (append, ne rotira se).

> ℹ️ **Boot smoke test iz faze 6 nije formalnost — on je upravo otkrio regresiju
> sa `node-addon-require-builtin`.** Sveža instalacija **istog** izdanja se
> dizala sa tom greškom (fatalan izlazak za ~2s), pa bi update bez validacije
> „uspeo", a dsh se posle restarta **ne bi digao**. Zato se HTTP
> 200/301/302/401/403 (401 = bez kolačića) broji kao uspeh, a smrt procesa u
> prvih par sekundi kao neuspeh — i update se odbija.

Sandbox lokacija: prvo `/tmp/dsh-update-sandbox` ako je u taj direktorijum
dozvoljeno pisanje — na Termuxu `/tmp` obično **nije** naš (mode 0731), pa se
koristi `${TMPDIR}/dsh-update-sandbox` (fallback `~/.dsh/tmp/...`).

Ostali flagovi: `--global-root DIR` (test zamene nad drugim root-om),
`--sandbox DIR` (eksplicitna lokacija sandboxa).

## D. Atomska zamena i rollback

Zamena je `mv` na **istom filesystemu**, pa je atomična: stara instalacija ide u
`<global-root>/.dsh-backup-<verzija>-<timestamp>`, sandbox na njeno mesto.
Pointer na poslednji backup je `<global-root>/.dsh-backup-latest` — `--rollback`
čita baš njega, pa uvek gleda isti root koji je update i menjao.

| Situacija | Ponašanje |
|---|---|
| dsh trenutno radi | rename je bezbedan (otvoreni inode ostaje), proces se **ne** prekida |
| nova verzija se aktivira | tek posle **restarta** dsh-a — živi proces drži staru |
| profil u `~/.dsh/profiles` | `node_modules/@deepseek-ai/*` su symlinkovi na globalni paket, pa zamenu prate sami |
| `--no-swap` | sve faze do validacije prođu, živa instalacija **nije** dirana |
| stariji backupi | brišu se posle uspešne provere verzije; **poslednji ostaje** |
| `--rollback` | trenutna verzija se sklanja u `.dsh-rolledback-<verzija>-<timestamp>`, backup se vraća, pointer se briše (sklonjenu verziju obriši ručno) |

## E. Zakrpe (dodat flock, ripgrep shim i require-builtin fallback)

`~/dsh/patch-android-dsh.py` je i dalje idempotentan i launcher ga zove pri
**svakom** startu. Sada ima i `--root` (sandbox režim) i više zakrpa:

| # | Zakrpa | Šta rešava |
|---|---|---|
| 1 | hardlink | SELinux `link(2)` → `copyFile` `COPYFILE_EXCL`; 3 paketa (`dsh-fs-local`, `dsh-attachment-local`, `dsh-session-persistence-jsonl`) |
| 2 | dir-fsync | `EACCES` na `/`, `/data`, `/data/data` → best-effort |
| 3 | ripgrep shim | vidi dole |
| 3b | cache-slot | DeepSeek prefix-keš preko smene modela |
| 3c | flock mock | vidi dole |
| **3e** | **require-builtin JS fallback** | vidi dole — bez njega dsh **fatalno pada pri bootu** |
| **3f** | **tool_use redosled** | Gemini/pi-ai ruta upiše `tool_use` pa prazan tekst, a DeepSeek servira `tool_use` samo dok su ti blokovi **poslednji** u assistant poruci → `HTTP 400 tool_use ids were found without tool_result`; zakrpa menja redosled (`dsh-llm`, `dsh-llm-deepseek`) |
| 3d | PWA SameSite | opt-in `--pwa-samesite` (`Strict` → `Lax`) |
| — | 4–4c | tajne, profil `bundles` i link lokalnog plugina — **samo na živoj instalaciji**; sa `--root` se preskaču |

**3 — ripgrep (promenjeno pravilo).** `@vscode/ripgrep` 1.18+ traži platformski
paket `@vscode/ripgrep-android-<arch>/bin/rg`, a **android build ne postoji na
npm-u**. Zato `pkg install ripgrep` **više nije dovoljno** — zakrpa pravi shim
paket čiji `bin/rg` pokazuje na Termux-ov sistemski `rg`. Bez zakrpe `glob`/`grep`
padaju sa „ripgrep launch failed":

```bash
pkg install ripgrep                        # sistemski rg mora postojati
python3 ~/dsh/patch-android-dsh.py         # + shim paket (bez ovoga ne radi)
```

**3c — flock mock.** `@deepseek-ai/node-addon-system` nema
`android-arm64` paket, pa se `node-addon-system/lib/flock.js` zamenjuje mock-om
koji `tryLockExclusive` vraća uspeh; original se čuva kao `flock.js.orig-npm`.

> ⚠️ **Posledica koju treba znati:** POSIX `flock(2)` nad `session.lock` **nije
> stvarno zaključan**. Zato se **ne smeju pokretati dva dsh procesa nad istom
> sesijom** — drugi neće biti odbijen i sesija može da se pokvari.

**3e — `require-builtin` JS fallback (nova, 2026-09-29).** Paket
`node-addon-require-builtin` (`$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/node-addon-require-builtin/lib/index.js`)
traži native binding `node-addon-require-builtin-android-arm64`, a **npm ga ne
isporučuje** — `optionalDependencies` pokrivaju samo darwin/linux/win32. U živoj
instalaciji su
u `build/napi/napi-v9-android-arm64/` i `build/nodeabi/node-v147-android-arm64/`
stajale kopije **glibc** prebuilta (`require_builtin.node`, identične
linux-arm64-gnu prebuiltu, md5 `bf98de54e89b17ec2a77153dc00e38c2` — provereno),
ali se takav fajl na **Bionicu** ne može učitati:

```
dlopen failed: cannot find "libgcc_s.so.1" from verneed[0] in DT_NEEDED list
```

Zato je `dsh-app-boot` padao **fatalno, pre nego što se ijedan profil učita**:

```
dsh: fatal uncaught exception: Error: dsh: host preparation failed:
No usable native binding found for node-addon-require-builtin-android-arm64 (auto)
```

Zakrpa zamenjuje `node-addon-require-builtin/lib/index.js` direktnim JS
fallback-om (`requireBuiltin(moduleId)` → `require(moduleId)`,
`isAllowedInternalId()` → `true`, `getBindingInfo()` →
`{ backend: 'js-fallback', abi: 'napi-v9' }`); original se čuva kao
`index.js.orig-npm` — osim na ovoj instalaciji, gde je fajl prvo ručno izmenjen
(2026-09-29 14:59), pa je 3e zatekao već zakrpljen `index.js` i backup **nije**
napravljen. Verifikovano na uređaju:

```bash
node -e "console.log(require('node-addon-require-builtin').getBindingInfo())"
# {"backend":"js-fallback","abi":"napi-v9"}
```

> ℹ️ One glibc `.node` kopije u `build/` direktorijumima su **mrtve** — ne
> učitavaju se i ne treba ih dirati (mogu da ostanu). Prava zakrpa je JS fallback
> iz 3e.

Ručna provera svih zakrpa (i u sandboxu i na živoj instalaciji):

```bash
python3 ~/dsh/patch-android-dsh.py --check
python3 ~/dsh/patch-android-dsh.py --root <sandbox-dsh> --check   # sandbox rezim
grep -c require-builtin ~/dsh/patch-android-dsh.py                # 3e prisutan? (> 0)
```

> ⚠️ `grep -c require-builtin` mora dati `> 0`. Starije kopije patchera
> (pre 2026-09-29 19:33) **nemaju 3e** — ako se takva kopija vrati preko
> `restore.sh` / `restore-patches.sh`, svež `npm install` može da padne fatalno
> pri bootu.

## F. Kompatibilnost plugina i `--force`

`~/dsh/compat-scan.mjs` skenira `~/.dsh/profiles` (do dubine 6, preskače sam dsh
paket i pnpm `store/`) i traži **pluginske opsege prema `@deepseek-ai/dsh*`** —
dakle `dependencies`/`peerDependencies` koje počinju sa `@deepseek-ai/dsh`.

| Verdikt | Značenje | Posledica |
|---|---|---|
| `OK` | ciljna verzija zadovoljava opseg | update ide dalje |
| `KRSI` | opseg **nije** zadovoljen | update se prekida (osim `--force`) |
| `NEPOZNATO` | semver nije dostupan ili opseg ne može da se razreši | isto kao `KRSI` |
| `NEMA` | nijedan plugin ne traži `@deepseek-ai/dsh*` | nema ograničenja |

Ključna zamka: `@deepseek-ai/dsh` je **0.x**, a caret na 0.x je uzak —
`^0.1.0-rc.x` **ne dozvoljava 0.2.x**. Skok na novu minor verziju je zato tihi
prekid rada plugina, ne sintaksna greška. Skener poređenje radi sa
`includePrerelease: true`, jer bi bez toga i sam `0.1.7-rc.2` bio lažno prijavljen
kao `KRSI` za `^0.1.0-rc.1`.

```bash
node ~/dsh/compat-scan.mjs <ciljna-verzija> ~/.dsh/profiles
# exit 0 = svi OK (ili NEMA); exit 1 = ima KRSI/NEPOZNATO
~/dsh/dsh-update.sh --check          # isto, plus instalirano vs npm latest
~/dsh/dsh-update.sh --force          # jedini nacin da se nastavi preko KRSI
```

`--force` ne menja opsege i ne popravlja plugin — samo dozvoljava da se update
izvrši iako je prijavljeno da će plugin verovatno prestati da radi.

---

## G. Dugmad u file viewer-u + multi-delete u pickeru (2026-09-29, nastavak)

Dodato u `~/dsh/dsh-composer-extras` (i **osveženo** u `dsh/dsh-composer-extras/`
ovog arhiva — stara kopija od 16.09. nije imala ove izmene):

- **📤 Podeli** i **📂 Folder** u headeru dokument-taba (slot
  `sidebar.right.tab.document.actions`) — Android share sheet, odn. roditeljski
  folder u Solid Exploreru. Rute: `/composer-extras/api/android-share`,
  `/composer-extras/api/android-folder`.
- **Multi-select + 🗑️** u pickeru: `☑️` ulaz, `✅`/`⬜` označi sve / očisti,
  `🗑️ N` armira pa briše. Ruta `/composer-extras/api/delete-paths` (traži
  `confirm:true`).
- Popravljen bug: `android-folder` je pucao sa `dirname is not defined` →
  `path.dirname(target)`.

Detalji u sekciji **9b** i u odvojenom fajlu `UPUTSTVO-dodatak-dugmad.md` u
korenu ovog arhiva. Posle izmene plugina treba **restart dsh-a** da server deo
učita novo — `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` (jedina komanda za
restart, vidi 9b); klijent (dugmad) se učitava na refresh stranice.

---

# AŽURIRANJA — 2026-10-06 (`0.1.7-rc.2` → `0.2.0-rc.2`)

Prva **major** promena verzije od kad je auto-update ukinut. Ceo put je prvo
prošao u sandboxu (`--no-swap`), pa je tek onda zamenjena živa instalacija.
Ovaj odeljak je sažetak tog prolaza; transkript dokaza
(`SANDBOX-DOKAZ-0.2.0-rc.2.md`) je uklonjen iz arhive 2026-10-08 kao istorijski
materijal koji nije uputstvo.

## A. Blokada: `koffi@3.1.1` nema android prebuild

`npm install @deepseek-ai/dsh@0.2.0-rc.2` **pada pre ijednog instaliranog
paketa**:

```
npm error path .../dsh/node_modules/koffi
npm error command sh -c node ./cnoke.cjs -P . -D src/koffi --prebuild --release
npm error Failed to load prebuilt binary, rebuilding from source
npm error base.cc:2967:19: error: cannot initialize a member subobject of type '__u32' …
npm error  2967 |     if (statx(fd, pathname, stat_flags, stat_mask, &sxb) < 0) {
```

| korak | činjenica |
|---|---|
| `dsh-fs-local@0.2.0-rc.2` | pinuje **tačno** `koffi: 3.1.1` (0.1.7-rc.2 je imao `^3.1.0` → sam se rešio na 3.3.2) |
| `koffi@3.1.1` | `optionalDependencies` **nemaju** `@koromix/koffi-android-arm64`; android grana postoji tek od **3.2.1** |
| posledica | `cnoke` ne nađe prebuilt → build iz izvora → `statx` u Bionicu nije glibc funkcija → build pada |

Isto pinovanje ima i `0.2.1-alpha.1`, pa zamka ostaje i za sledeće izdanje.

> ⚠️ `npm install --global --prefix <dir>` **ignoriše** `overrides` iz
> `<dir>/package.json` (provereno). `overrides` radi samo u pravom *project*
> instaliranju, a ono hoistuje zavisnosti van `dsh/node_modules` i time razbija
> atomsku zamenu. Zato `dsh-update.sh` koffi rešava **zamenom paketa** (faza 4b).

Sve koffi upotrebe u 0.2.0-rc.2 su **lazy i win32-only** (`advapi32.dll`,
`kernel32.dll`, `user32.dll`) — na Androidu se koffi ne učitava, ali npm ipak
mora da prođe njegov install script.

## B. Šta je promenjeno u `dsh-update.sh`

1. **faza 4** — `--ignore-scripts` + `--prefer-online` (bajat keš je 30.09. davao
   lažni `ETARGET`); i dalje `--global --prefix` u sandbox.
2. **faza 4b (nova)** — koffi se zamenjuje verzijom sa android prebuildom
   (`DSH_UPDATE_KOFFI_VERSION`, default `3.3.2`) iz male scratch instalacije.
3. **faza 4c (nova)** — `npm rebuild --global --prefix <sandbox>` pokreće
   install/postinstall skripte nad već razrešenim drvetom. Bez toga `node-pty`
   ostane bez `build/Release/pty.node` (android prebuild ne postoji; samo
   darwin/linux/win32) i terminal alati pucaju u radu — dsh se **digao** i bez
   toga, pa se kvar lako previdi.
4. **faza 6** — dve nove probe: `require("koffi")` i `require("node-pty")`
   (paket koji u nekoj budućoj verziji ne postoji se preskače).
5. **aktivacija (novo)** — `~/dsh/.restart-after-update.sh`: detaširani restart
   koji čeka 120 s mira u sesijama, digne dsh preko pravog launcher-a, proveri
   HTTP i — ako se nova verzija **nije** digla — sam uradi `--rollback` na
   0.1.7-rc.2 i digne je ponovo. Log: `~/dsh/restart-after-update.log`
   (`DRY=1` = samo prijava). Pokreće se sa:
   `setsid nohup env IDLE=120 bash ~/dsh/.restart-after-update.sh >/dev/null 2>&1 &`

`patch-android-dsh.py` **nije** menjan — svi ciljevi zakrpa (uključujući
`dsh-attachment-local`, `dsh-session-persistence-jsonl`, `dsh-fs-local`,
`dsh-agent-loop`, `dsh-llm`, `dsh-llm-deepseek`, `node-addon-system`) postoje i u
0.2.0-rc.2, a `--check --root` prolazi bez izmena.

## C. Šta je provereno pre zamene (sandbox, `--no-swap`)

| provera | rezultat |
|---|---|
| `npm install --ignore-scripts` | 530 paketa, ~50 s |
| koffi posle 4b | `3.3.2`, `import("koffi")` → ok, `android_arm64/koffi.node` prisutan |
| `npm rebuild` | ok; `node-pty/build/Release/pty.node` 64 472 B, `require("node-pty")` ok |
| zakrpe `--root` (1–3f) | sve `[ok]` |
| probe | flock mock, `ripgrep 15.2.0`, koffi, node-pty |
| `npm ls` | čist |
| boot smoke test | HTTP 401 na portu 3089 |
| boot sa **pravim** profilom + `dsh-composer-extras` | HTTP 401, log bez greške; `POST /composer-extras/api/fs-tree-workspace` → **400** (ruta živa, nije 404) |
| client bundle plugina | `GET /plugins/??dsh-composer-extras/client.js` → **200, 95 473 B**; markeri `conversation.input.left`, `sidebar.right.tab.document.actions`, `android-share`, `delete-paths` |
| headless agent (stvarni API, `gemini-flash-lite-latest`) | `tool_call` bash → `tool_result SANDBOX_020_OK` → `turn_end completed` |
| slotovi u 0.2.0 | `conversation.input.left` i `sidebar.right.tab.document.actions` i dalje postoje |

## D. Poznato / ne dirati

- **`dsh.client.inject` u `dsh-composer-extras/package.json` pominje
  `@deepseek-ai/dsh-client-runtime`**, a taj paket u 0.2.0 ne postoji. To je
  **bezopasno**: `dsh-client-modules/lib/client.js` nepostojeći id tiho
  preskoči (`if (dependency !== void 0) …`; isti kod i u 0.1.7), a `client.js`
  plugina traži samo `require("react")`. Ne „popravljati" bez potrebe.
- **`--prefer-offline` ne vraćati** u fazu 4 — lažni `ETARGET` sa bajatim kešom.
- **Rollback:** `~/dsh/dsh-update.sh --rollback` vraća `0.1.7-rc.2` iz
  `<global-root>/.dsh-backup-0.1.7-rc.2-<timestamp>`.
- Nova verzija se aktivira **tek posle restarta** dsh-a (živi proces drži staru;
  rename je bezbedan jer otvoreni inode ostaje).

