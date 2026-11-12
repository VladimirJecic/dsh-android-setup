#!/usr/bin/env python3
"""partial-prevod: ključne nemačke reči sa srpskim prevodom GORE, nemački titl DOLE.

Upotreba:
    python3 generate_partial_srt.py <titl.deDE.srt> [izlaz_basename]

Piše <folder titla>/partial-prevod.srt (sa {\\an8}) i partial-prevod.ass.

Rečnik NIJE u ovoj skripti.  Učitava se iz:
    <folder skilla>/lexikon.json           trajni rečnik (sve epizode)
    <folder titla>/lexikon_dodaci.json     dodaci za ovu epizodu
Ovu skriptu ne treba menjati da bi se dodala reč.

Svaka reč iz titla prolazi kroz JEDNU funkciju, `potrazi()`.  Ona vraća ili
stavku za prikaz, ili razlog zašto se reč ne prikazuje (A1, SKIP, STOP, ime),
ili NEPOZNATO.  Dijagnostika i QA koriste istu funkciju, pa reč ne može da
bude „poznata” u izveštaju a da se ipak ne prikaže.
"""
import collections
import difflib
import json
import os
import re
import sys

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
TRAJNI = os.path.join(SKILL_DIR, "lexikon.json")
DODACI = "lexikon_dodaci.json"

# ------------------------------------------------------------- lematizator ---
# simplemma (pip install simplemma) svodi oblik na osnovu: verlässt -> verlassen,
# Angriffe -> Angriff, gewachsen -> wachsen.  Tako u rečniku treba samo
# osnovni oblik, a ne svaki padež i svako vreme posebno.  Bez njega skripta
# radi kao ranije (samo tačan oblik iz rečnika), ali propušta mnogo više reči.
try:
    import simplemma

    def lema(w):
        return simplemma.lemmatize(w, lang="de")
    IMA_LEMU = True
except ImportError:  # pragma: no cover
    def lema(w):
        return w
    IMA_LEMU = False

# --------------------------------------------- zaključane osnovne liste -----
# Ove liste se NE proširuju po epizodi.  Dodaci idu u lexikon_dodaci.json, a
# sacuvaj_recnik.py proverava da A1/STOP dodaci nisu sakrivene „teške” reči.
A1_OSNOVA = set("""
abend acht allein alt alte arbeiten arbeitet arm auch auge augen bald baum
begann beginne beginnen besser bessere besseren besseres beste besten bestes
bett billig bitter blau bleiben bleibst bleibt blume blut brauchen brauchst
braucht brauchte brauchten braun breit bringen bringt brot bruder brüder buch
bunt butter bücher danach dann denken denkst denkt dick dort drei dritte
dunkel dünn ei eier einmal eins elf eng erde erste ersten erster essen falsch
falsche falschen fenster fest feuer feuers finde finden findet frei freund
freundin frisch früher fünf fünfte fünften gaben ganze ganzen geben gebracht
gehe gehen gehst geht gelaufen gelb genug gern gerne geschlossen gestern
gesund gib gibt ging glauben glaubst glaubt glücklich golden grau groß große
großvater grün gut gute haben halb hand hatte haus heiß heiße helfen hell hemd
herz heute hier hilft himmel hinten hoch hohe hundert hungrig hände höre hören
immer innen isst jahr jahres jetzt jung junge jungen kalt kam kamen kaufe
kaufen kauft kennst kind kindern klar kleid kleides klein kleine kleiner komm
komme kommen kommt kopf krank kuchen kurz küche land lang lange langem langer
langsam laut lauter leer leicht leise lernen lernst lernt lesen leute licht
lichtes lichts liebe lieber liegen liegt liest lila links los luft machen
macht manchmal mann mehr mensch milch monat mond morgen musstet mutter müde
nacht nahe nahmen nehme nehmen neu neue neuem neuen neuer neues neun nie nimmt
nur oben offen oft ort paar platz rechts reich reichem richtig rosa rot sagen
sagst sagt sagte sah salzig sauber sauer schlafen schlecht schläft schmutzig
schnell schreiben schreibt schuh schwach schwarz schwer schwester schön sechs
sehen sehr seht sein seite sieben sieh siehst sieht silbern sitzen sitzt sohn
sonne spiel spiele spielen spielt sprachen sprechen sprich spricht später
stadt stark stehen steht stelle stellt stuhl stunde süß tag tage tages tausend
teuer tief tisch tochter traurig trinken trinkt tür unten vater versteh
verstehe verstehen versteht viel viele vielen vier voll volle vollen vorne
waren warm warten wartet wasser wassers weg weiß weißt wenig werden wieder
wird wissen woche wurden wörter zehn zeit zimmer zucker zusammen zwei zweite
zweiter zwölf
""".split())

