#!/usr/bin/env python3
"""Trajno sačuvaj epizodne dodatke rečnika u `lexikon.json`.

Upotreba:
    python3 sacuvaj_recnik.py <folder epizode> [--obrisi]

Uzme `<folder>/lexikon_dodaci.json`, spoji ga u
`~/.dsh/skills/partial-prevod/lexikon.json` (koji generator učitava za svaku
epizodu) i — uz `--obrisi` — ukloni epizodni fajl.

Time rečnik raste bez patch-ovanja `generate_partial_srt.py`, pa nema više
orijentira koji se pomeraju, `.bak` kopija ni ponovnog čitanja skripte.
"""
import json
import os
import sys

SKILL = os.path.dirname(os.path.abspath(__file__))
TRAJNI = os.path.join(SKILL, "lexikon.json")
LISTE = ("SKIP", "A1", "STOP", "NAMES")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    epizoda = sys.argv[1]
    lokalni = os.path.join(epizoda, "lexikon_dodaci.json")
    if not os.path.exists(lokalni):
        print(f"nema {lokalni} — ništa za spajanje")
        sys.exit(1)

    novi = json.load(open(lokalni, encoding="utf-8"))
    trajni = json.load(open(TRAJNI, encoding="utf-8")) if os.path.exists(TRAJNI) else {}

    for kljuc, vrednost in novi.items():
        if kljuc in LISTE:
            spoj = set(trajni.get(kljuc, [])) | set(vrednost)
            trajni[kljuc] = sorted(spoj)
        else:
            trajni.setdefault(kljuc, {}).update(vrednost)

    json.dump(trajni, open(TRAJNI, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1, sort_keys=True)

    ukupno = sum(len(v) for v in trajni.values())
    print(f"lexikon.json: {ukupno} stavki "
          f"({', '.join(f'{k} {len(v)}' for k, v in sorted(trajni.items()))})")

    if "--obrisi" in sys.argv:
        os.remove(lokalni)
        print(f"obrisan {lokalni}")


if __name__ == "__main__":
    main()
