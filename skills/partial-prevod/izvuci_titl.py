#!/usr/bin/env python3
"""Izvuci ugrađeni NEMAČKI titl iz MKV-a (ili MP4/WEBM) u .deDE.srt.

Upotreba:
    python3 izvuci_titl.py <video.mkv>              # sam bira nemački titl
    python3 izvuci_titl.py <video.mkv> --lista      # samo ispiši trake
    python3 izvuci_titl.py <video.mkv> --traka 2    # 3. titl-traka (s:2)
    python3 izvuci_titl.py <video.mkv> --prepisi    # pregazi postojeći .srt
    python3 izvuci_titl.py <video.mkv> --izlaz .    # napiši u tekući folder

Piše <folder videa>/<ime videa>.deDE.srt i na kraju ispiše komandu za render
preko skilla burn-subtitle.  Ako je video u roditeljskom folderu (a radni
folder je epizoda), OBAVEZNO dodaj `--izlaz .` — inače titl ode pored videa i
sledeći korak (dijagnoza nad epizodom) padne na „nema titla”.

Kako bira traku:  tekstualni titl (subrip/ass/ssa/webvtt/mov_text) sa jezikom
ger/deu/de ili naslovom "Deutsch/German".  Prednost ima pun titl: ne "forced",
naslov bez "Signs/Songs/Forced/Zeichen", pa onaj sa najviše titl-blokova.
Slikovni titl (PGS/VobSub) ne može da se pretvori u tekst bez OCR-a — skripta
tada jasno kaže šta je problem umesto da napravi prazan fajl.
"""
import json
import os
import re
import subprocess
import sys

TEKST = {"subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"}
SLIKA = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"}
NEMACKI = {"ger", "deu", "de", "gsw"}
DELIMICNI = re.compile(r"forced|sign|song|zeichen|lied|schild|karaoke", re.I)


def sondiraj(video):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=index,codec_type,codec_name:stream_tags:stream_disposition",
         "-of", "json", video],
        capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"GREŠKA ffprobe: {r.stderr.strip()}")
    return json.loads(r.stdout).get("streams", [])


def opis(s):
    t = s.get("tags", {})
    jez = (t.get("language") or "").lower()
    naslov = t.get("title") or ""
    broj = next((v for k, v in t.items() if k.upper().startswith("NUMBER_OF_FRAMES")), None)
    return {
        "index": s["index"], "kodek": s.get("codec_name", "?"), "jezik": jez,
        "naslov": naslov, "forced": bool(s.get("disposition", {}).get("forced")),
        "blokova": int(broj) if broj and str(broj).isdigit() else None,
    }


def je_nemacki(o):
    return o["jezik"] in NEMACKI or re.search(r"deutsch|german|\bde\b", o["naslov"], re.I)


def prebroj(video, index):
    r = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams",
                        str(index), "-show_entries", "stream=nb_read_packets",
                        "-of", "csv=p=0", video], capture_output=True, text=True)
    try:
        return int(r.stdout.strip().split()[0])
    except (ValueError, IndexError):
        return 0


def ispisi(titlovi):
    for i, o in enumerate(titlovi):
        print(f"  s:{i}  #{o['index']}  {o['kodek']:<18} jezik={o['jezik'] or '?':<4}"
              f" forced={'da' if o['forced'] else 'ne'}  blokova={o['blokova'] or '?'}"
              f"  {o['naslov']}")


