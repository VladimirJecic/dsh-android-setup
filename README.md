# dsh-android-setup

DSH (**DeepSeek Harness**) na Termuxu / Androidu — restore arhiva i pravila setup-a.

Ovo je git ogledalo foldera **`DSH-Restore-20261007`** sa telefona
(`/storage/emulated/0/Download/DSH-Restore-20261007`) i služi da se setup vrati
posle reinstalacije / brisanja `~/.dsh`, i da pravila budu na jednom mestu.

## Gde šta piše

| Fajl | Šta je |
|---|---|
| [`rules/`](rules) | **sva pravila setup-a, po temama** — indeks je [`rules/README.md`](rules/README.md) (TL;DR + „koji fajl kad čitaš") |
| [`PRAVILA-DSH.md`](PRAVILA-DSH.md) | samo mapa: stare sekcije → `rules/*.md` |
| [`README-RESTORE.md`](README-RESTORE.md) | restore uputstvo (brzi put, korak po korak) |
| [`DSH-Termux-Kompletno-Uputstvo.md`](DSH-Termux-Kompletno-Uputstvo.md) | kompletno uputstvo sa dijagnozama |
| [`restore.sh`](restore.sh) | vraća setup na telefon (`--dry-run` pa primena) |
| [`skills/`](skills) | svi DSH/Claude skillovi (uključujući `restart-dsh/restart-dsh.sh`) |
| [`tests/`](tests) | testovi pravila — `node tests/*.mjs`, `python3 tests/test-gemini-catalog-update.py` |
| [`dsh/`](dsh) | skripte i oba lokalna plugina (`dsh-composer-extras`, `dsh-chat-jump-arrows`) |

## Vraćanje setup-a

```bash
bash restore.sh --dry-run    # pogledaj šta bi uradio
bash restore.sh              # primeni
```

⚠️ **Arhiva ne sadrži tajne.** API ključevi se unose ručno u
`~/.config/dsh-secrets.env` (mode 0600) — vidi [`rules/08-tajne.md`](rules/08-tajne.md).

## Šta je novo

**2026-10-08**

- **Pravila podeljena po temama** u `rules/` (indeks `rules/README.md`);
  `PRAVILA-DSH.md` je ostao samo kao mapa starih sekcija.
- Novi plugin **`dsh-chat-jump-arrows`** (▲▼ kroz moje poruke); sklanja se dok je
  otvoren picker/dijalog/meni.
- Smart mode **ne prebacuje model dok je kontekst nepoznat** (fail-closed).
- Popravljen `gemini-catalog-update.py` (`!!js` je obarao osvežavanje kataloga
  pri svakom startu).
- Arhiva očišćena od istorijskih planova/promptova/dokaza i jednokratnih proba.

**2026-10-07**

- **Restart je jedna komanda — `restart-dsh`.** Isto ime u „+" meniju dsh-a i u
  skill katalogu, a **jedna implementacija**:
  `skills/restart-dsh/restart-dsh.sh`. Plugin (`dsh-composer-extras`) je samo
  detaširano pozove. Ukinuta je dupla `/restart` komanda.
- **Prazna nova sesija (dugme „+") je ponovo smart po defaultu** — postojeći
  razgovori sa istorijom to NISU (samo branchovani smart start ili ručni 😎).
- `PRAVILA-DSH.md` — pravila prvi put na jednom mestu (od 2026-10-08 → `rules/`).
- Arhiva je prvi put objavljena na GitHub.

## Stanje setup-a

- dsh **0.2.0-rc.2**, port **3081**, profil **web**
- model: `deepseek-official/deepseek-flash` (`reasoningEffort: high`)
- Gemini (`gemini-flash-lite-latest`) preko `llm-pi-ai` — nosi 😎 smart rotaciju
- pluginovi (oba lokalna, `link:`): `dsh-composer-extras`, `dsh-chat-jump-arrows`
