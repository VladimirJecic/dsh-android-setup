# Plan: automatski niz epizoda (Black Clover S1, E16 → E51, SOFT)

> Status: **PLAN — niz još nije pokrenut.** Revidirano 2026-11-15 posle odluke
> o SOFT titlu. Cilj: jedna epizoda = jedna prazna sesija, redom, bez ručnog
> pokretanja. Vlasnik sekvence je **spoljni supervizor** (skript), ne sesije.

## 0. Stanje sada (provereno na fajlovima)

| | |
|---|---|
| Slobodno | **24,5 GB** |
| Gotovo SOFT | **E15** (`15-soft-vocab.mkv`, 344 MB, 4 s render) |
| Gotovo HARD (stari režim) | E03–E14 (12 MP4-ova, ~1 GB svaki) |
| Ostalo originala | **E16–E51 (36 MKV-ova)** — E15 MKV obrisan po novom protokolu |
| Obrisano | E01–E15 MKV + folderi ep01/ep02 (gledani) |

**Napomena o E15:** napravljena je pre ovog plana i **nema `.done.json`**. Zato
kapija 1 ne sme da bude tvrda — ako `.done.json` nema, stanje se **izvodi iz
fajlova** (kapije 2–10). Sve epizode od E16 nadalje pišu `.done.json`.

## 1. SOFT menja sve — izmereno, ne procena

| | HARD (staro) | SOFT (novo) | |
|---|---|---|---|
| Render | ~13 min | **~4 s** | 200× brže |
| Izlaz | `NN-sub-burnt-vocab.mp4` | `NN-soft-vocab.mkv` | |
| Veličina (E15) | — | **344 MB** | izvor 365 MB |
| Neto po epizodi | **+654 MB** | **−22 MB** | soft je MANJI od izvora |

Posledica: **brisanje originala posle rendera više nije nužno da bi stalo** —
soft izlaz zamenjuje original i još oslobađa ~22 MB. Prostor prestaje da bude
ograničenje: E16–E51 (36 epizoda) neto **−0,8 GB**, ostaje ~25 GB.

### Zašto soft izlaz sme da zameni original

`--soft` ne reenkodira: `-map 0:v:0 -map 0:<eng audio> -map 1 -c copy`.
Provereno na E15: video `hevc 1920x1080 yuv420p10le` **identičan** izvoru,
trajanje 1431,98 s vs 1432,90 s (razlika 0,9 s), ASS traka sa oba stila
(`Vocab` align 8 gore, `Default` align 2 dole), 677 `Dialogue` linija, engleski
audio default.

**Cena:** soft MKV nosi samo **engleski** audio + **jednu** (srpsku) titl-traku.
Izvor je imao 2 audia (jpn/eng) i 12 titl-traka (8 ASS + 2 PGS). Ako ti ikad
zatreba japanski audio ili originalni nemački titl iz videa — treba ponovo
skinuti epizodu. Nemački `.deDE.srt` **ostaje** u `epNN/` (39 KB), pa je
prevod reproduktivan; izvor videa nije.

## 2. Protokol brisanja (tvoje pravilo, sada deo procedure)

> **Originalni MKV se briše tek kad je epizoda završena I testirana renderom.**

Redosled je obavezan i nema preskakanja:

1. sesija završi pipeline (dijagnoza → rečnik → generate → QA → kritika →
   primeni → generate → QA → pregled parova → sačuvaj rečnik);
2. `burn.py --soft` prođe **svoju** proveru (trajanje, ASS traka, stilovi,
   broj linija) i fajl dobije konačno ime `NN-soft-vocab.mkv`;
3. supervizor pusti **nezavisne kapije** (§5) na taj fajl;
4. **tek tada** `rm` originala `[Judas] Black Clover - S01ENN (0NN).mkv`;
5. ako bilo koja kapija padne — original **ostaje**, epizoda ide u `failed`,
   niz staje.

Brisanje je uvek **posle** konačnog imena, nikad posle `.part` fajla. U E15 je
primENjeno ručno: soft izlaz proveren, pa original obrisan.

