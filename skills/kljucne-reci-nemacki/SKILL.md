---
name: kljucne-reci-nemacki
description: Izdvajanje ključnih reči i fraza iz nemačkih titlova epizoda sa primerima rečenica, prevodom primera, značenjem i opcionim objašnjenjima fraza. Koristi se kada korisnik traži reči za učenje iz foldera epizode.
---

# Skill: kljucne-reci-nemacki

Kada korisnik zatraži da izdvojiš ključne reči iz nemačkog titla (SRT fajla) neke epizode radi učenja jezika:

1. **Pronađi folder i SRT fajl** u zadatom direktorijumu epizode.
2. **Analiziraj tekst** titlova, filtriraj uobičajene reči (stop-words) i identifikuj ključne imenice, glagole, prideve i specifične izraze/fraze.
3. **Za svaku izdvojenu reč ili frazu obavezno obezbedi:**
   - Tačan nemački izraz (sa članom za imenice).
   - Značenje na srpskom jeziku.
   - **Primer rečenice** — stvarna rečenica iz titla gde se ta reč/fraza zaista pojavljuje. Nikad je ne izmišljaj; ako je nema u titlu, navedi najbliži stvarni red i to naglasi.
   - **Prevod primera** — pravi prevod te nemačke rečenice na srpski.
   - **Dodatno objašnjenje** — opciono, samo kada je potrebno.

## Stroga pravila

- **„Prevod primera“ ne sme biti prepisana nemačka rečenica.** To mora biti stvarni prevod na srpski jezik. Ako je prevod identičan nemačkom tekstu, to je greška.
- **Svaka sadržajna reč iz primera mora imati svoje značenje.** Prevod cele rečenice **nije** dovoljan: ako je u primeru imenica koja nije A1, a nigde nije objašnjena, ona dobija **svoj unos** ili barem eksplicitno `X = Y` u objašnjenju tog unosa. Ovo se lako propusti jer reč „zvuči prevedeno“ kad se pojavi u prevodu rečenice.
  - Primer greške iz epizode 12: u unosu *die Spende + darbieten* stoji primer *„so hat es eine seine Überzeugung verdeutlichende Spende darzubieten.“* i prevod „…prilog koji jasno pokazuje njegovo uverenje“, ali **die Überzeugung** nigde nije dobilo značenje. Korisnik je to odmah primetio. Popravljeno je zasebnim unosom.
  - Isto važi za svaku drugu reč koja nosi smisao primera: `die Adeligen`, `der Diener`, `der Priester`, `der Herbst`, `der Schutz`, `die Führung`, `erkannte`, `einzig`, `die Hübscheste`.
- **Dodatno objašnjenje je opciono** i izostavlja se kada je značenje očigledno. Obavezno ga dodaj kada:
  - je u pitanju **složenica** (npr. *Familienrat* = *Familie* + *Rat*; *Goldmünzen* = *Gold* + *Münzen*; *Armreif* = *Arm* + *Reif*),
  - je u pitanju **kolokacija / fraza čije značenje nije zbir reči** (npr. *eine Entscheidung treffen* — *treffen* samo znači „sresti“, ali uz *Entscheidung* znači „doneti odluku“),
  - je u pitanju **glagol sa odvojivim prefiksom** (npr. *aufsaugen* → partizip *aufgesaugt*),
  - je u pitanju **refleksivni glagol ili glagol koji traži genitiv** — tu se
    značenje ne vidi iz pojedinačnih reči (vidi listu ispod),
  - je u pitanju **participalna konstrukcija** (npr. *eine seine Überzeugung verdeutlichende Spende*) — particip prezenta se ponaša kao pridev i **svoj objekat nosi ispred sebe**, pa tri reči stoje jedna za drugom bez glagola u ličnom obliku,
  - je reč **specifičan izmišljeni termin iz serije** (npr. *Zerfressung*).
- Navodi i **gramatičke oblike** koji se stvarno pojavljuju u titlu (npr. genitiv *dieses Armreifs*, množina *magische Utensilien*) kada pomažu razumevanju brzog teksta.

## Konstrukcije koje obavezno dobijaju objašnjenje

Ovo su tačke na kojima se učenik **sigurno** zaustavi, jer zbir prevedenih reči
daje pogrešnu sliku. Za svaku navedi: šta glagol znači sam, šta znači u
konstrukciji, i **koji padež** traži.

| Nemački | Značenje | Zašto zbunjuje |
| --- | --- | --- |
| *sich einer Sache erfreuen* (+ Gen.) | uživati nešto, biti obdaren | `erfreuen` samo = „obradovati“; uz `sich` i genitiv menja se i subjekat i objekat |
| *sich einer Sache erinnern* (+ Gen.) | sećati se nečega | objekt je u genitivu, ne u akuzativu |
| *einer Sache bedürfen* (+ Gen.) | biti potreban | isto |
| *einer Sache gedenken* (+ Gen.) | sećati se (pokojnika) | isto |
| *sich jemandes annehmen* (+ Gen.) | pobrinuti se za nekoga | `annehmen` sam = „prihvatiti“ |
| *sich einer Sache enthalten* (+ Gen.) | uzdržati se od nečega | `enthalten` sam = „sadržati“ |
| *es handelt sich um* (+ Akk.) | radi se o | `handeln` sam = „trgovati / postupati“ |
| *sich freuen auf / über* (+ Akk.) | radovati se (nečemu što dolazi / što je bilo) | `auf` = budućnost, `über` = sadašnjost |

