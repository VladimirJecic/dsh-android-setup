#!/usr/bin/env python3
"""Napravi `kljucne_reci_epizoda_NN.md` iz kompaktnog JSON-a.

Upotreba:
    python3 napravi_md.py <titl.srt> <unosi.json> <izlaz.md> [<naslov epizode>]

`unosi.json` je lista objekata:

    [
      {"naslov": "die Waise / die Waisen",
       "znacenje": "siroče / siročad",
       "prevod": "poslednji je izlaz za siročad koja inače ne mogu nikuda!",
       "objasnjenje": "der Ausweg = izlaz ...",
       "trazi": "Waisen",              // opciono: čime se nalazi u titlu
       "primer": "ist der letzte ..."  // opciono: TAČNA rečenica
      }, ...
    ]

`primer` se uvek proverava da postoji u titlu — ako ne postoji, unos se
prijavljuje umesto da tiho uđe u fajl. Ako `primer` nije dat, skripta ga nađe
preko `trazi` (ili preko najduže reči iz naslova).

Time se izbegava najčešća greška: da se nemački primer prepiše pogrešno.
"""
import json
import re
import sys

TAG_RE = re.compile(r"<[^>]+>")


def ucitaj_titl(path):
    raw = open(path, encoding="utf-8").read()
    out = []
    for block in raw.strip().split("\n\n"):
        parts = block.split("\n")
        if len(parts) < 3 or "-->" not in parts[1]:
            continue
        text = re.sub(r"\s+", " ", TAG_RE.sub("", " ".join(parts[2:]))).strip()
        out.append(text)
    return out


def kljuc_za(naslov, trazi):
    if trazi:
        return trazi
    # "der Ministrant / die Ministrantin" -> "Ministrantin"; "je … desto" -> "desto"
    delovi = re.split(r"[/,(]", naslov)[0]
    reci = [w for w in re.findall(r"[A-Za-zÄÖÜäöüß]{4,}", delovi)]
    return max(reci, key=len) if reci else naslov


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    srt, unos_path, izlaz = sys.argv[1], sys.argv[2], sys.argv[3]
    broj = sys.argv[4] if len(sys.argv) > 4 else "NN"
    opis = sys.argv[5] if len(sys.argv) > 5 else f"{broj}. epizodu"

    reci = ucitaj_titl(srt)
    spojeno = " || ".join(reci)
    unosi = json.load(open(unos_path, encoding="utf-8"))

    delovi, greske = [], []
    for i, u in enumerate(unosi, 1):
        primer = u.get("primer")
        if primer:
            if primer not in spojeno:
                greske.append(f"[{i}] {u['naslov']}: primer nije u titlu -> {primer[:60]}")
                primer = None
        if not primer:
            k = kljuc_za(u["naslov"], u.get("trazi"))
            nadjeni = [t for t in reci if re.search(r"\b" + re.escape(k), t, re.I)]
            if not nadjeni:
                greske.append(f"[{i}] {u['naslov']}: NEMA u titlu (traženo: {k})")
                continue
            primer = nadjeni[0]

        blok = [f"### {i}. {u['naslov']}", "",
                f"- **Značenje:** {u['znacenje']}",
                f"- **Primer iz titla:** *„{primer}“*",
                f"- **Prevod primera:** {u['prevod']}"]
        if u.get("objasnjenje"):
            blok.append(f"- **Dodatno objašnjenje:** {u['objasnjenje']}")
        delovi.append("\n".join(blok))

    zaglavlje = (f"# Detaljne ključne reči i fraze - Epizoda {broj}\n\n"
                 "Ovaj dokument je kreiran pomoću specijalizovanog skill-a "
                 f"`kljucne-reci-nemacki` za {opis}. Svaka stavka sadrži tačan "
                 "primer rečenice iz originalnog titla, **pravi prevod te "
                 "rečenice na srpski**, značenje i — samo kada je potrebno — "
                 "dodatno objašnjenje.\n")
    open(izlaz, "w", encoding="utf-8").write(
        zaglavlje + "\n---\n\n" + "\n\n---\n\n".join(delovi) + "\n\n---\n")

    print(f"unosa: {len(delovi)}   napisano: {izlaz}")
    for g in greske:
        print("  GRESKA:", g)
    return 1 if greske else 0


if __name__ == "__main__":
    sys.exit(main())
