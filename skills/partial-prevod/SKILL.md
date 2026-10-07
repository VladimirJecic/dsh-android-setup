---
name: partial-prevod
description: Izdvaja do 4 ključne nemačke reči po redu (imenice sa članom der/die/das, glagole, prideve i predloge) iz titla, prevodi ih na srpski i pravi SRT/ASS gde prevod stoji pri VRHU videa a originalni nemački titl ostaje na dnu — za učenje nemačkog uz gledanje. Koristi se kada korisnik traži "partial prevod", "prevod pri vrhu", "ključne reči uz epizodu" ili "reči iznad titla".
---

# `partial-prevod` Skill

Pravi dvojezični titl za učenje nemačkog: **gore** idu ključne reči sa prevodom,
**dole** ostaje originalni nemački titl. Tako pratiš epizodu i učiš reči iz onoga
što se upravo čuje.

**Namerno se NE prevodi cela rečenica.** Cilj je da mozak sam sastavi smisao iz
nekoliko ključnih reči — ako je sve prevedeno, čitaš srpski i ne naučiš ništa.

## Ulaz / izlaz

- Ulaz: `<naziv>.deDE.srt` u folderu epizode.
- Izlaz: `partial-prevod.srt` (prenosiv, sa `{\an8}`), `partial-prevod.ass`
  (za burn-in) i na kraju `NN-sub-burnt-vocab.mp4`.

### Skripte (sve u `~/.dsh/skills/partial-prevod/`)

| skripta | radi |
| --- | --- |
| `generate_partial_srt.py` | pravi `.srt` i `.ass`; učitava i `lexikon.json` |
| `dijagnoza.py` | prazni blokovi + nepoznate reči + učestalost, jedan poziv |
| `proveri_prevod.py` | QA pre rendera: raspored, širine, **kognati** |
| `sacuvaj_recnik.py` | spaja epizodne dodatke u trajni `lexikon.json` |

Ceo recept i vremenski budžet su u sekciji **„Kako se radi epizoda"** na kraju.

## Postupak

1. Nađi `.deDE.srt` u folderu epizode.
2. Pokreni generator:

   ```bash
   cd "<folder epizode>"
   python3 ~/.dsh/skills/partial-prevod/generate_partial_srt.py \
       "<naziv>.deDE.srt" partial-prevod
   ```

3. Skripta na kraju ispiše blokove **bez** ključne reči. Ako su to bitne
   rečenice, dopuni `LEX` / `PREP` i pokreni ponovo. Trivijalne replike
   (`Mhm.`, `Was?`, `Hm?`, `Bald …`) je u redu ostaviti prazne.
4. Upeci titl preko **`burn-subtitle`** skilla (obavezno u pozadini!):

   ```bash
   ffmpeg -y -i "<video>.mp4" -vf "ass=partial-prevod.ass" \
     -c:a copy -c:v libx264 -preset ultrafast -crf 23 \
     "11-sub-burnt-vocab.mp4"
   ```

5. Proveri trajanje (`ffprobe` — mora biti isto kao ulaz) i izvuci kadar da
   vidiš da je prevod pri vrhu.

## Pravila za reči

- **Do 4 reči po redu.** Nikad više.
- **Drugi red** (opet do 4 reči) samo po pravilu ispod — prati prelamanje
  izvornog titla. U ASS-u su oba reda u **istom** `Vocab` eventu, razdvojena
  sa `\N`; `\N` se nikad ne koristi da spoji reči i dijalog.
- **Imenice uvek sa članom:** `der Armreif`, `die Entscheidung`, `das Fieber`.
- **Glagoli su često važniji od imenica** — `retten = spasiti` pre sporedne imenice.
- **Pridevi obavezno** — `fähig = sposoban`, `labil = nestabilan`.
- **Predlozi obavezno**, sa padežom koji traže: `an = na / pri (Dativ/Akk.)`.
  Padež je ono što je kod nemačkih predloga zaista teško, pa ide uz svaki.
- Redosled: **najpre sadržajne reči** (imenice, glagoli, pridevi) u redu
  pojavljivanja, pa **najviše jedan predlog po redu** u preostali prostor — da
  predlozi ne potisnu sadržajne reči.