Posebno pazi na **padežne oblike determinatora**, jer oni otkrivaju padež koji
se u brzom titlu ne čuje: `einige` = „neki“, ali `einiger Beliebtheit` =
„izvesne popularnosti“ (genitiv ženskog roda). Kad se u titlu pojavi ovakav
oblik, u objašnjenju napiši i osnovni oblik i padež.

### Povratni glagoli koji bez `sich` znače nešto drugo

Isti problem kao kod genitivnih glagola, ali češći u običnom dijalogu. Uvek
napiši oba značenja:

| Nemački | Značenje | Zašto zbunjuje |
| --- | --- | --- |
| *sich verabschieden* | oprostiti se | `verabschieden` sam = „ispratiti (nekoga)“ |
| *sich verlassen auf* (+ Akk.) | pouzdati se u | `verlassen` sam = „napustiti“ |
| *sich verlaufen* | zalutati | `verlaufen` sam = „proteći / odvijati se“ |
| *sich einmischen* | umešati se | `mischen` sam = „mešati“ |
| *sich beruhigen* | smiriti se | `beruhigen` sam = „smiriti (nekoga drugog)“ |
| *sich erholen* | odmoriti se, oporaviti se | — |
| *sich verlieben in* (+ Akk.) | zaljubiti se u | — |
| *sich gedulden* | strpeti se | — |
| *sich wenden an* / *sich zuwenden* | obratiti se (nekome) | `wenden` sam = „okrenuti“ |
| *sich entscheiden für* (+ Akk.) | odlučiti se za | `entscheiden` sam = „odlučiti (o nečemu)“ |
| *sich erstrecken über* (+ Akk.) | protezati se na | — |
| *sich beraten* | savetovati se | `beraten` sam = „savetovati (nekoga)“ |
| *sich entziehen* (+ Dat.) | izmaći se, izvući se | `entziehen` sam = „oduzeti“; objekt je u **dativu** (der Kirche) |
| *sich widersetzen* (+ Dat.) | suprotstaviti se | koristi se samo povratno; traži **dativ** (den Befehlen) |
| *sich wehren* | braniti se, opirati se | bez `sich` se u ovom značenju ne koristi |
| *sich anschließen* (+ Dat.) | pridružiti se (mišljenju) | `anschließen` sam = „priključiti (struju)“ |
| *sich kümmern um* (+ Akk.) | brinuti se o | `kümmern` sam je arhaično; značenje nosi povratna konstrukcija |
| *sich anstrengen* | potruditi se | *die Anstrengung* = napor |
| *sich legen* | smiriti se, splasnuti | `legen` sam = „položiti“ |
| *sich überlegen* | razmisliti | `überlegen` kao pridev = „nadmoćan“ |
| *sich vorstellen* | zamišljati (sebi) | `vorstellen` sam = „predstaviti (nekoga)“ |

### Lažni prijatelji koji se lako previde

Ne idu ni u `SKIP` ni u `A1` — zaslužuju objašnjenje:

| Nemački | Znači | Ne znači |
| --- | --- | --- |
| *das Paradies* | raj | paradajz (*die Tomate*) |
| *das Gift* | otrov | dar |
| *die Belange* (samo mn.) | interesi, potrebe | „belange“ |

### Odvojivi prefiksi i `zu` unutar glagola

Kod glagola sa odvojivim prefiksom (npr. `beibringen`, `darbieten`,
`einfahren`, `beistehen`, `unterkommen`) prefiks u prezentu ide na kraj
rečenice, a kod `zu`-infinitiva `zu` se ubacuje **unutra**:
`ein**zu**fahren`, `bei**zu**bringen`. Navedi to u objašnjenju, jer se u titlu
vidi samo rastavljen oblik.


4. **Format izlaza** (`.md` fajl u folderu epizode):

```markdown
### N. <nemački izraz>

- **Značenje:** <srpsko značenje>
- **Primer iz titla:** *„<stvarna nemačka rečenica>“*
- **Prevod primera:** <stvarni srpski prevod te rečenice>
- **Dodatno objašnjenje:** <samo ako je potrebno>
```

### Ubrzan tok: napiši samo prevode, fajl sastavi skriptom

Ne kucaj nemačke primere i ne sastavljaj markdown ručno. Napiši **samo ono što
je stvarno tvoj rad** — značenja, prevode i objašnjenja — u mali JSON, a
`napravi_md.py` sastavi fajl i sam uzme **tačne** rečenice iz titla:

