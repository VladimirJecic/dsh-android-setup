# PRAVILA DSH setup-a — indeks

> **Pravila su od 2026-10-08 podeljena po temama u [`rules/`](rules/README.md).**
> Ovaj fajl je samo ulaz i mapa starih sekcija; ovde se **ne** pišu nova pravila
> (600 linija u jednom fajlu se teško održavalo).
>
> Počni od [`rules/README.md`](rules/README.md) — tamo su TL;DR (8 pravila koja
> se ne smeju pogaziti), tabela „koji fajl kad čitaš" i pravila održavanja.
>
> Ako se dokument i kod razilaze, **kod je istina** — ispravi fajl u `rules/`.

Stanje na dan pisanja: dsh **0.2.0-rc.2**, port **3081**, profil **web**,
lokalni pluginovi **`dsh-composer-extras`** i **`dsh-chat-jump-arrows`**.

## Mapa: stara sekcija → novi fajl

| Bilo u `PRAVILA-DSH.md` | Sada |
|---|---|
| §0 TL;DR (8 pravila) | [`rules/README.md`](rules/README.md) |
| §1 restart, §3 modeli, §4 sesije, §11 agent pravila + hard refresh/HMR | [`rules/01-sesije.md`](rules/01-sesije.md) |
| §2 smart mode (`gemini-seek-smart`) | [`rules/02-smart-mode.md`](rules/02-smart-mode.md) |
| §13 kontekst, token-metar, kompakcija, context guard, preset config | [`rules/03-kontekst-i-kompakcija.md`](rules/03-kontekst-i-kompakcija.md) |
| §5 (profile/bundles/patch deo), §8 Android/Termux zamke, instalacija | [`rules/04-instalacija.md`](rules/04-instalacija.md) |
| §7 update (10 faza), §12 testovi, logovi, rutina posle update-a | [`rules/05-odrzavanje.md`](rules/05-odrzavanje.md) |
| §5 (šta pluginovi smeju, seatovi, `data-dsh-overlay-surface`) | [`rules/06-pluginovi.md`](rules/06-pluginovi.md) |
| §9 arhiva/restore, §10 git | [`rules/07-restore-i-git.md`](rules/07-restore-i-git.md) |
| §6 tajne (+ loopback/auth) | [`rules/08-tajne.md`](rules/08-tajne.md) |

Postupak za čoveka (korak-po-korak, od nule) je i dalje
`DSH-Termux-Kompletno-Uputstvo.md`; `rules/` su pravila i odluke, a ono je
uputstvo.