- **Imena likova se ne prevode** (`Myne`, `Benno`, `Frieda`, `Lutz`, `Tuuli`, `Ilse`).
- **Funkcijske reči se ne prevode** (`ich`, `du`, `das`, `ist`, `und`, `nicht` …).
  Modalni glagoli (`kann`, `will`, `muss`) su u `STOP` — previše su česti i
  nose malo značenja.
- Ista reč se ne ponavlja unutar ~6 uzastopnih blokova; ako od toga ostane prazan
  red, drugi prolaz u `key_words` ignoriše to ograničenje.
- Složenice i kolokacije dobijaju objašnjenje u zagradi, npr.
  `endgültig = konačan (End + gültig = važeći do kraja)`.

## Ne prevodi ono što je isto kao u srpskom ili engleskom (SKIP)

Ako je nemačka reč praktično ista kao srpska ili engleska, njeno prevođenje ne
uči ništa i troši jedno od četiri mesta. Takve reči idu u `SKIP` i nikad se ne
prikazuju: `direkt`, `total`, `komplett`, `normal`, `fantastisch`, `Methode`,
`Problem`, `Moment`, `Minute`, `Option`, `Aktivität`, `Investition`, `Chance`,
`Rolle`, `Job`, `simpel`, `divers`, `Magie`, `magisch*`, `Medizin`, `Papier`,
`Metall`, `Glas`, `Kugel`, `Dame`, `Name`, `Hand`, `Familie`, `interessieren`,
`Idee`, `Plan`, `Test`, `Engel`, `Gott`, `Papa`, `Mama`.

Kad dodaš reč u `SKIP`, slobodno mesto odmah ide sledećoj sadržajnoj reči ili
predlogu — npr. `Verscheuch Myne nicht direkt wieder.` posle sklanjanja
`direkt` prikazuje `verscheuchen = oterati (imperativ), wieder = ponovo`.

**Ne stavljaj u `SKIP`** reči koje su lažni prijatelji ili gde veza nije
očigledna (`Paradies` = raj, ne „paradajz“; `Gift` = otrov, ne „dar“).

### Kognati koje je lako prevideti — pusti skriptu

Ručno se stalno propusti po neka reč koja se „sama prevede“: `die Bibliothek` =
*biblioteka*, `der Ministrant` = *ministrant*, `kontaktieren` = *kontaktirati*,
`die Audienz` = *audijencija*, `die Kathedrale` = *katedrala*, `die Probe` =
*proba*, `der Kompromiss` = *kompromis*. U epizodi 13 su tako **pet** kognata
prošla u prikaz i tek ih je skripta našla. Zato posle svake generacije pusti:

```bash
cd "<folder epizode>"
python3 - <<'EOF'
import re
items = set()
for b in open("partial-prevod.srt", encoding="utf-8").read().strip().split("\n\n"):
    if "{\\an8}" not in b:
        continue
    for r in b.split("\n", 2)[2].replace("{\\an8}", "").split("\\N"):
        for it in r.split(", "):
            if " = " in it:
                items.add(it)
def norm(x):
    return re.sub(r"[^a-zäöüß]", "", x.lower())
for it in sorted(items):
    de, sr = it.split(" = ", 1)
    de = re.sub(r"^(der|die|das|sich)\s+", "", de)
    sr0 = re.split(r"[ /(]", sr)[0].strip()
    d, s = norm(de), norm(sr0)
    if len(d) < 4 or len(s) < 4:
        continue
    k = 0
    while k < min(len(d), len(s)) and d[k] == s[k]:
        k += 1
    if k >= max(4, int(0.7 * min(len(d), len(s)))):
        print("  ", it)
EOF
```

Sve što skripta ispiše ide u `SKIP` (osim ako je lažni prijatelj). Posle toga
**regeneriši i ponovo upeci** — skripta ne menja samo prikaz nego i to koji
blok uopšte ima prevod.

## Ne prevodi A1.1 osnove (A1)

Pored internacionalizama, preskaču se i reči koje početnik već zna — njihovo
prevođenje ne uči ništa. U `A1` su:

