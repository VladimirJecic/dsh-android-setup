#!/usr/bin/env python3
"""Sve QA provere za partial-prevod u jednom prolazu — PRE renderovanja.

Upotreba:
    python3 proveri_prevod.py <partial-prevod.srt> [<partial-prevod.ass>]

Ispisuje:
  * broj blokova sa/bez prevoda i listu praznih (prioritet za LEX);
  * raspored redova (jedan/dva reda), ukupno stavki, koliko redova prelazi
    MAX_CHARS i najduži red;
  * KOGNATE — prikazane parove gde je nemačka reč praktično ista kao srpska
    (oni idu u SKIP i zahtevaju ponovnu generaciju).

Pokreni ovo PRE ffmpeg-a. Ako se posle ovoga menja rečnik, render je bačen.
"""
import re
import sys

MAX_CHARS = 84


def norm(x):
    return re.sub(r"[^a-zäöüß]", "", x.lower())


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    srt_path = sys.argv[1]
    srt = open(srt_path, encoding="utf-8").read()
    blocks = [b for b in srt.strip().split("\n\n") if "-->" in b]
    vocab = [b for b in blocks if "{\\an8}" in b]
    dialogue = [b for b in blocks if "{\\an8}" not in b]

    one = two = items = over = 0
    longest = ("", 0)
    all_items = set()
    for b in vocab:
        rows = b.split("\n", 2)[2].replace("{\\an8}", "").split("\\N")
        if len(rows) == 1:
            one += 1
        else:
            two += 1
        for r in rows:
            items += len(r.split(", "))
            if len(r) > longest[1]:
                longest = (r, len(r))
            if len(r) > MAX_CHARS:
                over += 1
            for it in r.split(", "):
                if " = " in it:
                    all_items.add(it)

    print(f"SRT evenata        : {len(blocks)}  (prevod: {len(vocab)}, "
          f"prazno: {len(dialogue) - len(vocab)})")
    print(f"redova             : jedan {one}, dva {two}")
    print(f"ukupno stavki      : {items}")
    print(f"redova preko {MAX_CHARS} : {over}   najduži: {longest[1]} znakova")
    if over:
        print(f"   -> {longest[0][:100]}")

    print("\n--- KOGNATI (kandidati za SKIP) ---")
    flagged = 0
    for it in sorted(all_items):
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
            print(f"  {it}")
            flagged += 1
    if not flagged:
        print("  (nema — svi prikazani parovi nose novo značenje)")
    print(f"\nkognata: {flagged}")
    print("\nAko ima kognata: dodaj ih u SKIP, regeneriši, pa tek onda renderuj.")
    return 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main())
