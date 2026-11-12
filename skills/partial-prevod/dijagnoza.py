#!/usr/bin/env python3
"""Dijagnoza epizode — prvi korak, PRE pisanja prevoda.

Upotreba:
    python3 dijagnoza.py <titl.deDE.srt> [--bez-upisa]

1. Prođe kroz titl istom funkcijom kojom generator bira reči (`potrazi`).
2. Ispiše blokove koji ostaju bez prevoda i SVE nepoznate reči (osnovni
   oblik, oblici iz titla, broj pojavljivanja, primer rečenice).
3. Upiše ih u <folder titla>/lexikon_dodaci.json kao PRAZNA polja:

       "LEX": {"mut": "", "aufschlagen": ""}

   Posao agenta je samo da popuni svako prazno polje (ili da ključ prebaci u
   SKIP / NAMES — vidi SKILL.md).  Ne treba tražiti šta fali: sve je već tu.
   Postojeći sadržaj fajla se čuva; dodaju se samo novi ključevi.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_partial_srt as g  # noqa: E402

UPUTSTVO = ("Popuni svako prazno polje u LEX: 'der/die/das Imenica = prevod', "
            "'glagol = prevod', 'pridev = prevod'. Alternative sa ' / ', nikad zapeta. "
            "Ime lika -> obriši iz LEX i dodaj u NAMES. Internacionalizam -> obriši iz "
            "LEX i dodaj u SKIP kao {\"reč\": \"srpski/engleski blizanac\"}. "
            "_kontekst je samo pomoć, generator ga ignoriše.")


def okno(tekstovi, z):
    """`oblici | «prethodni blok» ⏵ rečenica ⏴ «sledeći blok»` — scena oko reči."""
    oblici = sorted(z["oblici"])
    niz = [o.lower() for o in oblici]
    i = next((j for j, t in enumerate(tekstovi)
              if any(o in t.lower() for o in niz)), 0)
    pre = tekstovi[i - 1] if i > 0 else ""
    posle = tekstovi[i + 1] if i + 1 < len(tekstovi) else ""
    delovi = ["/".join(oblici), f"«{pre}»" if pre else "", f"⏵ {z['primer']}"]
    if posle:
        delovi.append(f"⏴ «{posle}»")
    return " | ".join(x for x in delovi if x)[:320]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    srt = sys.argv[1]
    g.ucitaj_recnik(srt)
    entries = g.ucitaj_srt(srt)
    redovi, nep = g.analiziraj(entries)
    if not g.IMA_LEMU:
        print("UPOZORENJE: nema simplemma (pip install simplemma) — "
              "biće mnogo više 'nepoznatih' oblika\n")

    prazni = [(no, g.plain(l)) for (no, _, l), r in zip(entries, redovi) if not r]
    print(f"blokova: {len(entries)}, bez prevoda: {len(prazni)}")
    for no, t in prazni:
        print(f"  [{no}] {t}")

    print(f"\n--- NEPOZNATO: {len(nep)} reči "
          f"({sum(z['n'] for z in nep.values())} pojavljivanja) ---")
    for k, z in sorted(nep.items(), key=lambda kv: -kv[1]["n"]):
        print(f"  {z['n']:>3}  {k:<22} {', '.join(sorted(z['oblici']))[:40]}")

    if "--bez-upisa" in sys.argv or not nep:
        return
    put = os.path.join(os.path.dirname(os.path.abspath(srt)), g.DODACI)
    d = {}
    if os.path.exists(put):
        with open(put, encoding="utf-8") as fh:
            d = json.load(fh)
    d["_uputstvo"] = UPUTSTVO
    lex, ctx = d.setdefault("LEX", {}), d.setdefault("_kontekst", {})
    tekstovi = [g.plain(l) for (_no, _ts, l) in entries]
    novih = 0
    for k, z in nep.items():
        if k not in lex:
            lex[k] = ""
            novih += 1
        ctx[k] = okno(tekstovi, z)
    for ime in ("SKIP", "NAMES"):
        d.setdefault(ime, {} if ime == "SKIP" else [])
    with open(put, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)

    # ceo titl u redosledu — agent ga pročita jednom da uhvati radnju i likove
    tr = os.path.join(os.path.dirname(os.path.abspath(srt)), "transkript.md")
    with open(tr, "w", encoding="utf-8") as fh:
        fh.write(f"# Transkript: {os.path.basename(srt)} "
                 f"({len(entries)} blokova)\n\n"
                 "Nemačke rečenice REDOM kako idu u epizodi. Pročitaj ovo pre "
                 "popunjavanja rečnika: pomaže kod elipsi („Pass!”), imena likova "
                 "i idioma koji se ponavljaju — isti izraz svuda isto prevedi.\n\n")
        for no, ts, lines in entries:
            fh.write(f"[{no}] {ts[:8]}  {g.plain(lines)}\n")

    print(f"\nupisano {novih} novih praznih polja u {put}")
    print(f"transkript: {tr}")
    print("SLEDEĆE: popuni sva prazna polja, pa generate_partial_srt.py "
          "i proveri_prevod.py")


if __name__ == "__main__":
    main()