def main():
    # opcije koje uzimaju vrednost: njihova vrednost nije video
    S_VREDNOSCU = {"--traka", "--izlaz"}
    args, preskoci = [], False
    for a in sys.argv[1:]:
        if preskoci:
            preskoci = False
            continue
        if a in S_VREDNOSCU:
            preskoci = True
            continue
        if not a.startswith("--"):
            args.append(a)
    if not args:
        print(__doc__)
        sys.exit(1)
    video = args[0]
    if not os.path.exists(video):
        sys.exit(f"nema fajla {video} — redosled je: izvuci_titl.py \"<video>\" [--izlaz DIR] [--traka N]")
    streams = sondiraj(video)
    titlovi = [opis(s) for s in streams if s.get("codec_type") == "subtitle"]
    if not titlovi:
        sys.exit("U videu nema ugrađenih titlova. Treba poseban .deDE.srt fajl.")

    print("titl-trake:")
    ispisi(titlovi)
    if "--lista" in sys.argv:
        return

    if "--traka" in sys.argv:
        n = int(sys.argv[sys.argv.index("--traka") + 1])
        izbor = titlovi[n]
        if izbor["kodek"] in SLIKA:
            sys.exit(f"s:{n} je slikovni titl ({izbor['kodek']}) — vidi poruku o OCR-u ispod.")
    else:
        nem = [o for o in titlovi if je_nemacki(o)]
        tekst = [o for o in nem if o["kodek"] in TEKST]
        if not tekst:
            if any(o["kodek"] in SLIKA for o in nem):
                sys.exit(
                    "\nNemački titl postoji, ali je SLIKOVNI (PGS/VobSub) — to su slike,\n"
                    "ne tekst, pa se reči ne mogu izdvojiti bez OCR-a. Opcije:\n"
                    "  • nađi .deDE.srt za tu epizodu i stavi ga u folder;\n"
                    "  • na računaru: Subtitle Edit (OCR, jezik German) -> izvezi .srt.")
            sys.exit("\nNema trake označene kao nemačka. Ako znaš koja je, pokreni sa "
                     "--traka N (N iz kolone s:N gore).")
        if len(tekst) > 1:
            for o in tekst:
                if o["blokova"] is None:
                    o["blokova"] = prebroj(video, o["index"])
        tekst.sort(key=lambda o: (o["forced"], bool(DELIMICNI.search(o["naslov"])),
                                  -(o["blokova"] or 0)))
        izbor = tekst[0]

    stem = os.path.splitext(os.path.basename(video))[0]
    folder = os.path.dirname(os.path.abspath(video))
    if "--izlaz" in sys.argv:
        i = sys.argv.index("--izlaz")
        if i + 1 >= len(sys.argv):
            sys.exit("GREŠKA: --izlaz traži folder, npr. --izlaz .")
        folder = os.path.abspath(sys.argv[i + 1])
        os.makedirs(folder, exist_ok=True)
    izlaz = os.path.join(folder, stem + ".deDE.srt")
    print(f"\nizabrana traka #{izbor['index']} ({izbor['kodek']}, {izbor['naslov'] or 'bez naslova'})")
    if os.path.exists(izlaz) and "--prepisi" not in sys.argv:
        print(f"{izlaz} već postoji — ne diram ga (--prepisi za novo izvlačenje)")
    else:
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video,
                            "-map", f"0:{izbor['index']}", "-c:s", "srt", izlaz],
                           capture_output=True, text=True)
        if r.returncode or not os.path.exists(izlaz):
            sys.exit(f"GREŠKA ffmpeg: {r.stderr.strip()}")
    with open(izlaz, encoding="utf-8", errors="replace") as fh:
        blokova = fh.read().count("-->")
    print(f"napisano: {izlaz}  ({blokova} blokova)")
    if blokova == 0:
        sys.exit("GREŠKA: titl je prazan — probaj drugu traku sa --traka N")
    if blokova < 80:
        print("UPOZORENJE: malo blokova — možda je ovo samo 'forced'/znakovi, "
              "a ne pun dijalog. Proveri --lista.")

    # ---- render radi skill burn-subtitle (bira englesku audio traku sam)
    print("\nRENDER (tek posle proveri_prevod.py i kritike):")
    print(f'  python3 ~/.dsh/skills/burn-subtitle/burn.py -i "{os.path.basename(video)}" '
          f'-s partial-prevod.ass -o "NN-sub-burnt-vocab.mp4" --pozadina')
    print('  (engleski audio, 8-bit H.264; napredak: burn.py --status "NN-sub-burnt-vocab.mp4")')

if __name__ == "__main__":
    main()
