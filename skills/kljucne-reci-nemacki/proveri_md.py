#!/usr/bin/env python3
"""Sve provere za kljucne_reci_epizoda_NN.md u jednom prolazu.

Upotreba:
    python3 proveri_md.py <kljucne_reci_epizoda_NN.md> [<titl.srt>]

Proverava:
  1. da svaki unos ima oba polja (Primer iz titla / Prevod primera);
  2. da nijedan prevod nije prepisan nemački tekst;
  3. da je svaki primer VERBATIM iz titla (ako je dat .srt);
  4. da svaka sadržajna reč iz primera ima svoje značenje u tom unosu.

Izlaz: lista problema i broj preostalih „sumnjivih“ reči. Kod (4) su česti
lažni pozitivi jer se poredi gruba osnova reči — proveri rukom.
"""
import glob
import re
import sys

FUNC = set("""dass eine einen einem eines seine seinen seiner ihrer ihre ihrem
ihren diese dieser dieses nicht sind wird werden hat habe haben dann oder aber
wenn weil auch sehr nach noch beim vom zum zur aus mit auf für über unter durch
gegen ohne um zu im in an bei von vor ist war waren sein man sich also hier kein
mich dich euch unser unsere seinem will werde kommt müssen""".split())

# reči koje početnik zna; ne moraju imati svoje značenje u unosu
BASIC = set("""wirklich letzte sonst etwas möchtest diesen damit große arbeit
bleibt kannst wirst gehen bevor gelaufen schon lässt leben dabei deiner heute
morgen immer wieder alles nichts jemand jede jeder""".split())


def norm(x):
    return re.sub(r"[^\wäöüßÄÖÜ ]", "", x).lower().strip()


def entries(text):
    for b in text.split("### ")[1:]:
        title = b.split("\n")[0].strip()
        ex = re.search(r"\*\*Primer iz titla:\*\* \*„(.+?)“\*", b)
        tr = re.search(r"\*\*Prevod primera:\*\* (.+)", b)
        yield b, title, (ex.group(1).strip() if ex else None), \
            (tr.group(1).strip() if tr else None)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    md = sys.argv[1]
    srt = sys.argv[2] if len(sys.argv) > 2 else None
    text = open(md, encoding="utf-8").read()

    srt_texts = []
    if srt:
        raw = open(srt, encoding="utf-8").read()
        srt_texts = [re.sub(r"<[^>]+>", "", " ".join(b.split("\n")[2:])).strip()
                     for b in raw.strip().split("\n\n") if "-->" in b]
    joined = " || ".join(srt_texts)

    problems = 0
    suspect = 0
    n = 0
    print("--- problemi ---")
    for body, title, ex, tr in entries(text):
        n += 1
        if not ex or not tr:
            print(f"  BEZ POLJA: {title}")
            problems += 1
            continue
        if norm(ex) == norm(tr):
            print(f"  PREVOD = NEMACKI: {title}")
            problems += 1
        if srt and ex not in joined:
            print(f"  NIJE VERBATIM: {title} -> {ex[:70]}")
            problems += 1
        low = re.sub(r"\*\*Primer iz titla:\*\* \*„.+?“\*", "", body).lower()
        for w in sorted(set(re.findall(r"[A-Za-zÄÖÜäöüß]{5,}", ex))):
            lw = w.lower()
            if lw in FUNC or lw in BASIC:
                continue
            if lw[:max(5, len(lw) - 3)] in low:
                continue
            print(f"  BEZ ZNACENJA [{title}]: {w}")
            suspect += 1

    print(f"\nunosa: {n}   problema: {problems}   sumnjivih reci: {suspect}")
    if not srt:
        print("(bez .srt argumenta provera verbatim je preskočena)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