## 3. Zašto supervizor, a ne „prompt pali sledeću sesiju"

Ruta `/composer-extras/api/branch-session` već pravi praznu sesiju
(`historyShared:false`) u istom workspace-u — kontekst se **ne** prenosi.
Prepreke za lanac u promptu:

| Problem lanca u promptu | Posledica |
|---|---|
| `branch.sh` odbija grananje iz branchovane sesije (`children/<id>`) | drugi korak tiho staje (exit 3) |
| model u detetu ponovo pozove skill grananja | dupla sesija za istu epizodu |
| poziv padne posle rendera, a pre oznake | ista epizoda kreće dvaput |
| niko ne proverava fajlove | „gotovo" bez izlaza ili sa `.part` |
| pad jedne epizode | sledeća kreće sa polomljenim rečnikom |

Zato: sesija ostaje prazna i jednokratna, a sekvencu, čekanje i kapije drži
skript.

## 4. Arhitektura

```
chain.sh (supervizor: flock, setsid, termux-wake-lock)
  │  za N = 16..51:
  ├─ 1. epNN već gotov (kapije prolaze)? → preskoči (idempotentno)
  ├─ 2. prostor: traži ≥ 1 GB slobodno, inače STOP
  ├─ 3. POST /branch-session {prompt(E N), cwd=sezona, provider, model, effort}
  ├─ 4. čekaj idle (running=false, queue prazan, nema pendingInput)
  ├─ 5. KAPIJE (§5) — skript, ne veruje agentu
  ├─ 6. prošlo → obriši original MKV (protokol §2), state.next = N+1
  └─ 7. palo / zastoj → STOP + notifikacija (fail-closed)
```

### Fajlovi

```
~/.dsh/skills/episode-chain/
  SKILL.md              # kako se pušta/zaustavlja/opservira
  chain.sh              # start | status | stop | resume | dry-run
  new-session.sh        # prazna sesija + prompt (POST branch-session)
  wait-idle.sh          # čeka idle preko /session-state
  gates.sh              # kapije + protokol brisanja
  prompt.template.md    # šablon zadatka za jednu epizodu
~/dsh/episode-chain/black-clover-s1/
  state.json            # {next, done[], failed, sources{}, history[]}
  chain.log             # JSONL po epizodi
  STOP                  # postoji → niz staje na granici epizode
  epNN.prompt.md        # generisan prompt (reprodukcija/dijalog)
```

## 5. Kapije (pre brisanja originala)

| # | Provera | Kako |
|---|---|---|
| 1 | `.done.json` postoji, `ok !== false` — **ako ga nema** (npr. E15), izvedi iz fajlova 2–10 | jq |
| 2 | `epNN/partial-prevod.ass` i `.srt` postoje, `.ass` > 20 KB | stat |
| 3 | SRT: ≥ 200 blokova sa `{\an8}`, svaki par ima ` = ` sa nepr. desnom stranom | python |
| 4 | Nema istog ključa sa različitim prevodom | python |
| 5 | `NN-soft-vocab.mkv` postoji (konačno ime, ne `.part`) | ls |
| 6 | Nema `.part.mkv`, `.progress`, `.burn.json` | ls |
| 7 | Trajanje soft = izvor ±1,5 s (izvor zapisan pre rendera u state) | ffprobe |
| 8 | Video traka `hevc`, `yuv420p10le`, ista rezolucija kao izvor | ffprobe |
| 9 | ASS traka postoji, `Dialogue` = kao u `partial-prevod.ass`, stilovi align 8 i 2 | ffmpeg -f ass |
| 10 | Audio `eng` je `default` | ffprobe |
| 11 | `criticism.ran === true` i `applied` je broj | jq |

Ako je izvor već obrisan (ponovna provera), kapija 7 se izvodi iz
`state.json.sources[N]`.

## 6. Stanje, oporavak, granice

