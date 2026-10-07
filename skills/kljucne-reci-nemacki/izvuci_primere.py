#!/usr/bin/env python3
"""Izvuci STVARNE rečenice iz titla za zadate nemačke reči i ispiši skeleton .md.

Upotreba:
    python3 izvuci_primere.py <titl.srt> [--sve] <rec1> [<rec2> ...]

Za svaku reč ispiše:
    - broj bloka i vreme (za proveru u kadru ako zatreba)
    - TAČNU rečenicu iz titla (nikad je ne prepisuj ručno)
    - skeleton markdown unosa sa praznim poljima za prevod i objašnjenje

Tako se izbegava i najčešća greška — da se nemčki primer prepiše pogrešno.
"""
import re
import sys

TAG_RE = re.compile(r"<[^>]+>")


def load(path):
    raw = open(path, encoding="utf-8").read()
    out = []
    for block in raw.strip().split("\n\n"):
        parts = block.split("\n")
        if len(parts) < 3 or "-->" not in parts[1]:
            continue
        text = TAG_RE.sub("", " ".join(parts[2:])).strip()
        text = re.sub(r"\s+", " ", text)
        out.append((parts[1].split(" --> ")[0], text))
    return out


def find(blocks, term):
    """Vrati blokove koji sadrže `term`, najpre kao celu reč, pa kao podnisku."""
    pat = re.compile(r"\b" + re.escape(term), re.I)
    hits = [(t, s) for t, s in blocks if pat.search(s)]
    if hits:
        return hits
    return [(t, s) for t, s in blocks if term.lower() in s.lower()]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    args = sys.argv[2:]
    every = False
    if args and args[0] == "--sve":
        every = True
        args = args[1:]
    blocks = load(path)
    print(f"# {path}\n# blokova: {len(blocks)}\n")
    for i, term in enumerate(args, 1):
        hits = find(blocks, term)
        if not hits:
            print(f"### {i}. {term}\n\n- **NEMA U TITLU** — proveri pravopis.\n\n---\n")
            continue
        print(f"### {i}. {term}\n")
        for t, s in (hits if every else hits[:1]):
            print(f"- **Primer iz titla:** *„{s}“*   `[{t}]`")
            print("- **Prevod primera:** ")
            print("- **Dodatno objašnjenje:** ")
        if len(hits) > 1 and not every:
            print(f"- *(još {len(hits) - 1} pojava: " +
                  "; ".join(f"`[{t}]`" for t, _ in hits[1:4]) + ")*")
        print("\n---\n")


if __name__ == "__main__":
    main()