- **brojevi** — `eins`, `zwei`, `drei` … `hundert`, `tausend`, `erste`, `halb`
- **boje** — `rot`, `blau`, `grün`, `gelb`, `schwarz`, `weiß`, `grau`, `braun`,
  `rosa`, `lila`, `hell`, `dunkel`
- **vreme** — `Tag`, `Nacht`, `Woche`, `Monat`, `Jahr`, `Stunde`, `heute`,
  `gestern`, `immer`, `nie`, `oft`, `jetzt`, `dann`
- **ljudi i porodica** — `Vater`, `Mutter`, `Schwester`, `Bruder`, `Kind`,
  `Freund`, `Großvater`, `Mann`, `Leute`
- **svakodnevne stvari** — `Wasser`, `Brot`, `Milch`, `Zucker`, `Butter`,
  `Eier`, `Kuchen`, `Haus`, `Tür`, `Fenster`, `Tisch`, `Bett`, `Zimmer`,
  `Buch`, `Stadt`, `Kopf`, `Herz`, `Licht`
- **osnovni glagoli** — `sein`, `haben`, `gehen`, `kommen`, `machen`, `sagen`,
  `sehen`, `essen`, `trinken`, `schlafen`, `lesen`, `schreiben`, `lernen`,
  `arbeiten`, `spielen`, `kaufen`, `geben`, `nehmen`, `finden`, `denken`,
  `glauben`, `verstehen`, `helfen`, `warten`, `bleiben`, `werden`, `stehen`,
  `sitzen`, `liegen`, `bringen`, `hören`
- **osnovni pridevi i prilozi** — `gut`, `schlecht`, `groß`, `klein`, `neu`,
  `alt`, `jung`, `schön`, `warm`, `kalt`, `schnell`, `langsam`, `viel`,
  `wenig`, `lang`, `kurz`, `leicht`, `schwer`, `stark`, `schwach`, `voll`,
  `leer`, `offen`, `frei`, `richtig`, `falsch`, `hier`, `dort`, `sehr`

Rezultat: u epizodi 11 sa **329** blokova sa prevodom spalo se na **260**, u
epizodi 12 sa **319** na **258**, a u epizodi 13 sa **341** na **279** — ali
prikazane reči su sada one koje zaista vredi učiti (`Zerfressung`,
`Übereinkommen`, `Widerstand`, `beurteilen`, `fähig`, `schleichend`,
`Funktionstüchtig`, `Überlebenschance`, `Haarschmuck`, `Bürgerrecht`,
`Auffassungsgabe`, `Lebensunterhalt`, `Säuberung`), umesto `das Buch`, `drei`,
`die Milch`.

Ostatak bez ijedne reči su uglavnom trivijalne replike (`Hm?`, `Was?`,
`Danke.`, `Myne!`, `Okay.`) — to je u redu i ne treba ih popunjavati.

**Ne stavljaj u `A1`** reči koje su lažni prijatelji ili gde veza nije očigledna
(`Paradies` = raj, ne „paradajz“; `Gift` = otrov, ne „dar“).

## Kada korisnik prijavi da neka reč fali

Ne dodavaj samo tu jednu reč. Prvo pusti analizu učestalosti da vidiš **sve**
rupe odjednom, pa dopuni u jednom prolazu:

```bash
cd "<folder epizode>"
python3 - <<'EOF'
import re, collections, importlib.util
spec = importlib.util.spec_from_file_location(
    "g", "/data/data/com.termux/files/home/.dsh/skills/partial-prevod/generate_partial_srt.py")
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

raw = open("<naziv>.deDE.srt", encoding="utf-8").read()
texts = [re.sub(r"<[^>]+>", "", " ".join(b.split("\n")[2:]))
         for b in raw.strip().split("\n\n")
         if len(b.split("\n")) >= 3 and "-->" in b.split("\n")[1]]

known = set(g.LEX) | set(g.PREP) | set(g.NAMES) | set(g.STOP) | set(g.CASE_NOUNS)
known |= set(g.REFL) | set(g.A1) | set(g.SKIP)
miss = collections.Counter(
    w.lower() for t in texts for w in re.findall(r"[A-Za-zÄÖÜäöüß]+", t)
    if w.lower() not in known and len(w) >= 4)
for w, c in miss.most_common(90):
    print(c, w)
EOF
```

