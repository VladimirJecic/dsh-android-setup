---
name: partial-prevod
description: Pravi dvojezični titl za učenje nemačkog — ključne nemačke reči (imenice sa članom, glagoli, pridevi, predlozi sa padežom, odvojivi glagoli) sa srpskim prevodom PRI VRHU videa, a originalni nemački titl ostaje DOLE; pa ga upeče u video. Ulaz je .deDE.srt ILI video (MKV/MP4) sa ugrađenim nemačkim titlom. Pre rendera prevod pregleda nezavisni podagent translation-critiquer. Koristi se kad korisnik traži "partial prevod", "prevod pri vrhu", "ključne reči uz epizodu", "reči iznad titla", ili da obradi novu epizodu / MKV za učenje nemačkog.
---

# partial-prevod

**Gore** ključne reči sa prevodom, **dole** originalni nemački titl. Namerno se
NE prevodi cela rečenica: smisao treba da se sklopi iz nekoliko ključnih reči.

Sve skripte su u `~/.dsh/skills/partial-prevod/`. Jednom instaliraj
lematizator (bez njega se propušta mnogo više reči):

```bash
pip install simplemma
```

## Kako se radi epizoda — uvek ovim redom

```bash
S=~/.dsh/skills/partial-prevod
cd "<folder epizode>"

# 0. SAMO ako je ulaz video sa ugrađenim titlom (MKV):
python3 $S/izvuci_titl.py --izlaz . "<video>.mkv"   # -> ./<video>.deDE.srt
#    `--izlaz .` je OBAVEZAN kad je video u roditeljskom folderu: bez njega
#    titl ode pored videa, a korak 1 padne na „nema titla" (exit 1).

# 1. dijagnoza: nađe SVE nepoznate reči i upiše ih kao prazna polja
python3 $S/dijagnoza.py "<naziv>.deDE.srt"     # -> lexikon_dodaci.json + transkript.md

# 2. PROČITAJ transkript.md (ceo titl u redosledu, ~6K tokena) — radnja, likovi,
#    elipse („Pass!”), idiomi koji se ponavljaju. PA popuni svako prazno polje
#    u lexikon_dodaci.json (vidi „Popunjavanje”)

# 3. generiši titl
python3 $S/generate_partial_srt.py "<naziv>.deDE.srt"

# 4. QA kapija — mora da kaže "OK — sme render." (izlazni kod 0)
python3 $S/proveri_prevod.py "<naziv>.deDE.srt"
#    ako nije OK: popravi lexikon_dodaci.json, pa ponovo 3 i 4

# 5. NEZAVISNA KRITIKA (vidi „Kritika”)
python3 $S/paket_za_kritiku.py "<naziv>.deDE.srt"   # -> kritika_paket.md
#    pozovi podagenta translation-critiquer -> on napiše kritika.json
python3 $S/primeni_kritiku.py .
python3 $S/generate_partial_srt.py "<naziv>.deDE.srt"
python3 $S/proveri_prevod.py "<naziv>.deDE.srt"     # opet mora OK

# 6. PREGLED SVIH PRIKAZANIH PAROVA (vidi „Pregled pre rendera”) — pa tek onda render
# 7. sačuvaj dodatke u trajni rečnik
python3 $S/sacuvaj_recnik.py . --obrisi

# 8. render preko burn-subtitle (vidi „Render”); MKV se NE konvertuje prethodno
```

**Nikad ne renderuj pre nego što korak 4 kaže OK i korak 6 prođe.** Svaka promena
rečnika posle rendera znači bačen render od nekoliko minuta. `proveri_prevod.py`
takođe javlja ako je rečnik menjan posle generisanja.

**Redosled je obavezan:** kritika → regenerate → QA → pregled parova → render.
U epizodi 1 je render startovan pre pregleda, pa je pokvaren unos
(`das Grimoire = knjiga čini`) otkriven u toku rendera — render je ubijen na 1%
i ceo posao je ponovljen.

### Dve greške koje se ponavljaju u svakoj epizodi (exit 1)