STOP_OSNOVA = set("""
aber ach ah alle alles als also ascendance auch autsch beide beiden bin bist
bitte bookworm carla da daher danach danke dann darf das dass davor dein deine
deinem deinen deiner deines dem den denn der des dich die dies dir doch dort
du durfte dürfen ein eine einem einen einer eines er es etwa etwas euch euer
eure felsine gewesen gilberta glico guten habe haben habt hach hallo hast hat
hatte hatten hey hier hm hätten ich ihm ihnen ihr ihrem ihren ihrer ihres
illustration ist ja je jede jeder jedes jemand kann kannst kaya kein keine
keinen keiner konnte konnten kuramoto können lässt mag man mein meine meinem
meinen meiner meines mhm mich mir muss musst musste möchte möchten möchtest
mögen müssen müssten nanu nein nicht nichts niemand noch nun nur ob oder oh
okay schon sehr sein seine seinem seinen seiner sich sie sind so soll solle
sollen sollst sollte solltest sondern tag tust und uns unser unsere unserem
unseren unserer wann war waren warum was welche welcher welches wenn wer werde
werden wie wieso will willst wir wird wirst wo wolle wollen wollte wurde
wurden wärst würde würden zu ähm
""".split())

PREP_OSNOVA = {
    "mit": "mit = sa (Dativ)",
    "in": "in = u (Dativ/Akk.)",
    "an": "an = na / pri (Dativ/Akk.)",
    "auf": "auf = na (Dativ/Akk.)",
    "aus": "aus = iz (Dativ)",
    "bei": "bei = kod (Dativ)",
    "für": "für = za (Akk.)",
    "von": "von = od (Dativ)",
    "vor": "vor = pre / ispred (Dativ/Akk.)",
    "über": "über = preko / o (Dativ/Akk.)",
    "unter": "unter = pod / među (Dativ/Akk.)",
    "nach": "nach = posle / prema (Dativ)",
    "bis": "bis = do",
    "um": "um = oko / za (Akk.)",
    "durch": "durch = kroz (Akk.)",
    "gegen": "gegen = protiv (Akk.)",
    "ohne": "ohne = bez (Akk.)",
    "seit": "seit = od / već (Dativ)",
    "während": "während = tokom (Genitiv)",
    "wegen": "wegen = zbog (Genitiv)",
    "trotz": "trotz = uprkos (Genitiv)",
    "statt": "statt = umesto (Genitiv)",
    "außer": "außer = osim (Dativ)",
    "innerhalb": "innerhalb = unutar (Genitiv)",
    "außerhalb": "außerhalb = izvan (Genitiv)",
    "angesichts": "angesichts = s obzirom na (Genitiv)",
    "neben": "neben = pored (Dativ/Akk.)",
    "zwischen": "zwischen = između (Dativ/Akk.)",
    "hinter": "hinter = iza (Dativ/Akk.)",
    "entlang": "entlang = duž (Akk.)",
    "gemäß": "gemäß = u skladu sa (Dativ)",
    "laut": "laut = prema (Dativ)",
    "zufolge": "zufolge = prema (Dativ)",
    "mithilfe": "mithilfe = uz pomoć (Genitiv)",
    "anstatt": "anstatt = umesto (Genitiv)",
    "mitsamt": "mitsamt = zajedno sa (Dativ)",
    "seitens": "seitens = od strane (Genitiv)",
    "kraft": "kraft = na osnovu (Genitiv)",
    "zwecks": "zwecks = radi (Genitiv)",
    "aufs": "aufs = na (auf das)",
    "je": "je = po (Dativ)",
    "pro": "pro = po",
    "dank": "dank = zahvaljujući (Dativ/Gen.)",
}

# A1 imenice koje ostaju skrivene i kad su velikim slovom (vidi potrazi)
A1_IMENICE = set("""arm arme armen bett blut spiel spiele tag tage tages
sprachen sprache""".split())

