# Zadatak (fokusirano): dugmad u file viewer-u + multi-delete u fajl-browseru

Ti si nova headless sesija u ISTOM Termux/Android okruženju (dsh Web GUI na portu 3081).
Nemaš prethodnu istoriju razgovora i ne treba ti — sve što treba je ovde.

## Kontekst (šta je već urađeno u prethodnoj sesiji)

Klijentski plugin **`~/dsh/dsh-composer-extras`** je proširen. Dve celine:

**1) Dva dugmeta u file viewer-u** (desni sidebar, tab za dokument):
- `📤 Podeli` → Android share sheet preko `termux-api`
- `📂 Folder` → roditeljski folder u Solid Exploreru (`pl.solidexplorer2`)
- Injektuju se u slot **`sidebar.right.tab.document.actions`**; slot-props nose **`{ absolutePath }`**.
  (Slot dolazi iz paketa `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`.)

**2) Multi-select + trash u pluginovom fajl-browseru (picker):**
- `☑️` ulaz u select mode, redovi dobiju `⬜`/`✅`, `✅` = označi sve, `⬜` = očisti,
  `🗑️ N` = prvi tap armira („Potvrdi (N)"), drugi tap briše; plus `📤`/`📂` po redu za svaki fajl.

**Server rute** (`~/dsh/dsh-composer-extras/index.js`), sve loopback-only POST + JSON:
- `/composer-extras/api/android-share` — `{path, action?}` → `termux-open` (`--view` za sliku/video,
  `--send --chooser` za ostalo). Privatni fajl se prvo **stage-uje** u deljeni storage
  (slike u `/storage/emulated/0/Pictures/dsh`, ostalo u `/storage/emulated/0/Download/dsh-share`),
  pa `termux-media-scan`, pa otvaranje.
- `/composer-extras/api/android-folder` — `{path}` → `am start -f 0x10008000 -a android.intent.action.VIEW -d file://<dir> -t resource/folder`
- `/composer-extras/api/delete-paths` — `{paths:[...], confirm:true}` → trajno briše; `lstat` (ne prati symlink), neprazan folder se odbija, rezultat po putanji.
- Zajednička provera: `androidBody(req,res)` (loopback + POST + JSON), `androidTarget` dodaje validaciju `path`.

dsh je upravo **restartovan**, pa su ove rute sada registrovane (pre restarta su vraćale 405).

## Tvoj zadatak

1. **Verifikuj rute** (curl, port 3081) i to konkretno:
   - `POST /composer-extras/api/android-share` sa `{"path":"/storage/emulated/0/Download/DSH-Restore-20261007.zip"}` → očekuj `200` i `value.mime`/`value.action`;
   - `POST /composer-extras/api/android-folder` isto → `200`;
   - `POST /composer-extras/api/delete-paths` **bez** `confirm` → `400 confirm-required`;
   - `POST` sa `confirm:true` i putanjom do fajla koji sam napraviš u `$TMPDIR` → `200` i fajl stvarno ne postoji posle;
   - probaj i brisanje **nepraznog foldera** → mora vratiti `ok:false` za tu putanju.
   **Ne diraj tuđe fajlove** — test fajlove pravi u `$TMPDIR`.
2. **Verifikuj klijentski bundle**: `node --check ~/dsh/dsh-composer-extras/client.js` i potvrdi
   da u njemu postoje markeri `composer-extras-doc-actions`, `deleteMarked`, `selectModeState`.
   Ako postoji harness `$TMPDIR/harness/run.cjs`, pokreni ga (očekivano: plugin se učita i registruje
   tačno jednu `sidebar.right.tab.document.actions` registraciju).
3. **Popravi** bilo koju grešku koju nađeš — SAMO u `~/dsh/dsh-composer-extras/{client.js,index.js}`.
   Pre izmene napravi backup (`client.js.bak-<YYYYMMDD-HHMM>`), posle izmene ponovi korak 2.
4. **Napiši predlog dopune uputstva** u `~/dsh/UPUTSTVO-dodatak-dugmad.md` (NE diraj još
   `/storage/emulated/0/Download/DSH-Restore-20261007/*.md` — korisnik će prvo potvrditi očima):
   kratko i praktično — šta su tri dugmeta i trash, kako se koriste, koje rute ih nose, koje su
   zamke (Photos traži MediaStore URI pa se koristi `file://`; privatni dir se stage-uje;
   brisanje je trajno; Solid Explorer ne čita `/data/data/com.termux/...`), i kako se plugin
   vraća iz arhive (`restore.sh` / `restore-patches.sh`) — napomeni da se **kopija plugina u arhivi
   mora osvežiti** iz `~/dsh/dsh-composer-extras`.
5. **Izveštaj** (kratko, na kraju): šta je verifikovano (tačne curl komande + rezultati), šta je
   popravljeno, i šta ostaje korisniku da potvrdi očima (dugmad u vieweru, share sheet, Solid Explorer,
   multi-delete u pickeru).

## Stroga ograničenja

- **Ne restartuj dsh** i ne ubijaj nijedan proces.
- Ne diraj `node_modules`, globalnu instalaciju, `/storage/emulated/0/Download/DSH-Restore-*`
  (osim čitanja), ne pokreći `npm`/`pnpm`, ne instaliraj ništa.
- Radi kratko i ciljano: ne čitaj velike fajlove cele ako ti ne trebaju (grep + ciljani `sed -n`),
  ne ponavljaj ovaj tekst u odgovoru. Korisnik plaća tokene.