1. **`FileNotFoundError` / „nema titla” u koraku 1** — titl je izvučen **pored
   videa**, a ne u folder epizode (tipično kad .mkv stoji u roditeljskom folderu
   sezone). Rešenje: `izvuci_titl.py --izlaz . "<video>.mkv"`, ili posle
   izvlačenja `mv "<ispisani put>" .`. Dijagnoza sada sama ispiše najbliže
   `.srt` fajlove i tačan `mv` — ne pogađaj ime iznova.
2. **`KeyError: 'STOP'`** kad skripta piše `d["STOP"].append(...)` — stariji
   skelet nije imao `STOP`/`NIJE_KOGNAT`. Novi skelet ih uvek upisuje; ako
   naiđeš na stari, koristi `d.setdefault("STOP", [])`.

Ne patch-uj `generate_partial_srt.py` da bi dodao reč — rečnik je samo u
`lexikon.json` (trajni) i `lexikon_dodaci.json` (epizoda).

## Popunjavanje `lexikon_dodaci.json`

`dijagnoza.py` upiše svaku nepoznatu reč kao osnovni oblik sa praznim prevodom,
a u `_kontekst` stavi oblike iz titla i **okno od tri rečenice** (prethodni blok,
rečenica sa rečju, sledeći blok). Uz to napiše `transkript.md` — ceo titl u
redosledu.

**Prvo pročitaj `transkript.md`**, pa popunjavaj. Tako se rešava ono što se iz
jedne rečenice ne vidi: elipsa (`Pass!` bez `auf`), ko je lik (ide u `NAMES`),
i isti idiom u više scena — koji mora svuda imati isti prevod.

```json
{"LEX": {"mut": "", "aufschlagen": "", "carlo": ""},
 "_kontekst": {"mut": "Mut | «…» | ⏵ Der Mut verlässt mich. | ⏴ «…»", "...": "..."},
 "SKIP": {}, "STOP": [], "NAMES": [], "NIJE_KOGNAT": []}
```

Skelet **uvek** sadrži `SKIP` (rečnik), `STOP`, `NAMES` i `NIJE_KOGNAT`
(liste) — dijagnoza ih upiše i kad su prazne. Ako ipak pišeš svoju skriptu
za popunjavanje, koristi `d.setdefault("STOP", [])` umesto `d["STOP"]`:
`d["STOP"]` na starijem skeletu pada na `KeyError: 'STOP'` (exit 1).

Za **svaki** ključ uradi tačno jedno:

| reč je… | uradi | primer |
| --- | --- | --- |
| obična reč (najčešće) | upiši prevod | `"mut": "der Mut = hrabrost"` |
| odvojivi glagol | infinitiv = prevod | `"aufschlagen": "aufschlagen = otvoriti (knjigu)"` |
| ime lika / mesta | obriši iz LEX, dodaj u `NAMES` | `"NAMES": ["carlo"]` |
| internacionalizam / kognat | obriši iz LEX, dodaj u `SKIP` **sa blizancem** | `"SKIP": {"kathedrale": "katedrala"}` |
| uzvik, mucanje, odsečen deo reči | obriši iz LEX, dodaj u `STOP` | `"STOP": ["argh", "huch", "grimo"]` |

Ključ je osnovni oblik (lematizator već svodi `verlässt → verlassen`,
`Angriffe → Angriff`), pa **ne dodaji padeže i vremena posebno**. Ključ ne
menjaj: kad osnova nije pouzdana, dijagnoza namerno ostavi oblik iz titla
(`stählen`, ne `stehlen`).

**Prevodi po značenju iz `_kontekst`**, ne po prvom značenju iz rečnika:
`einholen` u „ich hole dich ein” je *sustići*, ne *pribaviti*. Ako reč ima dva
česta značenja, napiši oba: `einholen = sustići / pribaviti`. Idiom piši kao
ceo izraz: `"quere": "in die Quere kommen = stati na put"`.

Zaštita (u generatoru, QA i čuvanju) **odbija**:
- prazno polje ili prevod sa zapetom (alternative pišu se sa ` / `);
- `SKIP` bez blizanca ili sa nesličnim blizancem (`"geduldig": "strpljiv"` se
  odbija — to nije kognat, to se prevodi);
