#!/usr/bin/env python3
"""Dijagnoza epizode u JEDNOM pozivu — pre dopune rečnika.

Upotreba:
    python3 dijagnoza.py <titl.srt>

Ispisuje:
  1. broj blokova (ukupno, jedan/dva reda u izvoru);
  2. za svaki blok koji ostaje BEZ prevoda — nepoznate reči u njemu;
  3. najčešće nepoznate reči u celoj epizodi (prioritet za rečnik).

Ovo zamenjuje dva odvojena prolaza (dijagnoza praznih blokova + analiza
učestalosti) i jedini je korak koji treba pogledati pre pisanja dodataka.
"""
import collections
import importlib.util
import re
import sys

GEN = "/data/data/com.termux/files/home/.dsh/skills/partial-prevod/generate_partial_srt.py"


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    srt = sys.argv[1]

    spec = importlib.util.spec_from_file_location("g", GEN)
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)

    entries = g.parse_srt(open(srt, encoding="utf-8").read())
    poznato = (set(g.LEX) | set(g.PREP) | set(g.NAMES) | set(g.STOP)
               | set(g.CASE_NOUNS) | set(g.REFL) | set(g.A1) | set(g.SKIP))

    jednorednih = sum(1 for _, _, l in entries
                      if len([x for x in l if x.strip()]) == 1)
    print(f"blokova: {len(entries)}   izvor jedan red: {jednorednih}, "
          f"dva reda: {len(entries) - jednorednih}")

    recent, prazni = {}, []
    sve = collections.Counter()
    for i, (no, ts, lines) in enumerate(entries):
        tekst = g.plain(lines)
        src_rows = len([x for x in lines if x.strip()])
        if not g.key_words(tekst, recent, i, src_rows=src_rows):
            nepoznate = []
            for w in [m.group(0) for m in g.WORD_RE.finditer(tekst)]:
                lw = w.lower()
                if lw in poznato:
                    continue
                e = (g.REFL.get(lw)
                     or (g.CASE_NOUNS.get(lw) if w[0].isupper() else None)
                     or g.LEX.get(lw) or g.PREP.get(lw))
                if not e:
                    nepoznate.append(w)
            prazni.append((no, tekst, nepoznate))
        for w in g.WORD_RE.findall(tekst):
            if w.lower() not in poznato and len(w) >= 4:
                sve[w.lower()] += 1

    print(f"\n--- BEZ PREVODA: {len(prazni)} blokova ---")
    for no, tekst, nepoznate in prazni:
        print(f"[{no}] {tekst}")
        if nepoznate:
            print("      NEPOZNATO:", " ".join(nepoznate))

    print(f"\n--- najčešće nepoznate reči (top 80) ---")
    print(" ".join(w for w, _ in sve.most_common(80)))


if __name__ == "__main__":
    main()