# odvojivi prefiksi koji na kraju rečenice pripadaju glagolu, a ne predlogu:
# "Er hört nie auf." = aufhören, ne "auf = na (Dativ/Akk.)"
ODVOJIVI = set("""ab an auf aus bei bereit dabei dafür dagegen daher dahin
daran darauf davon dazu dazwischen durch ein empor entgegen entlang fern fest
fort frei gegenüber heim her herab heran herauf heraus herbei herein herum
herunter hervor hin hinab hinauf hinaus hinein hinterher hinunter hinweg hoch
kennen klar kaputt los mit nach nieder statt teil um umher vor voran voraus
vorbei vorüber weg weiter wieder zu zurecht zurück zusammen""".split())
# zamenice/članovi nikad nisu glagol odvojivog glagola
ZAMENICE = set("""ich du er sie es wir ihr mich dich sich uns euch mir dir ihm
ihn ihnen der die das den dem des ein eine einen einem einer eines was wer wen
wem wo wie nicht nie noch schon auch dann jetzt heute morgen gestern hier da
dort man kein keine keinen keinem""".split())
# kad je glagol "sein", čestica je obično prilog ("Was ist los?") -> obična pretraga
NIJE_ODVOJIV_GLAGOL = {"sein"}

LEX, REFL, CASE_NOUNS, PREP, FALLBACK = {}, {}, {}, dict(PREP_OSNOVA), {}
A1, STOP = set(A1_OSNOVA), set(STOP_OSNOVA)
SKIP, NAMES = set(), set()
NIJE_KOGNAT = set()   # reči koje liče na srpsku, ali ih ipak vredi prikazati
UCITANO = []          # (fajl, broj stavki)
NEPOPUNJENO = []      # ključevi sa praznim prevodom u dodacima

# lažni prijatelji: NIKAD u SKIP, nikad se ne prijavljuju kao kognati
LAZNI_PRIJATELJI = set("""eventuell eventuelle eventuellen aktuell aktuelle
aktuellen personal gift paradies art rente kaution provision familiär
konsequent handy mappe""".split())


def _skup(v):
    """SKIP/A1/STOP/NAMES mogu biti lista ili rečnik {reč: obrazloženje}."""
    return set(v.keys()) if isinstance(v, dict) else set(v)


ODBIJENO = []         # poruke o odbijenim dodacima (vidi proveri_dodatke)


def proveri_dodatke(d):
    """Pravila za epizodne dodatke.  Vraća (prihvaćeno, odbijeno, poruke).

    Odbija se:  prazno / bez ' = ' / zapeta u prevodu;  A1 reč koja nije oblik
    osnovne A1 liste;  SKIP bez blizanca ili sa nesličnim blizancem;  STOP ili
    NAMES za reč koja već ima prevod u LEX-u.  Svrha: reč ne sme da „nestane”
    sa spiska nepoznatih tako što se sakrije u A1/SKIP/STOP/NAMES.
    """
    ok, los, poruke = {}, {}, []

    def odbij(tabela, k, v, razlog):
        los.setdefault(tabela, {})[k] = v
        poruke.append(f"{tabela}:{k} — {razlog}")

    for t in ("LEX", "REFL", "CASE_NOUNS", "PREP", "FALLBACK"):
        for k, v in d.get(t, {}).items():
            if not isinstance(v, str) or not v.strip():
                continue                      # prazno = NEPOPUNJENO, ne greška
            if " = " not in v:
                odbij(t, k, v, "nema ' = '")
            elif ", " in v.partition(" = ")[2]:
                odbij(t, k, v, "zapeta u prevodu — koristi ' / '")
            else:
                ok.setdefault(t, {})[k.lower()] = v.strip()
    for w in _skup(d.get("A1", [])):
        if w.lower() in A1_OSNOVA or lema(w).lower() in A1_OSNOVA:
            ok.setdefault("A1", []).append(w.lower())
        else:
            odbij("A1", w, None, "nije oblik osnovne A1 reči — prevedi je u LEX")
    skip = d.get("SKIP", {})
    if isinstance(skip, list):
        skip = {w: "" for w in skip}
    for w, bl in skip.items():
        if w.lower() in LAZNI_PRIJATELJI:
            odbij("SKIP", w, bl, "lažni prijatelj — mora da se prevede")
        elif not bl or slicnost(w, bl) < 0.7:
            odbij("SKIP", w, bl, f"blizanac '{bl}' nije sličan — nije kognat, prevedi je")
        else:
            ok.setdefault("SKIP", []).append(w.lower())
    for t in ("STOP", "NAMES"):
        for w in _skup(d.get(t, [])):
            prevod = LEX.get(w.lower()) or LEX.get(lema(w).lower())
            if prevod:
                odbij(t, w, None, f"ima prevod u LEX ({prevod})")
            else:
                ok.setdefault(t, []).append(w.lower())
    for w in _skup(d.get("NIJE_KOGNAT", [])):
        ok.setdefault("NIJE_KOGNAT", []).append(w.lower())
    return ok, los, poruke