- `A1` reč koja nije oblik osnovne A1 liste;
- `STOP` / `NAMES` za reč koja već ima prevod u `LEX`.

Ne pokušavaj da zaobiđeš odbijanje — odbijena reč je reč koju treba prevesti.
Cilj je da posle koraka 4 piše `NEPOZNATO: 0` zato što je sve **prevedeno**, a
ne zato što je sakriveno.

## Pravila za prevod

- **Imenice uvek sa članom:** `der Armreif`, `die Entscheidung`, `das Fieber`.
- **Predlozi sa padežom:** `an = na / pri (Dativ/Akk.)` — padež je ono što je teško.
- **Glagoli:** infinitiv; povratni sa `sich` (`sich verlieben = zaljubiti se`).
- **Odvojivi glagoli** se upisuju kao ceo infinitiv (`aufhören`, `mitkommen`).
  Generator sam spaja `hört … auf` i prikaže `aufhören = prestati (hört … auf)`;
  čestica se tada **ne** prikazuje kao predlog.
- **Složenice** mogu dobiti objašnjenje: `endgültig = konačan (End + gültig)`.
- **Nikad zapeta u prevodu** — zapeta razdvaja stavke u redu.
- **Imena se ne prevode**; funkcijske reči i modalni glagoli su u `STOP`.
- **Padežni oblik** navedi kad menja značenje: `einiger = izvestan (Gen.)`.

### Šta se namerno ne prikazuje

- **A1** (osnovna lista u skripti, zaključana): brojevi, boje, osnovno vreme,
  porodica, svakodnevne stvari, osnovni glagoli i pridevi. Početnik ih zna.
- **SKIP**: reči skoro iste kao srpske/engleske (`Problem`, `Methode`, `direkt`).
- **Lažni prijatelji se UVEK prevode**, nikad u SKIP: `eventuell` (možda),
  `Personal` (osoblje), `Gift` (otrov), `Paradies` (raj), `Art` (vrsta),
  `aktuell` (trenutni).
- Ista reč se ne ponavlja u 6 uzastopnih blokova (osim ako bi blok ostao prazan).

Prazni blokovi su u redu kad su trivijalni (`Hm?`, `Was?`, `Danke.`, `Myne!`).

### REFL i CASE_NOUNS

- `REFL` važi samo kad je u bloku reč `sich`: `sich erfreuen = uživati (Gen.)`
  vs. obično `erfreuen = obradovati`. Za glagole čije se značenje menja uz `sich`.
- `CASE_NOUNS` važi samo za reč velikim slovom: `Widerstand = otpor` vs.
  `widerstand` (od `widerstehen`).

## Kritika (nezavisni podagent)

Glavni agent ne ocenjuje sopstvene prevode — pregleda ih **drugi agent**, koji
vidi samo rečenice i prikazane stavke. Tako se hvataju greške koje QA ne može:
pogrešno značenje u kontekstu (`einholen = pribaviti` gde treba *sustići*),
glagol prikazan kao imenica, pogrešno spojen odvojivi glagol, propuštena reč.

1. `paket_za_kritiku.py` napiše `kritika_paket.md` (samo podaci, **u redosledu
   epizode** — blokovi bez prevoda su označeni u mestu, ne na kraju).