- `state.json` se piše atomski (tmp + mv) posle svake promene.
- `chain.sh resume` nastavlja od `next`; epizoda koja nije prošla kapije ide u
  `failed` i **ne** se automatski ponavlja; `resume --redo` čisti `epNN`
  (osim `.deDE.srt`).
- Fail-closed: zastoj > **90 min** po epizodi (soft je brz, ali prevod i
  kritika nisu), ili `pendingInput` sadrži `question`/`approval` → STOP.
- **Tvrdi stop na E51** — ne postoji E52; `next > 51` → „sezona završena".
- Zaštita od duplog trka: `flock` na `.lock`; `STOP` fajl se proverava između
  epizoda (tekuća se dovrši).
- Baterija: pauza ako < 20 % i nije na punjaču; `termux-wake-lock` drži CPU.

## 7. Model i effort

- Model: `deploy` / `deepseek-ai/deepseek-v4.1-flash-1017`, effort **`high`**.
- Profilni default je `max`. `selectModel` **upisuje u profilni default**
  (prepisuje `cordis.patch.yml`), zato se ne koristi.
- Rešenje: ruta dobija `reasoningEffort` i primeni ga **samo na tu sesiju**
  (`controller.resolveAgent(id)` → `agent.model.select({…, reasoningEffort})`).
  Profil ostaje netaknut.
- Cena: jedna izmena `~/dsh/dsh-composer-extras/index.js` → **jedan
  `restart-dsh`** pre prvog pokretanja (traži tvoju dozvolu).
- Fallback bez restarta: niz ide na profilnom `max`.

## 8. Vreme (izmereno na E15)

E15 je trajala **828 min** zidno (17 turn-ova, pauze između), ali **198 min
stvarnog rada**. Uz soft render (4 s umesto 13 min) realno **30–45 min po
epizodi** za model + kritiku; render više nije faktor.

| Obim | Procena |
|---|---|
E16–E30 (15 ep) | 8–12 h |
E16–E51 (36 ep) | 18–27 h |

Uz `termux-wake-lock` i telefon na punjaču. Niz može da se prekine u svakom
trenutku i nastavi sa `resume`.

## 9. Redosled implementacije (kad kažeš „kreni")

1. `reasoningEffort` u `branch-session` + `GET /session-state`
   (jedna izmena plugina, **restart-dsh** uz dozvolu).
2. `new-session.sh` + `wait-idle.sh` — proba na jednoj sesiji bez rendera.
3. `gates.sh` — test na **E15** (mora proći sve) i na praznom folderu (mora
   pasti); **test brisanja**: pokreni kapije na kopiji, proveri da `rm` ide
   samo posle konačnog imena.
4. `chain.sh --dry-run` za E16 (ispiše prompt, ne pošalje).
5. **E16** uz nadzor; posle nje `status` mora da pokaže `next:17`, MKV E16
   obrisan, prostor nepromenjen (±50 MB).
6. Tek onda `chain.sh start` za E17–E51.

## 10. Rizici

| Rizik | Odgovor |
|---|---|
| Dva rendera paralelno | `.burn.json` + `flock`; niz staje ako vidi tuđi render |
| Telefon se ugasi | `state.json` + `resume`; tekuća epizoda se ponavlja |
| Model tvrdi „gotovo" bez izlaza | kapije 5–10 padaju → STOP, original ostaje |
| Rečnik se pokvari i putuje dalje | pad na kapiji 3/4 zaustavlja niz pre N+1 |
| Pogrešna epizoda (off-by-one) | broj iz imena MKV-a i iz prompta iz jednog izvora |
| Treba TV (soft se ne vidi) | hard render iz `NN-soft-vocab.mkv` (već nosi ASS traku) + `partial-prevod.ass` |
| Treba japanski audio / originalni titl | **samo** ponovno skidanje — soft čuva engleski + srpski |

## 11. Šta traži tvoju dozvolu

1. **Jedan `restart-dsh`** (zbog `reasoningEffort` + `session-state` rute).
2. Potvrda protokola brisanja iz §2 (original ide posle kapija).
3. Tvrdi stop na **E51** (nema dalje u S1).
