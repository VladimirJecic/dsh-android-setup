# Dodatak uputstvu — dugmad u file viewer-u i multi-delete u fajl-browseru

Plugin: `~/dsh/dsh-composer-extras` (`client.js` + `index.js`).
Sve rute su **loopback-only POST + JSON** na portu **3081** (dsh web GUI).

## 1. Dva dugmeta u file viewer-u

U desnom sidebar-u, tab za dokument, u headeru (slot
`sidebar.right.tab.document.actions`, props `{ absolutePath }`):

| Dugme | Šta radi |
|-------|----------|
| **📤 Podeli** | Otvori Android share sheet (`termux-open`). Slika/video → `--view` (npr. VLC), ostalo → `--send --chooser`. |
| **📂 Folder** | Otvori **roditeljski folder** fajla u Solid Exploreru (`pl.solidexplorer2`) preko `am start`. |

Ruta: `POST /composer-extras/api/android-share` `{path, action?}`
Ruta: `POST /composer-extras/api/android-folder` `{path}`

## 2. Multi-select + trash u fajl-browseru (picker)

- **☑️** ulazi u select mode. Redovi dobiju **⬜** (nije označen) / **✅** (označen); tap na red označava/skida oznaku.
- **✅** = označi sve u folderu, **⬜** = očisti selekciju, **✖️** = izađi iz selekcije.
- **🗑️ N** = prvi tap **armira** (dugme pocrveni i piše „Potvrdi (N)"), **drugi tap briše**. Brisanje je **trajno**.
- Svaki red ima i **📤** (Podeli) i **📂** (Solid folder) za taj fajl.

Ruta: `POST /composer-extras/api/delete-paths` `{paths:[...], confirm:true}`
Bez `confirm:true` ruta vraća `400 confirm-required` (zaštita od slučajnog brisanja).
Server radi `lstat` (ne prati symlink), **neprazan folder odbija**, vraća rezultat po putanji.

## 3. Zamke (bitno)

- **Photos traži MediaStore URI** — zato folder-intent koristi `file://<dir>` sa `-t resource/folder` i `-f 0x10008000`; bez toga se aktivnost odmah zatvori.
- **Privatni Termux dir** (`/data/data/com.termux/...`) se **stage-uje** pre deljenja: slike u `/storage/emulated/0/Pictures/dsh`, ostalo u `/storage/emulated/0/Download/dsh-share`, pa `termux-media-scan`.
- **Solid Explorer ne čita `/data/data/com.termux/...`** — privatni fajl se prvo kopira u deljeni storage (vidi gore), a privatni **folder** se ne može otvoriti (dobiješ `private-directory`); otvori fajl pa „Podeli", ili kopiraj u Download.
- **Brisanje je trajno** (nema recycle bin-a); prvi tap na 🗑️ samo armira.

## 4. Vraćanje plugina iz arhive

Iz `DSH-Restore-20261007` (najnovija arhiva u `~/storage/shared/Download`):

```bash
# cela obnova (profil, skripte, plugini, skills) — pita za tajne
bash /storage/emulated/0/Download/DSH-Restore-20261007/restore.sh

# samo zakrpe + ~/dsh skripte (sam nađe najnoviju arhivu)
bash ~/dsh/restore-patches.sh --check   # pregled
bash ~/dsh/restore-patches.sh           # primena
```

`restore.sh` kopira `dsh/dsh-composer-extras/{client.js,index.js,package.json,cordis.patch.yml}`
i pravi symlink `~/.dsh/profiles/node_modules/dsh-composer-extras -> ~/dsh/dsh-composer-extras`.

> **Kopija plugina u arhivi je osvežena 2026-10-06** (sadrži i SMART branch /
> `prompt-session` rute). Ako plugin menjaš posle toga, arhivu osveži jednim
> potezom — `bash ~/dsh/make-restore-archive.sh` (uzme žive fajlove, prepiše
> datum u putanjama i spakuje `.zip`).

## 5. Poznato / istorija

- 2026-09-29: `android-folder` je pucao sa `dirname is not defined` (u `index.js` je korišćen `dirname` bez import-a). Popravljeno na `path.dirname(target)`. Za primenu u živom serveru treba **restart dsh**.
- 2026-10-06: dsh prešao na **0.2.0-rc.2** (vidi odeljak „AŽURIRANJA — 2026-10-06" u `DSH-Termux-Kompletno-Uputstvo.md`); plugin i sve zakrpe rade nepromenjeno, `sidebar.right.tab.document.actions` i `conversation.input.left` slotovi postoje i u 0.2.0.