def _primeni(d):
    for ime, tabela in (("LEX", LEX), ("REFL", REFL), ("CASE_NOUNS", CASE_NOUNS),
                        ("PREP", PREP), ("FALLBACK", FALLBACK)):
        for k, v in d.get(ime, {}).items():
            if isinstance(v, str) and v.strip():
                tabela[k.lower()] = v.strip()
    for ime, tabela in (("SKIP", SKIP), ("A1", A1), ("STOP", STOP),
                        ("NAMES", NAMES), ("NIJE_KOGNAT", NIJE_KOGNAT)):
        tabela.update(w.lower() for w in _skup(d.get(ime, [])))


def ucitaj_recnik(srt_path=None):
    """Učitaj trajni rečnik, pa (proverene) dodatke iz foldera epizode."""
    putanje = [TRAJNI]
    if srt_path:
        putanje.append(os.path.join(os.path.dirname(os.path.abspath(srt_path)),
                                    DODACI))
    for p in putanje:
        if not os.path.exists(p):
            continue
        try:
            with open(p, encoding="utf-8") as fh:
                d = json.load(fh)
        except (ValueError, OSError) as e:
            sys.exit(f"GREŠKA: ne mogu da učitam {p}: {e}")
        if p != TRAJNI:
            for t in ("LEX", "REFL", "CASE_NOUNS", "PREP"):
                NEPOPUNJENO.extend(k for k, v in d.get(t, {}).items()
                                   if not (isinstance(v, str) and v.strip()))
            d, _, poruke = proveri_dodatke(d)
            ODBIJENO.extend(poruke)
        _primeni(d)
        UCITANO.append((os.path.basename(p),
                        sum(len(v) for k, v in d.items() if not k.startswith("_"))))


# ------------------------------------------------------------------ SRT ------
TAG_RE = re.compile(r"<[^>]+>|\{[^}]*\}")       # <i>…</i> i ASS {\an8}{\pos(..)}
WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüßẞ]+")
TIME_RE = re.compile(r"(\d+):(\d\d):(\d\d)[,.](\d{1,3})")
KLAUZA_RE = re.compile(
    r"(?:(?!\b(?:und|oder|sondern)\b)[^,.!?;:…\"„“”«»()\[\]–—])+",
    re.I)


ASS_TAG_RE = re.compile(r"\{[^}]*\}")


def ocisti_ass(line):
    """Ukloni ASS tagove ({\\an8}, {\\pos(..)}) ali zadrži <i> za kurziv."""
    line = ASS_TAG_RE.sub("", line)
    line = line.replace("\\N", " ").replace("\\n", " ").replace("\\h", " ")
    return re.sub(r"\s+", " ", line).strip()


def ocisti(line):
    line = TAG_RE.sub("", line)
    line = line.replace("\\N", " ").replace("\\n", " ").replace("\\h", " ")
    return re.sub(r"\s+", " ", line).strip()


def parse_srt(text):
    """Vrati [(broj, 'start --> end', [redovi])].  Toleriše BOM, CRLF,
    višestruke prazne redove i blokove bez rednog broja."""
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    out = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.split("\n")
        ti = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if ti is None:
            continue
        no = lines[ti - 1].strip() if ti > 0 else str(len(out) + 1)
        redovi = [ocisti_ass(l) for l in lines[ti + 1:]]
        redovi = [r for r in redovi if ocisti(r)]
        if redovi:
            out.append((no, lines[ti].strip(), redovi))
    return out


MUCANJE_RE = re.compile(r"\b([A-Za-zÄÖÜäöü]{1,2})-(?=\1)", re.I)
PRELOM_RE = re.compile(r"([a-zäöüß])- ([a-zäöüß])")


def plain(lines):
    t = " ".join(ocisti(l) for l in lines).strip()
    t = MUCANJE_RE.sub("", t)                 # "D-Der" -> "Der", "S-Sind" -> "Sind"
    return PRELOM_RE.sub(r"\1\2", t)           # "Verleihungs- zeremonie" -> jedna reč


def ass_vreme(ts):
    h, m, s, ms = TIME_RE.match(ts.strip()).groups()
    ms = int(ms.ljust(3, "0"))
    return f"{int(h)}:{m}:{s}.{ms // 10:02d}"


def srt_vreme(ts):
    h, m, s, ms = TIME_RE.match(ts.strip()).groups()
    return f"{int(h):02d}:{m}:{s},{ms.ljust(3, '0')}"