Jalova lista je korisna, ali **presudna je lista praznih blokova koju ispiše sam
generator** — ona pokazuje šta je zaista ostalo bez prevođenja. Za svaki prazan
blok vredi pogledati zašto je prazan: ako su sve reči u njemu A1/STOP, tako i
treba da ostane; ako je neka reč nepoznata, ona ide u `LEX`.

**Ne dodavaj reč samo zato što je nepoznata.** U epizodi 12 je 402 nepoznate
reči, a korisnih je bilo ~330; ostatak su bili internacionalizmi
(`Pergament`, `Atelier`, `Kathedrale`, `Medaille`, `Konditionen`,
`monopolisieren`, `registrieren`) koje treba staviti u `SKIP`, i funkcijske
reči (`je`, `welche`, `sondern`, `daher`, `meines`, `ihres`) koje idu u `STOP`.

Na kraju skripta sama ispiše blokove **bez** ijedne reči — i to je lista prioriteta.

## Velika slova nose značenje (CASE_NOUNS)

Nemačke imenice su uvek velikim slovom, pa `widerstand` (glagol, prošlo vreme od
`widerstehen` = odupreti se) i `Widerstand` (imenica = otpor) izgledaju isto kad
se spuste na mala slova. Zato postoji `CASE_NOUNS`: za **veliko** početno slovo
prvo se gleda ta tabela, pa tek onda `LEX`. Dodaj u nju svaki par gde se imenica
i glagol razlikuju samo po velikom slovu (`Blick`, `Leid`, `Recht`, `Teil`,
`Wissen`, `Leben`, `Macht`, `Wagen`, `Weise`, `Gut`, `Sorgen`).

## Drugi red prati izvorni titl

Drugi red se dodaje **samo kad je i izvorni titl prelomljen u dva reda**, ili kad
blok sadrži više od jedne rečenice:

```python
src_rows = len([l for l in lines if l.strip()])   # redovi u .srt bloku
two_rows = count_sentences(text) > 1 or src_rows >= 2
```

Titl u jednom redu ostaje **jedan red od najviše 4 reči** — ekran se ne prekriva
tekstom. U epizodi 11: 182 bloka jedan red, 78 blokova dva reda. U epizodi 12:
168 blokova jedan red, 90 blokova dva reda.

Prva verzija je drugi red vezivala za broj kandidata, što je bilo pogrešno na obe
strane: `total > per_row` je pravilo drugi red i tamo gde izvorni titl ima samo
jedan red, a `len(content) > per_row` ga je izostavljalo tamo gde je trebalo
(četiri imenice napune red pa se `angesichts` izgubi).

Kad je drugi red dozvoljen, on se **ne popunjava obavezno** — nastaje samo ako
ima materijala. Zato je `wonach … unter` i dalje jedan red, a
`… wagen?` + `angesichts` dva.

Primer koji je to otkrio — 15:56, `Wie kannst du dich angesichts eines
Raubtieres schutzlos aus den Büschen wagen?!` — `angesichts` je bio u rečniku,
ali nije imao gde da se prikaže. Sada:

```
das Raubtier = zver, schutzlos = nebranjen, die Büsche = žbunje, wagen = usuditi se
              angesichts = s obzirom na (Genitiv)
```

## Red se prelama i po širini, ne samo po broju reči (MAX_CHARS)

Četiri kratke reči i četiri dugačke reči nisu isti red. Red od ~110 znakova
libass tiho prelomi u **dva vizuelna reda**, pa odozgo prekrije sliku iako je
„samo jedan red". Zato postoji `MAX_CHARS = 84`:

- kad je **dozvoljen samo jedan red**, broji se samo `per_row` — četiri reči se
  prikažu i ako se prelome (bolje prelomljen red nego izgubljena reč);
- kad je **dozvoljen drugi red**, reči se pakuju dok red ne pređe 84 znaka, pa
  ostatak ide u drugi red;
