Radi dvojezični titl za učenje nemačkog za **epizodu {{EP}}** serije Black Clover, sezona 1.
Ovo je automatizovani niz — radi SAMO ovu jednu epizodu i onda stani.

## Ulaz

- Video: `{{MKV}}` (u korenu foldera sezone)
- Radni folder: `{{EPDIR}}` — napravi ga ako ne postoji i radi ISKLJUČIVO u njemu.

## Šta uraditi

Prati skill **`partial-prevod`** tačno po njegovom redosledu koraka (0–8). Učitaj ga
alatom `skill` pre početka. Redosled se NE skraćuje:

1. `izvuci_titl.py --izlaz .` → `<naziv>.deDE.srt` **u epNN folder** (nikad pored videa)
2. `dijagnoza.py` → `lexikon_dodaci.json` + `transkript.md`
3. pročitaj `transkript.md`, pa popuni SVAKO prazno polje u `lexikon_dodaci.json`
4. `generate_partial_srt.py`
5. `proveri_prevod.py` — mora da kaže `OK — sme render.` (exit 0)
6. `paket_za_kritiku.py` → podagent `translation-critiquer` → `primeni_kritiku.py`
7. ponovo `generate_partial_srt.py` + `proveri_prevod.py` (opet OK)
8. pregledaj SVE prikazane parove (skript u skillu), ispravi đubre
9. `sacuvaj_recnik.py . --obrisi`
10. **SOFT render** (vidi ispod)

## Render — SOFT, obavezno

```bash
B=~/.dsh/skills/burn-subtitle/burn.py
python3 $B -i "<putanja do videa>" -s "{{EPDIR}}/partial-prevod.ass" --soft -o "{{SOFTNAME}}"
```

- `--soft` je OBAVEZAN. **Ne** radi burn-in (bez `--soft`), ne pravi `.mp4`.
- `--pozadina` i `--status` se ne koriste za soft — gotovo je u istom pozivu (~4 s).
- Izlaz ide u **koren sezone** kao `{{SOFTNAME}}` (npr. `16-soft-vocab.mkv`).
- `burn.py` sam proverava trajanje, ASS traku, stilove (Vocab=8 gore, Default=2 dole)
  i broj `Dialogue` linija. Ako ne prođe, fajl ne dobija konačno ime — tada je
  zadatak pao, vidi `.log`.

## Zabrane

- **NE briši originalni MKV.** Supervizor ga briše posle svojih kapija.
- **NE pravi nove sesije** i ne pozivaj `branch-into-new-session` / `branch.sh`.
  Grananje je već obavljeno; radi zadatak ovde.
- Ne menjaj `lexikon.json` ručno osim kroz `sacuvaj_recnik.py`.
- Ne patch-uj skripte skilla da bi „prošlo" kapiju.

## Kraj — upiši `.done.json`

Kad (i samo kad) soft fajl postoji sa konačnim imenom, upiši `{{EPDIR}}/.done.json`:

```json
{
  "ep": {{EP}},
  "ok": true,
  "soft": "{{SOFTNAME}}",
  "qaOk": true,
  "criticism": { "ran": true, "applied": <broj ispravki> },
  "pairsReviewed": true,
  "lexiconSaved": true,
  "durationMin": <trajanje epizode u minutima>,
  "at": "<ISO vreme>"
}
```

Ako nešto ne možeš da rešiš, upiši `.done.json` sa `"ok": false` i `"reason": "<kratko>"`,
pa **stani** — ne pokušavaj zaobilazne puteve.

## Odgovor na kraju

Jedan kratak pasus: broj blokova, broj parova, koliko je kritika ispravila, ime i
veličina soft fajla. Bez izlistavanja fajlova.