2. Pokreni podagenta **translation-critiquer** isključivo alatom `subagent`
   (sa `run_in_background: false`).
   > **Nikad `subagent_fork`** — fork nosi kontekst glavne sesije (istoriju i
   > razmišljanje glavnog agenta), pa kritika ne bi bila nezavisna.

   **Kritičar ide na isti model kao i glavna sesija** (model koji je pokrenuo
   ovog podagenta). U praksi to znači: ne navodi `provider`/`model`/`reasoning_effort`
   u pozivu `subagent` — podagent nasleđuje rutu sesije. Ne pokušavaj da ga
   prebaciš na drugi model iz skilla: ruta van sesije se odbija („child LLM route
   … is not allowed for this Session"), a i mimoišla bi nameru nadređenog izbora.
   Ako korisnik želi drugi model za kritiku, menja se **ceo sesijni model**
   (glavni agent + kritičar zajedno), ne samo kritičar.

   Ako ipak moraš da navedeš `reasoning_effort`, proveri sa
   `list_subagent_models` koje rute su dozvoljene; model van nje → `subagent`
   pada, i gubiš vreme. Bez izbora u pozivu, effort se nasleđuje od glavne
   rute (ako pripadaju istoj ruti; nije isto kad dete ima drugu rutu).

   Zašto: u epizodi 1 je kritičar slučajno pokrenut na `gemini-flash-lite` i vratio
   praznu kritiku (`pregledano: 427, grešaka: 0`) — lažni prolaz. Bez izbora,
   kritičar sledi **rutu sesije** i tu grešku više ne može da napravi: ruta je
   ili ista kao glavna ili je nema (pa `subagent` javi grešku odmah, ne tiho).

   DSH nema registar imenovanih podagenata — ime se ne poziva, nego se
   definicija **prenosi kao uputstvo**:
   - Pročitaj `~/.dsh/skills/partial-prevod/agents/translation-critiquer.md`.
   - Prompt podagenta = ceo sadržaj tog fajla (bez `---` frontmattera) + na kraju
     > Pregledaj `<pun put foldera>/kritika_paket.md` i napiši `kritika.json` u isti folder.

   **Ne šalji mu svoje obrazloženje ni listu reči koju si dodao** — pregled
   mora biti nezavisan.
   `primeni_kritiku.py` odbija praznu kritiku na paketu ≥50 blokova (izlaz 2);
   prazno se prihvata samo svesno, sa `--prihvati-prazno`.
3. `primeni_kritiku.py .` upiše ispravke u `lexikon_dodaci.json` (ista pravila
   kao za ostale dodatke; loše ispravke odbije). Ispravke STARIH reči važe odmah.
4. Regeneriši i ponovo `proveri_prevod.py`. **Jedan krug kritike je dovoljan** —
   ne pozivaj kritičara ponovo osim ako korisnik traži.
5. `napomene` iz kritike (idiomi, sumnje) ukratko prenesi korisniku.

Posle toga obriši `kritika_paket.md` i `kritika.json`.

## Pregled svih prikazanih parova (pre rendera)

Kritika hvata značenje u kontekstu, ali ne i **đubre u rečniku** koje se ponavlja.
Zato pre rendera prođi kroz sve parove koje titl prikazuje:

```bash
# jedinstveni parovi iz generisanog titla
python3 - <<'EOF'
import re
p=set()
for l in open("partial-prevod.srt",encoding="utf-8"):
    if "{\\an8}" not in l: continue
    for d in l.split("{\\an8}",1)[1].split("\n")[0].split(", "):
        if " = " in d: p.add(d.strip())
print(len(p),"parova"); print("\n".join(sorted(p)))
EOF
```

Prijavi/ispravi: par gde nemački deo nije nemački ili je isečen (`= knjiga čini`),
duplikat istog ključa sa različitim prevodom, i prevod koji očigledno nije srpski.
U epizodi 1 je `das Grimoire = knjiga čini` (treba *magična knjiga*) otkriven tek
posle starta rendera — otud pravilo da render ide **posle** ovog pregleda.

Ne menjaj tu ništa „stilski" — samo očigledne greške i đubre. Ako menjaš rečnik,
ponovi korake 3, 4 i ovaj pregled.

## Kognati

`proveri_prevod.py` traži prikazane parove gde je nemačka reč praktično ista kao
srpska (`die Kathedrale = katedrala`, `die Audienz = audijencija`,
`registrieren = registrovati`). Za svaki:
- pravi kognat → u `SKIP` kao `{"kathedrale": "katedrala"}`;
- liči, ali vredi učiti → u `"NIJE_KOGNAT": ["reč"]`.

## Raspored (generator to radi sam)

- Najviše 4 stavke u redu i ~84 znaka; višak otvara **novi red** (do 8).
  Nijedna reč se ne odbacuje; red preko 84 znaka libass prelomi — prihvatljivo.
- Prvo sadržajne reči redom pojavljivanja, pa najviše jedan predlog po redu.
- ASS ima dva stila: `Vocab` (Alignment 8 = gore) i `Default` (2 = dole).
  SRT izlaz koristi `{\an8}` za reči. **Ne koristi `force_style=Alignment=…`** —
  pomera i dijalog na vrh.

## Ulaz iz MKV-a

`izvuci_titl.py` bira traku sam: tekstualni titl (subrip/ass/webvtt), jezik
`ger/deu/de` ili naslov „Deutsch”, prednost pun titl (ne „forced”/„Signs”),
pa onaj sa najviše blokova. Prvo pogledaj šta je izabrao.

- `--lista` samo ispiše trake; `--traka N` bira N-tu titl-traku (`s:N`).
- `--izlaz DIR` piše titl u DIR (npr. `--izlaz .`). Bez njega titl ide **pored
  videa** — ako video stoji u roditeljskom folderu, korak 1 ga neće naći.
- Ako javi malo blokova (< 80) — verovatno je „forced” traka; proveri `--lista`.
- **Slikovni titl (PGS/VobSub) ne može** — to su slike. Skripta to kaže; tada
  treba spoljni `.deDE.srt` ili OCR na računaru (Subtitle Edit).
- ASS tagovi (`{\an8}`, `{\pos(..)}`) iz ugrađenog titla se čiste pre obrade.

## Render — preko skilla burn-subtitle

Render radi `burn.py` iz skilla **burn-subtitle**, direktno iz MKV-a ili MP4-a.
MKV se **ne** konvertuje prethodno u MP4 — to bi samo dupliralo vreme.

```bash
B=~/.dsh/skills/burn-subtitle/burn.py
python3 $B -i "<video>" -s partial-prevod.ass -o "NN-sub-burnt-vocab.mp4" --pozadina
python3 $B --status "NN-sub-burnt-vocab.mp4"   # na 60 s, dok ne piše GOTOVO
python3 $B --stop   "NN-sub-burnt-vocab.mp4"   # ako mora da se prekine (npr. greška u rečniku)
```

`--pozadina` je obavezno (inače alat prekine render na 60 s). Status proveravaj
**na 60 s**, ne na 20 — svaki poll vraća liniju u kontekst, a render 24-min epizode
traje ~14 min. `--stop` ubija i ffmpeg dete (process group), pa posle njega ne
ostaje zaostali proces. `burn.py` uzima **englesku** audio traku, pravi 8-bitni
H.264 sa zvukom koji TV pušta i daje fajlu konačno ime tek kad prođe proveru
trajanja. Ako ispiše `UPOZORENJE: nema audio jezika 'eng'`, javi korisniku koja
je traka uzeta. Opcije i detalji: SKILL.md skilla burn-subtitle.

## Provera kadra — samo kad treba

Samo ako si menjao stilove/pozicije, ili korisnik prijavi problem. Tekstualni
QA pokriva ostalo. Na gotovom MP4 titl je deo slike, pa je brzo:

```bash
ffmpeg -y -v error -ss 00:10:43 -i "NN-sub-burnt-vocab.mp4" -frames:v 1 -threads 1 -f image2 provera.png
```

## Kad korisnik prijavi da neka reč fali

1. `python3 $S/dijagnoza.py "<naziv>.deDE.srt" --bez-upisa` i nađi blok.
2. Ako je reč u spisku NEPOZNATO → popuni je (i sve ostale prazne odjednom).
3. Ako nije na spisku, a ne prikazuje se → proveri da nije pogrešno u
   `A1`/`SKIP`/`STOP`/`NAMES` u `lexikon.json` i izbaci je odatle; ili je
   ponovljena u prethodnih 6 blokova (namerno).

U folderu epizode na kraju ostaju samo: `partial-prevod.srt`, `partial-prevod.ass`,
`NN-sub-burnt-vocab.mp4`. Privremene fajlove (testovi, kadrovi) obriši.
