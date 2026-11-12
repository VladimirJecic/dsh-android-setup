#!/usr/bin/env python3
"""Napravi paket za nezavisnog kritičara (translation-critiquer).

Upotreba:
    python3 paket_za_kritiku.py <titl.deDE.srt>

Piše <folder titla>/kritika_paket.md: za svaki blok nemačku rečenicu i
prikazane stavke sa izvorom ({LEX:einholen}), označene NOVO (dodato u ovoj
epizodi) ili STARO (iz trajnog rečnika), plus blokove bez prevoda.

Paket sadrži SAMO podatke — ne i razmišljanje glavnog agenta.  Kritičar
sudi samo na osnovu rečenice i prikazanog prevoda, pa je pregled nezavisan.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_partial_srt as g  # noqa: E402

TABELE = ("REFL", "CASE_NOUNS", "LEX", "PREP")
HINT_RE = re.compile(r" \([^()]*… [^()]*\)$")   # "(hört … auf)" na kraju


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    folder = os.path.dirname(os.path.abspath(src))
    g.ucitaj_recnik(src)

    novi = set()
    put = os.path.join(folder, g.DODACI)
    if os.path.exists(put):
        d = json.load(open(put, encoding="utf-8"))
        for t in TABELE:
            novi |= {k.lower() for k in d.get(t, {})}

    # obrnuti indeks: prikazana stavka -> (tabela, ključ)
    izvor = {}
    for t in TABELE:
        for k, v in getattr(g, t).items():
            izvor.setdefault(v, (t, k))

    entries = g.ucitaj_srt(src)
    redovi, _ = g.analiziraj(entries)
    sa_prevodom = sum(1 for r in redovi if r)
    out = ["# Paket za kritiku", "",
           f"Titl: {os.path.basename(src)} — {len(entries)} blokova "
           f"({sa_prevodom} sa prevodom, {len(entries) - sa_prevodom} bez)", "",
           "Blokovi idu **redom kako se pojavljuju u epizodi** — ovo je transkript "
           "sa stavkama koje se prikazuju. Blok bez stavki označen je "
           "`— bez prevoda`; susedni blokovi smeju da razjasne elipsu "
           "(npr. „Pass!” bez „auf” u istoj liniji).", "",
           "Format: `[blok] nemačka rečenica` pa stavke "
           "`prikaz {TABELA:ključ, NOVO|STARO}`.", ""]
    for (no, _, lines), rows in zip(entries, redovi):
        tekst = g.plain(lines)
        if not rows:
            out.append(f"[{no}] {tekst}   — bez prevoda")
            continue
        out.append(f"[{no}] {tekst}")
        for r in rows:
            for e in r:
                osnova = HINT_RE.sub("", e)
                t, k = izvor.get(e) or izvor.get(osnova) or ("LEX", "?")
                if k == "?" and " = " in e and "(" in e:     # zu-infinitiv
                    k = e.split(" = ")[0].lower()
                oznaka = "NOVO" if k in novi else "STARO"
                out.append(f"   - {e}  {{{t}:{k}, {oznaka}}}")
    put = os.path.join(folder, "kritika_paket.md")
    with open(put, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"napisano: {put}  ({sa_prevodom} blokova sa prevodom, "
          f"{len(entries) - sa_prevodom} bez)")


if __name__ == "__main__":
    main()
