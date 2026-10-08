# 06. Naši pluginovi: pravila ponašanja

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Kod:
> `~/dsh/dsh-composer-extras/`, `~/dsh/dsh-chat-jump-arrows/`. Instalacija i
> profil: [`04-instalacija.md`](04-instalacija.md).

## Zajednička pravila

- **Bundle se registruje kroz `window.__ModuleLoader__.load({id, factory})`**
  (`id` = ime paketa) — dsh loader **nije** običan ESM. Pogrešan omot = „Failed to
  load plugins" i nijedan plugin se ne učita.
- **Ne patchuj dsh-ov kod** — koristi slotove (`ctx.slots.register`) i stabilne
  DOM atribute. Tako `npm install -g @deepseek-ai/dsh@latest` ne može da obriše
  funkciju.
- **Klijentski bundle i host deo se razlikuju:** `client.js` (GUI) traži samo
  hard refresh; `index.js`/`package.json`/`cordis.patch.yml` traže `restart-dsh`
  ([`01-sesije.md`](01-sesije.md)).
- Pre restarta: `node -c client.js && node -c index.js`.
- Svaka izmena ponašanja → odgovarajući test iz `~/dsh/tests/` mora ostati zelen
  ([`05-odrzavanje.md`](05-odrzavanje.md)).

## `dsh-composer-extras` — šta sme

- Sve API rute su **loopback-only** (`127.0.0.1`/`localhost`/`::1`).
- Write akcije (upload/mkdir/rename/delete) su **workspace-scoped**; „delete"
  traži `confirm:true`.
- „Unrestricted" mod je **samo čitanje** van workspace-a (namerno odobreno).
- `android-share`/`android-folder` idu preko `termux-share`/`am start`.
- **Svaka površina koja preuzme ceo ekran nosi `data-dsh-overlay-surface`**
  (npr. file-picker „Dodaj u kontekst" = `file-picker`). To je ugovor sa
  strelicama (ispod): `shell.overlay` je iznad composera, pa se jedino tako zna
  da treba da se sklone. Context-guard kartica to ne mora — ona je pravi
  `role="dialog"` + `aria-modal="true"`.
- Smart mode i context guard imaju svoja pravila:
  [`02-smart-mode.md`](02-smart-mode.md),
  [`03-kontekst-i-kompakcija.md`](03-kontekst-i-kompakcija.md).

## `dsh-chat-jump-arrows` — ▲▼ kroz MOJE poruke (od 2026-10-07)

Namena: jedan odgovor agenta na telefonu ume da bude hiljade piksela procesa, a
korisnikovo pitanje ostane visoko iznad ekrana. Plugin daje dva lebdeća chevrona
uz **desnu ivicu razgovora** (ne ekrana):

- **▲** = prethodna **moja** poruka (`user` ili `steering`) — sleti 12px pod vrh;
- **▼** = sledeća moja poruka, a sa poslednje pada na **dno** (time se i dsh-ov
  `follow-tail` sam ponovo uključi);
- badge između njih pokazuje `n/m` (koja sam od koliko svojih poruka).

Pravila koja se ne smeju pogaziti:

- **Seat je `shell.overlay`** (root, click-through sloj iz
  `dsh-client-ui-layout`) — jedini zvanični „frame-wide floating" seat. Ništa u
  chatu se ne patchuje.
- **Strelice se vide samo kad postoji bar jedna moja poruka** u DOM-u; bez
  razgovora ili u tuđem view-u (npr. Trajectory) ne renderuje se ništa.
- **Dok je otvoren picker/dijalog/meni, strelica NEMA** (od 2026-10-08). Seat
  `shell.overlay` stoji **iznad** composera, pa `z-index: 10000` iz pickera to ne
  može da nadjača — strelice bi lebdele preko pickera i kradle dodire (🗑️ se
  teško kliknuo, a prevlačenje preko kartice je skrolovalo transkript). Zato
  `computeState` vraća `HIDDEN` kad postoji **renderovan** element koji odgovara
  `OVERLAY_SELECTOR`:
  `[role="dialog"][aria-modal="true"], [role="menu"]` (dsh-ov `modalSelector`
  ugovor, isti na kome `dsh-client-shortcuts` blokira prečice) **ili**
  `[data-dsh-overlay-surface]` — oznaka koju `dsh-composer-extras` stavlja na
  svoj „Dodaj u kontekst" picker (običan `fixed` div, nije `role="dialog"`, pa ga
  prvi deo selektora ne vidi). Picker se montira u **portal van transkripta**,
  zato `JumpArrows` drži i drugi `MutationObserver` nad
  `document.documentElement` (`role`, `aria-modal`, `data-dsh-overlay-surface`) —
  bez njega otvaranje pickera ne bi uopšte probudilo skeniranje. Element bez
  layout-a (`display: none`, `hidden`) se ne računa, da zaglavljen meni ne
  sakrije strelice zauvek. **Nova overlay površina = obavezno je označi
  `data-dsh-overlay-surface`** (ili `role="dialog"` + `aria-modal="true"`).
- **dsh-ova kompenzacija pozicije se brani:** ako paginacija stare istorije
  pomeri sadržaj posle sletanja, plugin jednom ispravi `scrollTop` — ali samo dok
  se skrol ne smiri i samo ako korisnik nije dirao ekran (gest otkazuje).
- **Ne koristi dsh interne iz `ui-chat`** (nema importa `viewport`/`scrollToTurn`);
  čita samo DOM atribute koje je dsh sam proglasio stabilnim:
  `[data-conversation-scroll]` (`.scrollBody`, pravi scrollport — unutrašnji
  `.scroll` je `overflow: visible`) i `[data-chat-flow-kind="user"|"steering"]`
  (najspoljašnji `.flowItem` sa `data-chat-anchor-key`).
- **Zašto ne ugrađeni turn rail:** `TurnNavigator` šeta TURN-ove (ne pitanja) i
  sakriven je na uskim ekranima (`@container (width<=900px){display:none}`), a
  ugrađeno „to bottom" dugme je samo jednosmerna polovina ovoga.
- Veze: `dsh.profile.bundles` + symlink u `profiles/web/node_modules`,
  `patch-android-dsh.py` 4b/4c ih čuvaju, `make-restore-archive.sh` i
  `restore.sh` ih nose u arhivi ([`07-restore-i-git.md`](07-restore-i-git.md)).
- Korisničko uputstvo: `~/dsh/UPUTSTVO-strelice.md`; test:
  `node ~/dsh/tests/test-chat-jump-arrows.mjs` (53 provere).

## Šta je „moja poruka" u DOM-u

`[data-chat-flow-kind="user"]` = običan prompt, `"steering"` = poslato dok agent
radi. Oba se broje; red unutar sklopljene proces-grupe (turn-process) i skriven
red se **ne** broje. Poređenje „gde sam" ide po traci od 40px od vrha
scrollporta, ne po pixel-jednakosti — kratak prompt nikad ne bi bio „na traci" pa
bi ▲ zaglavila na istoj poruci.