- **ništa se ne sme izgubiti**: ako nijedan red nema mesta unutar budžeta,
  skripta se vraća na staro pakovanje (do 4 reči po redu) umesto da ispusti reč;
- pri tom se prelivanje stavlja u **najprazniji** red, ne u poslednji — tako je
  prekoračenje najmanje moguće (`min(room, key=širina)`);
- predlozi popunjavaju **od poslednjeg reda unazad**, najviše jedan po redu —
  inače predlog skoči u prvi red i istisne sadržajnu reč u drugi.

Ovo je namerna trgovina: nekoliko redova ostane preko 84 znaka i libass ih
prelomi u treći vizuelni red. U epizodi 11 to je 4 reda od 338, u epizodi 12
11 od 348 (najduži 104 znaka) — sve u gornjoj traci, jer dijalog ostaje na dnu.
Prelomljen red je i dalje čitljiv; izgubljena reč nije.

Primer (15:44, `Unter Adeligen erfreut er sich einiger Beliebtheit.`) — četiri
stavke su preširoke za jedan red, pa se drugi red sam otvori:

```
die Adeligen = plemići, sich erfreuen = uživati (Gen.), einiger = izvestan (Gen.)
        die Beliebtheit = popularnost, unter = pod / među (Dativ/Akk.)
```

## Glagoli koji uz `sich` menjaju značenje (REFL)

`erfreuen` samo znači „obradovati“, ali **`sich erfreuen` + genitiv** znači
„uživati nešto“ — pa je u epizodi 11 red `Unter Adeligen erfreut er sich
einiger Beliebtheit.` prikazivao `erfreuen = obradovati`, što navodi na
pogrešan trag. Zato postoji tabela `REFL`, koja **važi samo kad je u istom bloku
stvarno prisutna reč `sich`** (inače bi pokvarila nenamerno značenje, npr.
`Ich bin höchst erfreut` = „izuzetno mi je drago“).

U `REFL` idu glagoli koji traže genitiv ili se ponašaju drugačije uz `sich`:
`sich erfreuen`, `sich erinnern`, `sich annehmen`, `sich enthalten`,
`sich bemächtigen`, `bedürfen`, `gedenken`, `es handelt sich um`.

Epizoda 12 je dodala još jednu grupu — obične povratne glagole kod kojih se bez
`sich` promeni i glagol i smisao: `sich verabschieden` (oprostiti se, a
`verabschieden` samo = ispratiti), `sich verlassen auf` (pouzdati se, a
`verlassen` = napustiti), `sich verlaufen` (zalutati), `sich beruhigen`
(smiriti se), `sich erholen` (odmoriti se), `sich verlieben` (zaljubiti se),
`sich gedulden` (strpeti se), `sich wenden`/`sich zuwenden` (obratiti se),
`sich entscheiden` (odlučiti se), `sich erstrecken` (protezati se),
`sich beraten` (savetovati se), `sich bilden` (obrazovati se), `sich melden`
(javiti se), `sich einmischen` (umešati se).

Kad naiđeš na nov takav glagol, dodaj ga u `REFL` **i** u `kljucne-reci-nemacki`
dokumentaciju — to su konstrukcije koje se ne mogu pogoditi iz pojedinačnih
reči, pa zaslužuju objašnjenje u oba izlaza.

## Padežni oblik se prikazuje kad menja značenje

`einige` je „neki / nekoliko“, ali u genitivu je `einiger` i znači
„izvestan (neke količine)“: `einiger Beliebtheit` = „izvesne popularnosti“.
Kad se u titlu pojavi **padežni oblik** koji se ne poklapa sa osnovnim oblikom
iz rečnika (`einiger`, `dieses Armreifs`, `des Besitzes`), u prikazu navedi
padež — `einiger = izvestan (Gen.)` — jer je upravo padež ono što se u brzom
titlu ne vidi.



`A1` i `SKIP` se moraju proveravati preko **osnovnog oblika** iz rečnika, inače
inflektovani oblici prođu: `gekommen` je u `LEX` zapisan kao `kommen = doći`, a
`kommen` je A1 — pa se i `gekommen` mora preskočiti. Zato `lemma_keys()` vraća
sve moguće osnove (`kommen`, `sich freuen` → `freuen`, `die Milch` → `milch`) i
filter ih proverava zajedno.