# ------------------------------------------------------------- pretraga -----
def osnove(entry):
    """Osnovni oblici stavke za A1/SKIP filter: 'gekommen' je u LEX kao
    'kommen = doći', a 'kommen' je A1 — pa se i 'gekommen' preskače.

    Za višečlane izraze ('wert sein', 'gewachsen sein') NE uzima se
    poslednja reč — inače 'sein' (A1) tiho ubije ceo izraz."""
    head = entry.split(" = ")[0].strip().lower()
    keys = {head}
    for art in ("der ", "die ", "das ", "sich ", "zu ", "im ", "am "):
        if head.startswith(art):
            head = head[len(art):]
            break
    if " " not in head:
        keys.add(head)
    return keys


ZU_INF_RE = re.compile(r"^([a-zäöüß]{2,8})zu([a-zäöüß]{3,})$")


def _iz_tabela(kljuc, veliko, has_sich):
    e = REFL.get(kljuc) if has_sich else None
    if not e and veliko:
        e = CASE_NOUNS.get(kljuc)
    return e or LEX.get(kljuc)


def kljuc_za(w, lem, pocetak=False):
    """Ključ pod kojim se nepoznata reč upisuje u dodatke.

    Lematizator ponekad vrati DRUGU reč: stählen -> stehlen (krasti),
    Lümmel -> lümmeln.  Prevod upisan pod takvim ključem bi kasnije pokvario
    pravu reč.  Zato se uzima površinski oblik kad osnova ne počinje isto kao
    reč (osim ge- participa) ili kad imenica postane glagol."""
    lw = w.lower()
    if lem == lw:
        return lw
    if w[0].isupper() and not pocetak and lema(w)[:1].islower():
        return lw
    telo = lw[2:] if lw.startswith("ge") and not lem.startswith("ge") else lw
    if lem[:3] != telo[:3] and lem[:3] != lw[:3]:
        return lw
    return lem


def potrazi(w, has_sich, pocetak=False):
    """Jedna reč -> (vrsta, vrednost).

    vrsta:  'rec'      vrednost = stavka za prikaz ('der Eid = zakletva')
            'predlog'  vrednost = stavka predloga
            'nepoznato' vrednost = ključ koji treba dodati u rečnik (osnova)
            'ime' / 'stop' / 'skip' / 'a1' / 'kratko'  vrednost = None
    """
    lw = w.lower()
    if len(lw) < 2:
        return "kratko", None
    if lw in NAMES:
        return "ime", None
    # Imenica velikim slovom usred rečenice je druga reč od A1 prideva/glagola:
    # "ein Fest" (slavlje) vs "fest" (čvrst), "zur Tat" vs "tat" (tun).
    # Izuzetak su imenice koje su same A1 (der Tag, das Bett …).
    if (w[0].isupper() and not pocetak and lw in CASE_NOUNS
            and lw not in A1_IMENICE and not osnove(CASE_NOUNS[lw]) & SKIP):
        return "rec", CASE_NOUNS[lw]
    if lw in STOP:
        return "stop", None
    if lw in SKIP:
        return "skip", None
    if lw in A1:
        return "a1", None
    veliko = w[0].isupper()

    entry = _iz_tabela(lw, veliko, has_sich)
    if not entry and lw in PREP:
        return "predlog", PREP[lw]
    if not entry:
        m = ZU_INF_RE.match(lw)
        if m:
            base = m.group(1) + m.group(2)
            e = _iz_tabela(base, False, has_sich)
            if e:
                if osnove(e) & (A1 | SKIP) or base in A1 or base in SKIP:
                    return "a1", None
                return "rec", f"{lw} = {e.partition(' = ')[2]} ({base})"
    kljuc = lw
    if not entry:
        lem = lema(w).lower()
        if lem != lw:
            kljuc = lem
            if lem in NAMES:
                return "ime", None
            if lem in STOP:
                return "stop", None
            if lem in SKIP:
                return "skip", None
            if lem in A1:
                return "a1", None
            entry = _iz_tabela(lem, veliko, has_sich)
    if not entry:
        return "nepoznato", kljuc_za(w, kljuc, pocetak)
    if osnove(entry) & SKIP:
        return "skip", None
    if osnove(entry) & A1:
        return "a1", None
    return "rec", entry


