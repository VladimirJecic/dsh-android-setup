# PROMPT za novu dsh sesiju — dugmad „Podeli" i „Folder" u file viewer-u

> Iskopiraj ceo tekst ispod crte u novu dsh sesiju (novi tab / „+" u GUI-ju).
> Nova sesija ima pristup istom okruženju (`~/dsh/dsh-composer-extras`, živi dsh na 3081).

---

## Zadatak

U DSH Web GUI-ju, kada otvorim **bilo koji fajl** (file viewer tab u desnom sidebar-u —
onaj koji za nepoznate formate kaže „Preview is not available for this file type yet."),
dodaj **dva dugmeta u header tog prikaza**:

1. **„Podeli" (share)** — pozove Android share sheet preko `termux-api`
   (`termux-share`). Cilj: generisan video da mogu da otvorim u VLC-u, PDF u čitaču itd.
2. **„Folder" (open in Solid Explorer)** — otvori **roditeljski folder** tog fajla u
   Solid Exploreru (`pl.solidexplorer2`). Ovo je korisnije za dalje snalaženje i
   menadžment fajlova, pa neka bude jednako vidljivo kao share.

Obe opcije treba da rade i u „unpreviewable" telu (npr. `.zip`, video) i u headeru
kada je preview moguć.

## Gde se ovo kači (već istraženo — nemoj ponovo otkrivati)

Paket koji renderuje file viewer:
`$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-documentpreview/lib/client.js`

U njemu već postoje **slotovi** (zvanična tačka za ekstenziju, bez DOM hackovanja):

- `sidebar.right.tab.document.actions` — renderuje se u headeru, odmah posle `PathLabel`
  (vidi `TextPreview_module_css_default.header`); slot props su `{ absolutePath }`
  (u kodu `fileOwner`).
- `sidebar.right.tab.document.unpreviewable` — renderuje se u telu kada preview nije
  moguć (tvoj `.zip` slučaj).

Header je `display:flex` bez `margin-left:auto`, pa **injektovana komponenta treba sama**
da se gurne desno: `style={{ marginLeft: "auto", display: "flex", gap: 4 }}`.
Klasa `.dhJKeW_tool` (28×28, ikonica 15px) je gotov stil za takva dugmad — možeš je
iskoristiti ili svoju minimalnu.

**Gde implementirati:** lokalni plugin `~/dsh/dsh-composer-extras` (već je u
`dsh.profile.bundles`, već injektuje u `@deepseek-ai/dsh-client-ui-slots`).
U `client.js` postoji gotov primer istog patterna — `ctx.slots.inject("conversation.input.left", ...)`
na ~1188–1410; iskopiraj taj obrazac. Klijent se registruje preko
`window.__ModuleLoader__.load({ id, factory })` i to **mora** tako da ostane.

## Server strana (nove rute u `~/dsh/dsh-composer-extras/index.js`)

Rute se registruju istim obrascem kao postojeća `/composer-extras/api/image-preview`
(~linija 178: `ctx.webServer.route({ path, handler })`). Dodaj dve:

1. `POST /composer-extras/api/android-share` — body `{ path, action? }`
   → `spawn("termux-share", ["-a", action ?? "view", "-c", mime, path])`
2. `POST /composer-extras/api/android-folder` — body `{ path }`
   → otvori **parent** folder u Solid Exploreru.

MIME odredi po ekstenziji (mp4/mkv/webm → `video/*`, png/jpg/webp → `image/*`,
pdf → `application/pdf`, txt/md/js/json → `text/plain`, zip → `application/zip`,
default `application/octet-stream`) — action `view` za video/sliku, `send` za ostalo.

**Solid Explorer — tačno ovako (dokazano na ovom uređaju, ne menjaj):**

```bash
am start -f 0x10008000 -a android.intent.action.VIEW -d "file://<DIR>" -t "resource/folder"
```

- `-t "resource/folder"` je obavezan: aktivnost filtrira po mimeType i ne deklariše `file` šemu.
- `-f 0x10008000` (`NEW_TASK|CLEAR_TASK`) je obavezan: aktivnost je `singleTask`, bez ovoga
  se samo podigne stari task sa prethodnim folderom.
- **Nikad** ne dodavaj `-n pl.solidexplorer2/pl.solidexplorer.SolidExplorer` — ekran ostane prazan.
- Pročitaj `~/.dsh/skills/solid/SKILL.md` (tu je i dijagnostika: draw-over-apps dozvola,
  kontrolni `am start -a android.settings.SETTINGS`, alternativni `inode/directory`).

**Dva izmerena ponašanja Solid Explorer-a (2026-09-29) — predvidi ih u UI-ju:**

- Ako je putanja **nečitljiva** (Termux privatni dir) ili **ne postoji**, Solid Explorer se
  ipak otvori (rc=0, bez upozorenja) ali sleti na `INTERNAL MEMORY > DOWNLOAD` i/ili ispiše
  dijalog „Requested directory was not found. Path: …". Zato: staging kopija za privatne
  putanje i provera `existsSync` pre poziva, a korisniku jasna poruka umesto tihog promašaja.
- Solid Explorer pamti poslednju lokaciju/tab. Ako se folder **preimenuje**, stara putanja
  ostaje zapamćena i pravi taj dijalog sve dok se ne otvori nova (ili dok se stara lokacija
  ručno ne ukloni). Naš slučaj: `DSH-Restore-20260915` → `DSH-Restore-20261007`.

**Važno ograničenje koje sam izmerio:** fajlovi u Termux privatnom dir-u
(`/data/data/com.termux/...`) **ne mogu** da se browse-uju u Solid Exploreru.
Zato za putanje van `~/storage/shared` prvo napravi staging kopiju u
`/storage/emulated/0/Download/dsh-share/<basename>` i otvori **taj** folder
(uputi korisniku gde je kopija). `termux-share` radi i sa privatnim putanjama
(verifikovano: `termux-share -a view -c image/png <privatni fajl>` → rc=0),
jer termux-api sam kopira fajl tamo gde primalac može da ga pročita.

## Pravila okruženja (obavezno)

- **Ne restartuj živi dsh** (na 3081) bez izričite dozvole korisnika — on kroz njega
  razgovara. Restart samo na zahtev, preko `restart-dsh` skilla.
- `spawn` sa **argv nizom**, nikad shell string (putanja je korisnički podatak).
- `am start` vraća 0 i kad se ništa ne pojavi → u UI prikaži kratku poruku/hint, a
  korisnika **pitaj** da li se folder otvorio i pročitaj `am`-ov stderr.
- Klijentski bundle se ne hot-reload-uje: posle izmene treba **hard refresh** browsera.
  Pre toga proveri da se servira: `curl -s http://127.0.0.1:3081/plugins/dsh-composer-extras/client.js | head -5`.
  Ako bundle nije umotan u `__ModuleLoader__.load`, ceo GUI prikaže „Failed to load plugins" —
  zato prvo napravi backup (`client.js.bak-<datum>`) i testiraj posle svake izmene.
- Ne pokreći `dsh plugin` / pnpm dok dsh radi (dva puta je oborilo proces).
- Zakrpe i profil-linkovi se ne diraju ručno; o njima brine `python3 ~/dsh/patch-android-dsh.py`
  (`restore-patches.sh --check` pokazuje stanje).

## Prihvatni kriterijumi

1. Otvorim `.zip` (ili bilo koji nepodržan fajl) → u telu vidim oba dugmeta;
   header varijanta radi za fajlove koji imaju preview (npr. tekst/slika).
2. Klik „Podeli" → otvori se Android share sheet; za `.mp4` VLC je u listi.
3. Klik „Folder" → Solid Explorer otvori tačan roditeljski folder (za privatnu putanju:
   staging folder u `Download/dsh-share/`, i to jasno piše u UI-ju).
4. Bundle se i dalje ispravno učitava posle hard refresh-a (bez „Failed to load plugins").

## Kako da testiraš bez rizika

- Test fajlovi: `/storage/emulated/0/Download/DSH-Restore-20261007.zip` (nepodržan format),
  neki `.png`/`.mp4` u `~/dsh/` (privatna putanja → staging put) i jedan fajl na
  `/storage/emulated/0/Download/` (direktno otvaranje foldera).
- Server rute možeš prvo pozvati `curl`-om, pa tek onda kroz UI.
- Kratak izveštaj na kraju: šta je dodato (fajlovi + linije), šta je verifikovano
  na uređaju, i šta korisnik treba da potvrdi očima (share sheet / Solid Explorer).