```bash
cd "<folder epizode>"
cat > unosi.json <<'JSON'
[
 {"naslov": "die Waise / die Waisen",
  "znacenje": "siroče / siročad",
  "prevod": "poslednji je izlaz za siročad koja inače ne mogu nikuda!",
  "objasnjenje": "der Ausweg = izlaz (aus + Weg) ...",
  "trazi": "Waisen"},
 {"naslov": "die Auffassungsgabe",
  "znacenje": "sposobnost shvatanja",
  "primer": "Bei deiner Auffassungsgabe wird es sich belohnt machen, dir etwas beizubringen.",
  "prevod": "S tvojom sposobnošću shvatanja isplatiće se nešto te naučiti."}
]
JSON

python3 ~/.dsh/skills/kljucne-reci-nemacki/napravi_md.py \
    "<naziv>.deDE.srt" unosi.json kljucne_reci_epizoda_NN.md \
    "13" "13. epizodu (*Die Option der Ausbildung im Kirchendienst*)"
rm unosi.json
```

Polja: `naslov`, `znacenje`, `prevod` su obavezna; `objasnjenje`, `trazi` i
`primer` su opcioni. Ako daš `primer`, skripta **proverava da ta rečenica
postoji u titlu** — ako ne postoji, prijavi unos umesto da tiho uđe u fajl. Ako
ga ne daš, nađe je preko `trazi`.

Prednost nije samo brzina: skripta ne može da napravi grešku u kucanju (npr.
`Katedrale` umesto `Kathedrale`) koju je posle teško primetiti. Provereno: za
epizodu 13 `napravi_md.py` reprodukuje ručno napisan fajl **bajt u bajt**.

Ako samo želiš da vidiš koje rečenice u titlu sadrže neku reč (bez sastavljanja
fajla), koristi `izvuci_primere.py` — ispiše primer, vreme bloka i skeleton:

```bash
python3 ~/.dsh/skills/kljucne-reci-nemacki/izvuci_primere.py \
    "<naziv>.deDE.srt" Waise Auffassungsgabe Lebensunterhalt Gral
```

Uz `--sve` ispiše sve pojave, inače prvu i samo nabroji vremena ostalih.

### Provera na kraju — jedan poziv

```bash
python3 ~/.dsh/skills/kljucne-reci-nemacki/proveri_md.py \
    kljucne_reci_epizoda_NN.md "<naziv>.deDE.srt"
```

Radi sve četiri provere odjednom: polja, „prevod = nemački“, verbatim citate i
pokrivenost sadržajnih reči. Kod pokrivenosti su česti lažni pozitivi (poredi se
gruba osnova reči), pa taj spisak pogledaj rukom.

5. **Snimi rezultat** u `.md` fajl u odgovarajući folder epizode (npr. `kljucne_reci_epizoda_NN.md`).
6. **Otvori fajl u Markor aplikaciji** na Android uređaju:

```bash
am start -a android.intent.action.VIEW \
  -d "file://<putanja-do-fajla>" -t "text/markdown" \
  || am start -n net.gsantner.markor/.activity.DocumentActivity -d "file://<putanja-do-fajla>"
```

7. **Na kraju proveri sebe:** pročitaj generisani `.md` i uveri se da ni jedno polje **Prevod primera** nije identično nemačkom tekstu iz polja **Primer iz titla**.

8. **Pusti i automatsku proveru pokrivenosti** — hvata reči koje su „prevedene“ samo
   time što se pojavljuju u prevodu rečenice, a nigde nemaju svoje značenje:

```bash
cd "<folder epizode>"
python3 - <<'EOF'
import re, glob
STOP = set("dass eine einen einem eines seine seinen seiner ihrer ihre ihrem ihren "
           "diese dieser dieses nicht sind wird werden hat habe haben dann oder "
           "aber wenn weil auch sehr nach noch beim vom zum zur aus mit auf für "
           "über unter durch gegen ohne um zu im in an bei von vor ist war waren "
           "sein man sich also hier kein mich dich euch unser unsere seinem will "
           "werde kommt müssen".split())
for P in glob.glob("kljucne_reci_epizoda_*.md"):
    txt = open(P, encoding="utf-8").read()
    print("===", P)
    for b in txt.split("### ")[1:]:
        title = b.split("\n")[0].strip()
        ex = re.search(r"\*\*Primer iz titla:\*\* \*„(.+?)“\*", b)
        if not ex:
            continue
        body = re.sub(r"\*\*Primer iz titla:\*\* \*„.+?“\*", "", b).lower()
        for w in sorted(set(re.findall(r"[A-Za-zÄÖÜäöüß]{5,}", ex.group(1)))):
            lw = w.lower()
            if lw in STOP:                      # funkcijske reči
                continue
            stem = lw[:max(5, len(lw) - 3)]     # gruba osnova, hvata deklinaciju
            if stem in body:                    # pomenuto u znacenju/objasnjenju
                continue
            print(f"  [{title}]  {w}")
EOF
```

Svaka ispisana reč mora biti **ili** u svom unosu (makar kao `X = Y` u
objašnjenju), **ili** imati svoj unos u istoj epizodi. Ako nije ni jedno ni
drugo — dodaj joj značenje. Provera je gruba (radi po osnovi reči), pa
ponekad prijavi i reč koja je već objašnjena; proveri rukom pre nego što je
dodaš.