def _odvojivi_glagoli(text, has_sich):
    """Nađi odvojive glagole: čestica na kraju klauze + glagol u klauzi.

    Vraća (stavke [(pozicija, stavka)], potrošene pozicije tokena,
           nepoznate [(ključ, površinski oblik)])."""
    stavke, potroseno, nepoznate = [], set(), []
    for km in KLAUZA_RE.finditer(text):
        tok = [(m.group(0), km.start() + m.start())
               for m in WORD_RE.finditer(km.group(0))]
        # čestica je poslednja reč klauze, ili stoji ispred "zu + infinitiv"
        # na kraju ("Er hört nie auf zu reden.")
        if len(tok) >= 4 and tok[-2][0].lower() == "zu":
            tok = tok[:-2]
        if len(tok) < 2 or tok[-1][0].lower() not in ODVOJIVI:
            continue
        # "Ich lauf doch nicht weg vor …": prekinut predlog na kraju nije
        # čestica — gleda se reč pre njega (weg -> weglaufen)
        posle = text[tok[-1][1] + len(tok[-1][0]):].lstrip()
        if tok[-1][0].lower() in PREP and posle.startswith(("…", "...")):
            tok = tok[:-1]
            if len(tok) < 2 or tok[-1][0].lower() not in ODVOJIVI:
                continue
        cest, cest_poz = tok[-1][0].lower(), tok[-1][1]
        # glagol je obično na 2. mestu (izjavna), ili 1. (pitanje, imperativ)
        red = [1, 0] + list(range(2, len(tok) - 1))
        kand = [tok[i] for i in red if i < len(tok) - 1 and len(tok[i][0]) >= 2
                and tok[i][0].lower() not in ZAMENICE | NAMES]
        nadjen = False
        for w, poz in kand:
            oblici = {lema(w).lower(), lema(w.lower()).lower(), w.lower()}
            for o in oblici:
                e = _iz_tabela(cest + o, False, has_sich)
                if e or (cest + o) in A1 or (cest + o) in SKIP:
                    potroseno |= {poz, cest_poz}
                    if e and not osnove(e) & (A1 | SKIP):
                        stavke.append((poz, f"{e} ({w} … {cest})"))
                    nadjen = True
                    break
            if nadjen:
                break
        if nadjen:
            continue
        # nije u rečniku: pogodi glagol i prijavi složeni infinitiv
        for w, poz in kand:
            lg = lema(w.lower()).lower() if w[0].isupper() else lema(w).lower()
            if re.search(r"(en|ern|eln)$", lg) and lg not in NAMES:
                if lg in NIJE_ODVOJIV_GLAGOL:
                    break
                potroseno |= {poz, cest_poz}
                nepoznate.append((cest + lg, f"{w}…{cest}"))
                break
    return stavke, potroseno, nepoznate


def collect(text):
    """Reči jednog bloka -> (sadržajne, predlozi, nepoznate)."""
    has_sich = bool(re.search(r"\bsich\b", text, re.I))
    odv, potroseno, nepoznate = _odvojivi_glagoli(text, has_sich)
    po_poziciji = dict(odv)
    content, preps, seen = [], [], set()
    for m in WORD_RE.finditer(text):
        poz = m.start()
        if poz in po_poziciji:
            entry, vrsta = po_poziciji[poz], "rec"
        elif poz in potroseno:
            continue
        else:
            pocetak = not text[:poz].strip() or text[:poz].rstrip()[-1] in ".!?…:\"„“"
            vrsta, entry = potrazi(m.group(0), has_sich, pocetak)
            if vrsta == "nepoznato":
                prekinuta = text[m.end():m.end() + 1] in ("…", ".", "-") and \
                    text[m.end():m.end() + 3] in ("…", "...", "-") or \
                    text[m.end():].startswith("…")
                if len(entry) >= 3 and not prekinuta:
                    nepoznate.append((entry, m.group(0)))
                continue
            if vrsta not in ("rec", "predlog"):
                continue
        display = entry.split(" = ")[0]
        if display in seen:
            continue
        seen.add(display)
        (preps if vrsta == "predlog" else content).append(entry)
    return content, preps, nepoznate


def collect_fallback(text):
    """Kad blok nema nijednu reč za prikaz: boje, brojevi, lica iz FALLBACK."""
    out, seen = [], set()
    for m in WORD_RE.finditer(text):
        e = FALLBACK.get(m.group(0).lower())
        if e and e.split(" = ")[0] not in seen:
            seen.add(e.split(" = ")[0])
            out.append(e)
    return out


# --------------------------------------------------------------- raspored ---
PER_ROW = 4           # najviše stavki u jednom redu
MAX_CHARS = 84        # širina reda pre nego što libass sam prelomi
MAX_ROWS_TOTAL = 8    # sigurnosna granica; reč se ni tada ne odbacuje
RECENCY = 6           # ista reč se ne ponavlja u ovoliko uzastopnih blokova