## Genitiv i množina se moraju dodati posebno

`lemma_keys()` radi samo **u jednom smeru**: ako je površinski oblik u `LEX`, on
se filtrira po osnovi. Ali ako površinski oblik **nije** u `LEX`, nikakvo
preračunavanje se ne dešava — reč se jednostavno ne prikaže. Zato genitiv
imenice koja nije A1 mora ući u `LEX` eksplicitno: `des Wachstums` → `wachstums`,
`des Standes` → `standes`, `des Verbandes` → `verbandes`, `der Kräfte` →
`kräfte`. Isto važi za množinu (`die Belange`, `die Fähigkeiten`,
`die Umstände`, `die Einbrüche`) i za padežne oblike prideva (`rechtmäßiges`,
`geschäftige`, `diesjährigen`).

Kod A1 imenica to nije problem — njihov genitiv (`Feuers`, `Wassers`, `Lichtes`,
`Tages`) nema `LEX` zapis, pa se sam preskoči. Ali kad u `LEX` ipak dodaš
inflektovan oblik A1 reči, osnovu stavi u `A1`: u epizodi 12 su tako dodati
`neues`, `neue`, `neuer`, `lange`, `vollen`, `komm`, `komme`, `finde`,
`denkst`, `kaufe`, `stelle`, `sieh`, `sagst`, `seht`, `nahmen`, `brauchte`,
`falschen`, `beste`, `besser`, `sprachen` — inače bi se pojavili kao „ključne
reči“ iako ih početnik zna.

## Kako se radi epizoda — ceo recept

Rečnik se **od epizode 13 ne patch-uje**. Dodaci idu u JSON koji generator sam
učita, pa nema više orijentira koji se pomeraju, `.bak` kopija ni ponovnog
čitanja skripte.

```bash
EP="episode 13"                                  # folder epizode
SRT="$EP/<naziv>.deDE.srt"
GEN=~/.dsh/skills/partial-prevod

# 1. DIJAGNOZA — prazni blokovi + nepoznate reči + učestalost (jedan poziv)
python3 $GEN/dijagnoza.py "$SRT"

# 2. napiši "$EP/lexikon_dodaci.json" sa novim rečima (samo podaci)
#    i generiši titl
python3 $GEN/generate_partial_srt.py "$SRT" partial-prevod

# 3. QA — prazni blokovi, raspored redova, širine, KOGNATI
python3 $GEN/proveri_prevod.py partial-prevod.srt
#    ako ima kognata/praznina -> dopuni JSON, ponovi 2 i 3

# 4. dodatke prebaci u trajni rečnik i pokreni render (pozadina!)
python3 $GEN/sacuvaj_recnik.py . --obrisi
ffmpeg -y -i "<video>.mp4" -vf "ass=partial-prevod.ass" \
  -c:a copy -c:v libx264 -preset ultrafast -crf 23 "13-sub-burnt-vocab.mp4"
```

Format `lexikon_dodaci.json` (svi ključevi opcioni):

```json
{"LEX": {"waisen": "die Waise = siroče"},
 "REFL": {"verirrte": "sich verirren = zalutati"},
 "CASE_NOUNS": {"band": "das Band = veza"},
 "PREP": {"aufs": "aufs = na (auf das)"},
 "SKIP": ["gral"], "A1": ["lange"], "STOP": ["je"], "NAMES": ["carlo"]}
```

`sacuvaj_recnik.py` ih spaja u `~/.dsh/skills/partial-prevod/lexikon.json`,
koji se učitava za **svaku** sledeću epizodu — tako rečnik raste bez patch-a.

### Vremenski budžet

| korak | traje |
| --- | --- |
| dijagnoza + pisanje dodataka + generisanje + QA | ~1 min |
| **ffmpeg** | **~3 min** |
| `.md` (piše se dok ffmpeg radi) | 0 min dodatno |

**~3 minuta od toga je sam ffmpeg i tu nema uštede** — `h264_mediacodec` je na
ovom uređaju *sporiji* od `libx264 -preset ultrafast` (10 s prema 6,8 s za isti
isečak od 60 s), jer je usko grlo dekodiranje i `ass=` filter, ne enkodiranje.
Sve ostalo je svedeno na nekoliko poziva.

