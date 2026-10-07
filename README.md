# dsh-android-setup

DSH (**DeepSeek Harness**) na Termuxu / Androidu — restore arhiva i pravila setup-a.

Ovo je git ogledalo foldera **`DSH-Restore-20261007`** sa telefona
(`/storage/emulated/0/Download/DSH-Restore-20261007`) i služi da se setup vrati
posle reinstalacije / brisanja `~/.dsh`, i da pravila budu na jednom mestu.

## Gde šta piše

| Fajl | Šta je |
|---|---|
| [`PRAVILA-DSH.md`](PRAVILA-DSH.md) | **sva pravila setup-a** — restart, smart mode, sesije, pluginovi, tajne, update, Android zamke, arhiva, git |
| [`README-RESTORE.md`](README-RESTORE.md) | restore uputstvo (brzi put, korak po korak) |
| [`DSH-Termux-Kompletno-Uputstvo.md`](DSH-Termux-Kompletno-Uputstvo.md) | kompletno uputstvo sa dijagnozama |
| [`restore.sh`](restore.sh) | vraća setup na telefon (`--dry-run` pa primena) |
| [`skills/`](skills) | svi DSH/Claude skillovi (uključujući `restart-dsh/restart-dsh.sh`) |
| [`dsh/`](dsh) | skripte i `dsh-composer-extras` plugin |

## Vraćanje setup-a

```bash
bash restore.sh --dry-run    # pogledaj šta bi uradio
bash restore.sh              # primeni
```

⚠️ **Arhiva ne sadrži tajne.** API ključevi se unose ručno u
`~/.config/dsh-secrets.env` (mode 0600) — vidi `PRAVILA-DSH.md`, sekcija 6.

## Šta je novo (2026-10-07)

- **Restart je jedna komanda — `restart-dsh`.** Isto ime u „+" meniju dsh-a i u
  skill katalogu, a **jedna implementacija**:
  `skills/restart-dsh/restart-dsh.sh`. Plugin (`dsh-composer-extras`) je samo
  detaširano pozove. Ukinuta je dupla `/restart` komanda.
- **Prazna nova sesija (dugme „+") je ponovo smart po defaultu** — postojeći
  razgovori sa istorijom to NISU (samo branchovani smart start ili ručni 😎).
- **`PRAVILA-DSH.md`** — konsolidovana pravila, prvi put na jednom mestu.
- Arhiva je prvi put objavljena na GitHub.

## Stanje setup-a

- dsh **0.2.0-rc.2**, port **3081**, profil **web**
- model: `deepseek-official/deepseek-flash` (`reasoningEffort: high`)
- Gemini (`gemini-flash-lite-latest`) preko `llm-pi-ai` — nosi 😎 smart rotaciju
- plugin: `dsh-composer-extras` (lokalni, `link:`)