def _sirina(row):
    return sum(len(x) for x in row) + 2 * len(row)


def rasporedi(content, preps):
    """Sadržajne reči redom, pa najviše jedan predlog po redu.  Ništa se ne
    odbacuje: kad red nema mesta, otvara se novi."""
    rows = []

    def put(item):
        for row in rows:
            if len(row) < PER_ROW and (not row or _sirina(row) + len(item) <= MAX_CHARS):
                row.append(item)
                return
        if len(rows) < MAX_ROWS_TOTAL:
            rows.append([item])
            return
        room = [r for r in rows if len(r) < PER_ROW] or rows
        min(room, key=_sirina).append(item)

    for item in content:
        put(item)
    if not rows:
        rows.append([])
    used = set()
    for p in preps:
        best = None
        for ri in reversed(range(len(rows))):
            row = rows[ri]
            if ri in used or len(row) >= PER_ROW:
                continue
            if row and _sirina(row) + len(p) > MAX_CHARS:
                continue
            best = ri
            break
        if best is None:
            room = [ri for ri in range(len(rows))
                    if ri not in used and len(rows[ri]) < PER_ROW]
            if room:
                best = min(room, key=lambda ri: _sirina(rows[ri]))
            else:
                rows.append([])
                best = len(rows) - 1
        rows[best].append(p)
        used.add(best)
    return [r for r in rows if r]


def key_words(text, recent, idx):
    """Redovi stavki za jedan blok + nepoznate reči u njemu."""
    content, preps, nepoznate = collect(text)

    def fresh(items):
        out = [c for c in items
               if recent.get(c.split(" = ")[0], -99) <= idx - RECENCY]
        return out if out else items

    content, preps = fresh(content), fresh(preps)
    if not content and not preps:
        content = collect_fallback(text)
    rows = rasporedi(content, preps)
    for r in rows:
        for e in r:
            recent[e.split(" = ")[0]] = idx
    return rows, nepoznate


def analiziraj(entries):
    """Prođi kroz celu epizodu.  Vraća (redovi po bloku, nepoznate)
    gde je nepoznate = {ključ: {'n': broj, 'oblici': set, 'primer': rečenica}}."""
    recent, svi_redovi = {}, []
    nep = collections.OrderedDict()
    for i, (no, ts, lines) in enumerate(entries):
        tekst = plain(lines)
        rows, nepoznate = key_words(tekst, recent, i)
        svi_redovi.append(rows)
        for kljuc, oblik in nepoznate:
            z = nep.setdefault(kljuc, {"n": 0, "oblici": set(), "primer": tekst})
            z["n"] += 1
            z["oblici"].add(oblik)
    return svi_redovi, nep


# ------------------------------------------------------------- kognati ------
def _norm_de(x):
    x = x.lower()
    for a, b in (("tsch", "č"), ("sch", "š"), ("ß", "ss"), ("th", "t"),
                 ("ph", "f"), ("ck", "k"), ("qu", "kv"), ("ch", "h"),
                 ("c", "k"), ("z", "c"), ("ie", "i"), ("ei", "aj"),
                 ("eu", "oj"), ("äu", "oj"), ("ä", "e"), ("ö", "e"),
                 ("ü", "i"), ("y", "i"), ("x", "ks"), ("w", "v")):
        x = x.replace(a, b)
    x = re.sub(r"(?<=[aeiou])s(?=[aeiou])", "z", x)   # Pause -> pauza
    return _norm_sr(x)


def _norm_sr(x):
    x = x.lower()
    for a, b in (("č", "c"), ("ć", "c"), ("š", "s"), ("ž", "z"), ("đ", "dj"),
                 ("dž", "dz")):
        x = x.replace(a, b)
    x = re.sub(r"[^a-z]", "", x)
    return re.sub(r"(.)\1", r"\1", x)          # ss -> s, mm -> m


def slicnost(de, sr):
    """0..1 — koliko je nemačka reč slična srpskoj/engleskoj (kognat)."""
    d, s = _norm_de(de), _norm_sr(sr)
    if len(d) < 3 or len(s) < 3:
        return 0.0
    if d == s:
        return 1.0
    # uporedi osnove: odseci tipične nastavke (-ieren/-irati, -ie/-ija, -e/-a)
    d = re.sub(r"(iren|ieren|en|e|n)$", "", d) or d
    s = re.sub(r"(irati|ovati|ati|iti|ija|ia|a|e|i|o)$", "", s.replace("ij", "i")) or s
    if len(d) < 3 or len(s) < 3:
        return 0.0
    k = 0
    while k < min(len(d), len(s)) and d[k] == s[k]:
        k += 1
    ratio = difflib.SequenceMatcher(None, d, s).ratio()
    if (k >= 4 and k >= 0.7 * min(len(d), len(s))
            and min(len(d), len(s)) >= 0.75 * max(len(d), len(s))):
        return max(ratio, 0.9)
    return ratio