**Ne proveravaj kadrove rutinski.** Kadar izvlači samo ako:
- si menjao pozicioniranje ili stilove (`Alignment`, `MarginV`, `MAX_CHARS`),
- korisnik prijavi da nešto ne izgleda dobro,
- radiš nov tip bloka prvi put.

Tekstualna provera iz `proveri_prevod.py` pokriva sve što bi kadar pokazao
(broj redova, širina, broj stavki), a traje sekundu umesto minuta. Provera
kadrova je u epizodi 13 pojela ~5 minuta i **ništa nije našla**.

**Nikad ne renderuj pre koraka 3.** U epizodi 13 je render pokrenut pre cognate
provere, pa je posle otkriveno pet kognata i **ceo render od 3 minuta je
bačen**. Redosled je uvek: dijagnoza → dodaci → generisanje → QA → render.

**Ne pravi privremene fajlove po epizodi.** `genNN.txt`, `before.srt`,
`test_*.mp4` i `provjera_*.png` se brišu odmah; u folderu epizode ostaju samo
izlazi (`partial-prevod.srt/.ass`, `NN-sub-burnt-vocab.mp4`, `.md`).

## Pozicioniranje (ključni deo)

1. **SRT sa `{\an8}`** — ASS override tag koji libass poštuje. Dva odvojena SRT
   eventa sa istim vremenom: `{\an8}` za reči, običan za dijalog.
2. **ASS sa dva stila** (pouzdanije, koristi ovo za burn-in):

   ```
   Style: Vocab,DejaVu Sans,17,...,1,2,1,8,40,40,12,1
   Style: Default,DejaVu Sans,24,...,1,2,1,2,25,25,24,1
   ```

   `Alignment=8` = **gore centrirano** (MarginV meri od vrha).
   `Alignment=2` = dole centrirano (MarginV meri od dna).
   `MarginL/R=40` da dug red ne dodiruje ivicu nego se prelomi.
   `BorderStyle=1`, `Outline=2`, `Shadow=1` — da se vidi i na svetloj sceni.

**Ne koristi `force_style='Alignment=6'` za ceo titl** — to pomera i nemački
dijalog na vrh, pa se oba teksta preklope. Dijalog mora ostati na dnu.

## Zamke

- Generator piše **dva** eventa po titl-bloku (reči + dijalog) — namerno, da bi
  bili na različitim stranama ekrana.
- Ako je ffmpeg pokrenut sinhrono, alat ga ubije na 60 s i ostane fajl od 2–3 min.
  **Uvek pozadina** (vidi `burn-subtitle`).
- **`-ss` PRE `-i` resetuje vremensku osu titlova** — probni kadar tada prikazuje
  pogrešan titl. Za proveru stavi `-ss` POSLE `-i` (ili koristi `-copyts`).
- Ako u kadru fali glagol ili predlog, proveri da li je taj inflektovani oblik u
  `LEX` odnosno `PREP` — to je najčešći uzrok.
- **Zatvarajuća vitičasta zagrada `LEX`-a nije stabilan orijentir za patch.**
  Svaki novi patch ubacuje redove *ispred* nje, pa se `"tausend": "tausend =
  hiljada",\n}` pokvari čim jednom patch-uješ. Koristi sam red bez zagrade:

  ```python
  anchor = '    "tausend": "tausend = hiljada",\n'   # stabilno
  src = src.replace(anchor, anchor + lines, 1)
  ```

  Isto važi i za ostale tabele: orijentiši se na **poslednji poznati zapis**, a
  ne na granicu strukture.
- **Izvlačenje probnog kadra ume da pukne na mjpeg enkoderu** (`ff_frame_thread_encoder_init failed`,
  `Non full-range YUV is non-standard`) i tada ffmpeg visi do timeout-a. Tada
  ide PNG sa jednom niti:

  ```bash
  ffmpeg -y -v error -i out.mp4 -ss 00:10:43 -frames:v 1 -threads 1 -f image2 provera.png
  ```
