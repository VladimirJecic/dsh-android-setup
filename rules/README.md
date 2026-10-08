# Pravila DSH setup-a — indeks (`~/dsh/rules/`)

> Ovaj folder je **jedini izvor pravila** za ovaj Termux/Android DSH setup.
> Do 2026-10-08 je sve bilo u jednom `PRAVILA-DSH.md` (600+ linija), pa se
> teško održavalo; sada je podeljeno po temi. `PRAVILA-DSH.md` u korenu je samo
> indeks prema ovom folderu (stari linkovi i dalje rade).
>
> **Ako se dokument i kod razilaze — kod je istina.** Svaka izmena ponašanja
> ažurira odgovarajući fajl ovde, **ne** `PRAVILA-DSH.md`.

Stanje na dan pisanja: dsh **0.2.0-rc.2**, port **3081**, profil **web**,
lokalni pluginovi **`dsh-composer-extras`** i **`dsh-chat-jump-arrows`**.

## Najvažnija pravila (TL;DR)

1. **Restart je JEDNA komanda — `restart-dsh`.** Nikad ručni `pkill` + `nohup`.
2. **Prazna nova sesija (`+`) je smart po defaultu; postojeći razgovor NIJE.**
3. **Nikad `dsh plugin` / pnpm dok dsh radi** — pnpm prepisuje profil pod živim
   procesom i obara dsh.
4. **Tajne samo u `~/.config/dsh-secrets.env` (0600)** — nikad u arhivu ni u
   `~/.dsh/.credentials.yaml`.
5. **Update je isključivo ručan** (`~/dsh/dsh-update.sh`) i aktivira se **tek
   posle restarta**.
6. **Posle izmene klijentskog bundla (`client.js`) → hard refresh** (otvoren tab
   ga često dobije sam preko `client-hmr`; ako ne — hard refresh, pa
   `restart-dsh`).
7. **Restartuj samo preko `~/.local/bin/dsh-termux`** — on pri bootu primenjuje
   Android zakrpe; `/usr/bin/dsh` i `dsh` alias ih preskaču.
8. **Ne ostavljaj dva dsh procesa nad istom sesijom** — `flock(2)` je mock.

## Koji fajl kad čitaš

| Fajl | Tema | Otvori kad… |
|---|---|---|
| [`01-sesije.md`](01-sesije.md) | restart, hard refresh/HMR, modeli, sesije i grananje, pravila za agenta | restartuješ, menjaš `client.js`, brančuješ sesiju |
| [`02-smart-mode.md`](02-smart-mode.md) | 😎 `gemini-seek-smart` — kada se pali sam, fail-closed guard, 429 | diraš smart pravilo ili model rotaciju |
| [`03-kontekst-i-kompakcija.md`](03-kontekst-i-kompakcija.md) | token-metar, prozor, `auto: false`, context guard, pragovi | diraš kompakciju, guard, prag ili preset config |
| [`04-instalacija.md`](04-instalacija.md) | instalacija dsh-a i pluginova, profile/bundles/patch, launcher, Android zamke | dižeš setup od nule ili dodaješ plugin |
| [`05-odrzavanje.md`](05-odrzavanje.md) | update (10 faza), rollback, testovi, logovi, sync posle update-a | radiš update ili proveru zdravlja |
| [`06-pluginovi.md`](06-pluginovi.md) | naša dva plugina: šta smeju, seatovi, `data-dsh-overlay-surface` | menjaš plugin ili praviš novu overlay površinu |
| [`07-restore-i-git.md`](07-restore-i-git.md) | arhiva, `make-restore-archive.sh`, `restore.sh`, git repo i push | pakuješ/obnavljaš arhivu, komituješ |
| [`08-tajne.md`](08-tajne.md) | API ključevi, `.credentials.yaml`, PWA cookie | diraš ključeve ili auth |

## Kako se ovaj folder održava

- **Novo pravilo ide u fajl svoje teme**, ne u indeks. Ako tema ne postoji, dodaj
  fajl i red u tabelu iznad.
- Fajlovi su numerisani po redu čitanja; broj se **ne** menja kad se sadržaj
  menja (linkovi iz drugih dokumenata i arhive koriste imena).
- **Rutina posle izmene koda:** ažuriraj fajl pravila → pusti testove
  ([`05-odrzavanje.md`](05-odrzavanje.md)) → osveži arhivu
  ([`07-restore-i-git.md`](07-restore-i-git.md)) → `git commit` + `git push`.
- **Arhiva ih nosi kao `rules/`** (`make-restore-archive.sh` kopira
  `~/dsh/rules/*.md`, `restore.sh` ih vraća u `~/dsh/rules/`), pa se pravila
  restore-uju zajedno sa setup-om.
- Detaljno, korak-po-korak uputstvo za čoveka je i dalje
  `~/dsh/DSH-Termux-Kompletno-Uputstvo.md`; ovde su **pravila i odluke**, a tamo
  **postupak**.