def je_kognat(stavka, prag=0.82):
    """Za prikazanu stavku 'die Kathedrale = katedrala' vrati True ako je
    prevod praktično ista reč (onda ide u SKIP, osim lažnih prijatelja)."""
    de, _, sr = stavka.partition(" = ")
    de = re.sub(r"^(der|die|das|sich)\s+", "", de.strip())
    if de.lower() in LAZNI_PRIJATELJI | NIJE_KOGNAT or " " in de:
        return False
    sr = re.sub(r"\(.*?\)", "", sr)
    for alt in sr.split("/"):
        rec = alt.strip().split(" ")[0] if alt.strip() else ""
        if rec and slicnost(de, rec) >= prag:
            return True
    return False


# ------------------------------------------------------------------- main ---
ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 852
PlayResY: 480
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Vocab,DejaVu Sans,17,&H0000E6FF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,2,1,8,40,40,12,1
Style: Default,DejaVu Sans,24,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,2,1,2,25,25,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ucitaj_srt(path):
    with open(path, encoding="utf-8-sig", errors="replace") as fh:
        return parse_srt(fh.read())


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    base = sys.argv[2] if len(sys.argv) > 2 else "partial-prevod"
    outdir = os.path.dirname(os.path.abspath(src))
    ucitaj_recnik(src)
    entries = ucitaj_srt(src)
    if not entries:
        sys.exit(f"GREŠKA: u {src} nema nijednog titl-bloka")
    svi_redovi, nep = analiziraj(entries)

    srt_parts, ass_events, gaps = [], [], []
    for (no, ts, lines), rows in zip(entries, svi_redovi):
        start, end = [t.strip() for t in ts.split("-->")]
        start, end = start.split()[0], end.split()[0]
        vocab = "\\N".join(", ".join(r) for r in rows)
        italic = any("<i>" in l for l in lines)
        if rows:
            srt_parts.append(f"{srt_vreme(start)} --> {srt_vreme(end)}\n{{\\an8}}{vocab}")
            ass_events.append(f"Dialogue: 0,{ass_vreme(start)},{ass_vreme(end)},"
                              f"Vocab,,0,0,0,,{vocab}")
        else:
            gaps.append((no, plain(lines)))
        srt_parts.append(f"{srt_vreme(start)} --> {srt_vreme(end)}\n" + "\n".join(lines))
        dial = "\\N".join(ocisti(l) for l in lines)
        if italic:
            dial = "{\\i1}" + dial + "{\\i0}"
        ass_events.append(f"Dialogue: 0,{ass_vreme(start)},{ass_vreme(end)},"
                          f"Default,,0,0,0,,{dial}")

    srt_path = os.path.join(outdir, base + ".srt")
    with open(srt_path, "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(f"{i}\n{p}" for i, p in enumerate(srt_parts, 1)) + "\n")
    ass_path = os.path.join(outdir, base + ".ass")
    with open(ass_path, "w", encoding="utf-8") as fh:
        fh.write(ASS_HEADER + "\n".join(ass_events) + "\n")

    print("rečnik:", ", ".join(f"{f} ({n})" for f, n in UCITANO),
          "| lematizator:", "DA" if IMA_LEMU else "NE (pip install simplemma)")
    print(f"blokova {len(entries)}, sa prevodom {len(entries) - len(gaps)}, "
          f"bez {len(gaps)}")
    print(f"napisano: {srt_path}\n          {ass_path}")
    if ODBIJENO:
        print(f"\nODBIJENO iz {DODACI} (ne važi dok se ne popravi):")
        for p in ODBIJENO:
            print("   ", p)
    if NEPOPUNJENO:
        print(f"\nNEPOPUNJENO u {DODACI}: {len(NEPOPUNJENO)} -> "
              + " ".join(NEPOPUNJENO[:40]))
    if nep:
        print(f"\nNEPOZNATO: {len(nep)} reči ({sum(z['n'] for z in nep.values())} "
              f"pojavljivanja) — pokreni dijagnoza.py, ona ih upiše u {DODACI}")
        print("   " + " ".join(k for k in list(nep)[:40])
              + (" …" if len(nep) > 40 else ""))
    else:
        print("\nNEPOZNATO: 0")


if __name__ == "__main__":
    main()
