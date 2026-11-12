#!/usr/bin/env python3
"""QA kapija — pokreni POSLE generisanja, a PRE ffmpeg-a.

Upotreba:
    python3 proveri_prevod.py <titl.deDE.srt> [izlaz_basename]

Proverava:
  1. da nema NEPOZNATIH reči i NEPOPUNJENIH polja u lexikon_dodaci.json;
  2. da je partial-prevod.srt noviji od rečnika (inače: regeneriši);
  3. KOGNATE među prikazanim stavkama (idu u SKIP);
  4. zapete unutar prevoda (zapeta razdvaja stavke, pa kvari red);
  5. raspored: broj redova, širine, najduži red.

Izlazni kod 0 = sme render.  1 = popravi pa ponovi generisanje i ovu proveru.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_partial_srt as g  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    base = sys.argv[2] if len(sys.argv) > 2 else "partial-prevod"
    folder = os.path.dirname(os.path.abspath(src))
    out_srt = os.path.join(folder, base + ".srt")
    g.ucitaj_recnik(src)
    problemi = []

    # 1. nepoznato / nepopunjeno
    _, nep = g.analiziraj(g.ucitaj_srt(src))
    if g.ODBIJENO:
        problemi.append("odbijeni dodaci:\n      " + "\n      ".join(g.ODBIJENO))
    if g.NEPOPUNJENO:
        problemi.append(f"nepopunjeno u {g.DODACI}: {len(g.NEPOPUNJENO)} -> "
                        + " ".join(g.NEPOPUNJENO[:30]))
    if nep:
        problemi.append(f"nepoznato u titlu: {len(nep)} -> " + " ".join(list(nep)[:30])
                        + "   (pokreni dijagnoza.py)")

    # 2. zastareo izlaz
    if not os.path.exists(out_srt):
        sys.exit(f"nema {out_srt} — prvo generate_partial_srt.py")
    t_out = os.path.getmtime(out_srt)
    for p in (g.TRAJNI, os.path.join(folder, g.DODACI)):
        if os.path.exists(p) and os.path.getmtime(p) > t_out:
            problemi.append(f"{os.path.basename(p)} je menjan posle generisanja "
                            "— pokreni generate_partial_srt.py ponovo")

    # 3-5. sadržaj izlaza
    blokovi = [b for b in open(out_srt, encoding="utf-8").read().strip().split("\n\n")
               if "{\\an8}" in b]
    stavke, redova, preko, najduzi = set(), {}, 0, ""
    for b in blokovi:
        rows = b.split("\n", 2)[2].replace("{\\an8}", "").split("\\N")
        redova[len(rows)] = redova.get(len(rows), 0) + 1
        for r in rows:
            if len(r) > len(najduzi):
                najduzi = r
            preko += len(r) > g.MAX_CHARS
            stavke.update(it for it in r.split(", ") if " = " in it)
    kognati = sorted(it for it in stavke if g.je_kognat(it))
    zapete = sorted(it for it in stavke if " = " not in it)
    sa_zapetom = [k for k, v in g.LEX.items() if ", " in v.partition(" = ")[2]]

    # isti nemački izraz mora svuda imati iste prevode (redosled alternativa nije važan)
    # zagrada na kraju je samo pokazni oblik te rečenice — ne računa se u razliku
    def bez_skracenice(s):
        while True:                                   # i „(an + Dativ) (nimmst … teil)”
            s2 = re.sub(r"\s*\([^()]*\)\s*$", "", s)
            if s2 == s:
                break
            s = s2
        return frozenset(x.strip() for x in s.split(" / ") if x.strip())

    po_nemackom = {}
    for it in stavke:
        nem, _, srp = it.partition(" = ")
        po_nemackom.setdefault(nem.strip(), []).append((srp.strip(), bez_skracenice(srp)))
    nedosledno = {}
    for nem, varijante in po_nemackom.items():
        if len({v for _, v in varijante}) > 1:
            nedosledno[nem] = sorted({s for s, _ in varijante})

    print(f"blokova sa prevodom: {len(blokovi)}, različitih stavki: {len(stavke)}")
    print("redova po bloku   :", ", ".join(f"{k}: {v}" for k, v in sorted(redova.items())))
    print(f"redova preko {g.MAX_CHARS}  : {preko}  (najduži {len(najduzi)})")
    if kognati:
        problemi.append(f"kognati ({len(kognati)}) -> u SKIP kao {{reč: blizanac}}, "
                        "ili u NIJE_KOGNAT ako ipak vredi da se prikaže:\n      "
                        + "\n      ".join(kognati))
    if sa_zapetom:
        problemi.append("zapeta u prevodu (zameni sa ' / '): " + " ".join(sa_zapetom[:20]))
    if nedosledno:
        problemi.append(
            f"isti izraz sa različitim prevodom ({len(nedosledno)}) — uskladi u "
            "rečniku, isti izraz svuda isto:\n      "
            + "\n      ".join(f"{k}: " + "  vs  ".join(v)
                              for k, v in list(nedosledno.items())[:15]))
    if zapete:
        problemi.append("pokvarene stavke (bez ' = '): " + " | ".join(zapete[:10]))

    # samo upozorenje (ne blokira render): isti ključ u više tabela
    tabele = {t: getattr(g, t) for t in ("LEX", "CASE_NOUNS", "REFL", "PREP")}
    vidi = {}
    for t, tab in tabele.items():
        for k in tab:
            vidi.setdefault(k, []).append(t)
    vise = {k: v for k, v in vidi.items() if len(v) > 1}
    if vise:
        print(f"NAPOMENA: {len(vise)} ključeva postoji u više tabela "
              f"(npr. {', '.join(list(vise)[:6])}) — generator bira jedan po redu "
              "pretrage; proveri da prikazani oblik odgovara kontekstu.")

    if problemi:
        print("\nNE RENDERUJ — popravi:")
        for p in problemi:
            print("  •", p)
        return 1
    print("\nOK — sme render.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
