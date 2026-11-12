#!/usr/bin/env python3
"""Primeni ispravke nezavisnog kritičara na lexikon_dodaci.json.

Upotreba:
    python3 primeni_kritiku.py <folder epizode>

Čita <folder>/kritika.json (piše ga translation-critiquer):

    {"ispravke":   [{"blok": "183", "tabela": "LEX", "kljuc": "einholen",
                     "novo": "einholen = sustići / pribaviti", "razlog": "..."}],
     "propusteno": [{"blok": "264", "tabela": "CASE_NOUNS", "kljuc": "fest",
                     "novo": "das Fest = slavlje / gozba", "razlog": "..."}],
     "napomene":   ["[274] idiom 'sich auf etwas gefasst machen' ..."],
     "ocena":      {"pregledano": 304, "gresaka": 4}}

Ispravke prolaze ista pravila kao i ostali dodaci (član, ' = ', bez zapete).
Stavka u dodacima ima prednost nad trajnim rečnikom, pa ispravka STARE reči
važi odmah, a sacuvaj_recnik.py je posle trajno upiše.

Zaštita od lažnog praznog pregleda: ako paket ima ≥ MIN_BLOKOVA blokova a
kritika nema NI JEDNU ispravku ni propuštenu reč, to se tretira kao neuspeh
podagenta (ne kao „sve je čisto") i skripta izlazi sa kodom 2. Prazna kritika
na velikom paketu mora biti svesna odluka: dodaj --prihvati-prazno.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_partial_srt as g  # noqa: E402

DOZVOLJENE = ("LEX", "CASE_NOUNS", "REFL", "PREP")
MIN_BLOKOVA = 50


def broj_blokova(folder, srt=None):
    """Koliko blokova kritičar treba da pregleda (iz paketa, inače iz titla)."""
    paket = os.path.join(folder, "kritika_paket.md")
    if os.path.exists(paket):
        return sum(1 for l in open(paket, encoding="utf-8") if re.match(r"^\[\d+\]", l))
    if srt and os.path.exists(srt):
        return len(g.ucitaj_srt(srt))
    return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    folder = sys.argv[1]
    put_k = os.path.join(folder, "kritika.json")
    put_d = os.path.join(folder, g.DODACI)
    if not os.path.exists(put_k):
        sys.exit(f"nema {put_k} — kritičar još nije završio")
    try:
        k = json.load(open(put_k, encoding="utf-8"))
    except ValueError as e:
        sys.exit(f"kritika.json nije ispravan JSON: {e}")
    d = json.load(open(put_d, encoding="utf-8")) if os.path.exists(put_d) else {}
    g.ucitaj_recnik()

    # --- zaštita: prazna kritika na velikom paketu nije „sve je čisto" ----
    srt = next((os.path.join(folder, f) for f in sorted(os.listdir(folder))
                if f.endswith(".deDE.srt")), None)
    blokova = broj_blokova(folder, srt)
    prazna = not k.get("ispravke") and not k.get("propusteno")
    if prazna and blokova and blokova >= MIN_BLOKOVA and "--prihvati-prazno" not in sys.argv:
        print(f"KRITIKA JE PRAZNA, a paket ima {blokova} blokova.\n"
              f"To je skoro sigurno neuspeh podagenta (pročitao je deo paketa i overio "
              f"ga), a ne nalaz da je prevod tačan.\n"
              "Proveri: (1) je li podagent pokrenut na jakom modelu "
              "(deepseek-flash, ne flash-lite); (2) da li je pročitao ceo paket.\n"
              f"Ako si stvarno pregledao sve i nema grešaka: --prihvati-prazno", file=sys.stderr)
        sys.exit(2)
    if prazna and blokova and blokova >= MIN_BLOKOVA:
        print(f"UPOZORENJE: prazna kritika prihvaćena ručno (--prihvati-prazno), "
              f"paket {blokova} blokova.", file=sys.stderr)

    oc = k.get("ocena", {})
    if blokova and isinstance(oc.get("pregledano"), int) and oc["pregledano"] != blokova:
        print(f"UPOZORENJE: kritičar tvrdi da je pregledao {oc['pregledano']}, "
              f"a paket ima {blokova} blokova.", file=sys.stderr)

    primenjeno, odbijeno = 0, []
    for s in k.get("ispravke", []) + k.get("propusteno", []):
        t, kl, novo = s.get("tabela", "LEX"), str(s.get("kljuc", "")).lower(), s.get("novo", "")
        if t not in DOZVOLJENE or not kl or kl == "?":
            odbijeno.append(f"[{s.get('blok')}] {kl}: nepoznata tabela/ključ")
            continue
        ok, _, poruke = g.proveri_dodatke({t: {kl: novo}})
        if poruke or not ok:
            odbijeno.append(f"[{s.get('blok')}] {kl}: {'; '.join(poruke) or 'prazno'}")
            continue
        d.setdefault(t, {})[kl] = novo
        primenjeno += 1
        print(f"  [{s.get('blok')}] {t}:{kl} -> {novo}")

    with open(put_d, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)
    print(f"\nprimenjeno {primenjeno}, odbijeno {len(odbijeno)} "
          f"(kritičar: pregledano {oc.get('pregledano', '?')}, grešaka {oc.get('gresaka', '?')})")
    for o in odbijeno:
        print("  ODBIJENO", o)
    for n in k.get("napomene", []):
        print("  NAPOMENA", n)
    print("\nSLEDEĆE: generate_partial_srt.py pa proveri_prevod.py")


if __name__ == "__main__":
    main()
