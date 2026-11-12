#!/usr/bin/env python3
"""Spoji epizodne dodatke u trajni lexikon.json — sa zaštitom.

Upotreba:
    python3 sacuvaj_recnik.py <folder epizode> [--obrisi]

Odbija (i ispiše zašto):
  * prazna polja i prevode sa zapetom;
  * A1 dodatke koji nisu oblik reči iz osnovne A1 liste — „teška” reč se ne
    sme sakriti u A1 da bi nestala sa spiska nepoznatih;
  * SKIP dodatke bez blizanca ili čiji blizanac nije sličan ({"reč": "blizanac"});
  * STOP / NAMES dodatke koji već imaju prevod u LEX-u (to su prave reči).
Odbijeno ostaje u lexikon_dodaci.json, pa se ništa ne gubi.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_partial_srt as g  # noqa: E402


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    lokalni = os.path.join(sys.argv[1], g.DODACI)
    if not os.path.exists(lokalni):
        sys.exit(f"nema {lokalni} — ništa za spajanje")
    novi = json.load(open(lokalni, encoding="utf-8"))
    trajni = json.load(open(g.TRAJNI, encoding="utf-8")) if os.path.exists(g.TRAJNI) else {}
    g.ucitaj_recnik()                      # samo trajni, za proveru STOP/NAMES
    ok, odbijeno, poruke = g.proveri_dodatke(novi)
    prazno = [k for t in ("LEX", "REFL", "CASE_NOUNS", "PREP")
              for k, v in novi.get(t, {}).items() if not (isinstance(v, str) and v.strip())]
    if prazno:
        for k in prazno:
            odbijeno.setdefault("LEX", {})[k] = ""
        poruke.append(f"nepopunjeno: {' '.join(prazno)}")

    for t, v in ok.items():
        if isinstance(v, dict):
            trajni.setdefault(t, {}).update(v)
        else:
            trajni[t] = sorted(set(trajni.get(t, [])) | set(v))
    with open(g.TRAJNI, "w", encoding="utf-8") as fh:
        json.dump(trajni, fh, ensure_ascii=False, indent=1, sort_keys=True)
    print("lexikon.json:", ", ".join(f"{k} {len(v)}" for k, v in sorted(trajni.items())))

    if odbijeno:
        for p in poruke:
            print("  ODBIJENO", p)
        odbijeno["_uputstvo"] = novi.get("_uputstvo", "")
        odbijeno["_kontekst"] = novi.get("_kontekst", {})
        with open(lokalni, "w", encoding="utf-8") as fh:
            json.dump(odbijeno, fh, ensure_ascii=False, indent=1)
        print(f"\nodbijene stavke ostale su u {lokalni} — popravi ih")
        sys.exit(1)
    if "--obrisi" in sys.argv:
        os.remove(lokalni)
        print(f"obrisan {lokalni}")


if __name__ == "__main__":
    main()
