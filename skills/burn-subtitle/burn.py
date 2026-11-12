#!/usr/bin/env python3
"""Upeci titl u video -> MP4 koji puštaju telefon, TV i Chromecast.

Upotreba:
    python3 burn.py -i <video.mkv|mp4> -s <titl.ass|srt> [-o izlaz.mp4] --pozadina
    python3 burn.py -i <video.mkv> -t 0 --pozadina      # ugrađeni titl s:0 iz MKV-a
    python3 burn.py -i <video.mkv> --bez-titla --pozadina   # samo kompatibilan MP4
    python3 burn.py --status <izlaz.mp4>                # napredak / rezultat
    python3 burn.py --stop   <izlaz.mp4>                # prekini render u pozadini

Opcije:
    -o IZLAZ   podrazumevano <ime videa>-sub-burnt.mp4 pored videa
    -l JEZIK   audio jezik (podrazumevano eng; ger, jpn …); ako ga nema -> prvi + upozorenje
    -e ENKODER auto (podrazumevano) | x264 | mediacodec
    -t N       umesto -s: upeci N-tu ugrađenu titl-traku (tekst ili PGS/VobSub slike)
    --bez-titla  bez titla: samo prekodiranje u 8-bit H.264 (kad TV ne pušta HEVC/10-bit)
    --pozadina odmah se vrati, a render radi dalje (agent alat ga NE ubija na 60 s)

Uvek: 8-bit H.264 (yuv420p), jedan audio (traženi jezik, default), bez soft
titlova, +faststart.  Audio se kopira ako je aac/mp3/ac3/eac3, inače -> AAC.
Piše u <izlaz>.part.mp4 i preimenuje tek kad provera prođe — nedovršen
render nikad ne izgleda kao gotov fajl.
"""
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time

KOPIJA_AUDIO = {"aac", "mp3", "ac3", "eac3"}
SLIKOVNI = {"hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"}
JEZICI = {
    "eng": {"eng", "en", "english", "englisch"},
    "ger": {"ger", "deu", "de", "german", "deutsch"},
    "jpn": {"jpn", "ja", "japanese", "japanisch"},
    "srp": {"srp", "scc", "sr", "serbian", "srpski"},
}


def die(msg):
    sys.exit(f"GREŠKA: {msg}")


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                        "-of", "json", path], capture_output=True, text=True)
    if r.returncode:
        die(f"ffprobe: {r.stderr.strip()}")
    return json.loads(r.stdout)


def jezik_odgovara(s, pref):
    t = s.get("tags", {})
    varijante = JEZICI.get(pref, {pref})
    lang = (t.get("language") or "").lower()
    naslov = (t.get("title") or "").lower().replace("(", " ").replace(")", " ")
    return lang in varijante or any(v in naslov.split() for v in varijante if len(v) > 3)


def izaberi_audio(info, pref):
    audio = [s for s in info["streams"] if s["codec_type"] == "audio"]
    if not audio:
        return None, "UPOZORENJE: nema audio zapisa"
    for s in audio:
        if jezik_odgovara(s, pref):
            return s, (f"audio: #{s['index']} {s.get('tags', {}).get('language', '?')} "
                       f"({s['codec_name']})")
    s = audio[0]
    return s, (f"UPOZORENJE: nema audio jezika '{pref}' — uzimam prvi: #{s['index']} "
               f"{s.get('tags', {}).get('language', '?')} ({s['codec_name']})")


def ima_enkoder(ime):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True)
    return ime in r.stdout


def izlaz_za(args):
    nastavak = "-tv.mp4" if "--bez-titla" in args else "-sub-burnt.mp4"
    return os.path.abspath(args.get("-o") or
                           os.path.splitext(os.path.abspath(args["-i"]))[0] + nastavak)


def putanje(izlaz):
    return {"part": izlaz[:-4] + ".part.mp4", "log": izlaz + ".log",
            "prog": izlaz + ".progress", "info": izlaz + ".burn.json",
            "out": izlaz + ".out"}


# ---------------------------------------------------------------- status ----
def status(izlaz):
    izlaz = os.path.abspath(izlaz)
    p = putanje(izlaz)
    if not os.path.exists(p["info"]):
        if os.path.exists(p["log"]):                 # završen sa greškom
            print(open(p["log"]).read()[-1200:])
            return 1
        if os.path.exists(izlaz):
            o = probe(izlaz)
            print(f"GOTOVO: {izlaz}  ({float(o['format'].get('duration', 0)) / 60:.1f} min)")
            return 0
        print("nema rendera za taj izlaz")
        return 1
    info = json.load(open(p["info"]))
    try:
        os.kill(info["pid"], 0)
        ziv = True
    except OSError:
        ziv = False
    us, brzina = 0, "?"
    if os.path.exists(p["prog"]):
        for line in open(p["prog"]).read().splitlines()[-40:]:
            if line.startswith("out_time_us=") and line[12:].strip().isdigit():
                us = int(line[12:])
            elif line.startswith("speed="):
                brzina = line[6:].strip()
    pct = min(100.0, 100 * us / 1e6 / info["trajanje"]) if info["trajanje"] else 0
    proteklo = time.time() - info["start"]
    eta = proteklo * (100 - pct) / pct if pct > 1 else 0
    print(f"{'RADI' if ziv else 'PREKINUT'}  {pct:5.1f}%  brzina {brzina}  "
          f"proteklo {proteklo / 60:.1f} min  preostalo ~{eta / 60:.1f} min  "
          f"enkoder {info.get('enkoder')}")
    if not ziv:
        print("render se ugasio bez rezultata — pokreni ponovo")
        return 1
    return 0


# ------------------------------------------------------------------ stop ----
def zaustavi(izlaz):
    """Prekini render u pozadini — ubija i ffmpeg dete (process group)."""
    izlaz = os.path.abspath(izlaz)
    p = putanje(izlaz)
    if not os.path.exists(p["info"]):
        print("nema aktivnog rendera" + (f" (izlaz postoji: {izlaz})" if os.path.exists(izlaz) else ""))
        return 1
    info = json.load(open(p["info"]))
    pid = info.get("pid")
    ubijen = False
    if pid:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:                                     # prvo cela grupa (ffmpeg dete)
                os.killpg(os.getpgid(pid), sig)
            except OSError:
                try:
                    os.kill(pid, sig)
                except OSError:
                    break
            time.sleep(1.5)
            try:
                os.kill(pid, 0)                      # još živ?
            except OSError:
                ubijen = True
                break
    for k in ("part", "prog", "info"):
        try:
            os.remove(p[k])
        except OSError:
            pass
    print(f"{'render zaustavljen' if ubijen else 'render nije mogao da se zaustavi'}: {izlaz}")
    return 0 if ubijen else 1


# ----------------------------------------------------------------- render ----
def render(args):
    video = os.path.abspath(args["-i"])
    if not os.path.exists(video):
        die(f"nema videa {video}")
    izlaz = izlaz_za(args)
    if not izlaz.endswith(".mp4"):
        die("izlaz mora biti .mp4")
    if os.path.realpath(izlaz) == os.path.realpath(video):
        die("izlaz bi pregazio ulaz")
    p = putanje(izlaz)
    info = probe(video)
    trajanje = float(info["format"].get("duration", 0))
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    if not v:
        die("nema video zapisa")
    visina = int(v.get("height", 0))

    tmp = tempfile.mkdtemp(prefix="burn")
    # titl se kopira pod bezbednim imenom: nema problema sa [ ] ' : u putanji
    fc, vf, vmap = None, None, "0:v:0"
    if "-t" in args:
        n = int(args["-t"])
        subs = [s for s in info["streams"] if s["codec_type"] == "subtitle"]
        if n >= len(subs):
            die(f"nema titl-trake s:{n} (ima ih {len(subs)})")
        if subs[n]["codec_name"] in SLIKOVNI:
            fc = f"[0:v:0][0:s:{n}]overlay=eof_action=pass,format=yuv420p[v]"
            vmap = "[v]"
        else:
            t = os.path.join(tmp, "t.ass")
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-map",
                                f"0:s:{n}", t], capture_output=True, text=True)
            if r.returncode:
                die(f"izvlačenje titla: {r.stderr.strip()}")
            vf = f"ass={t},format=yuv420p"
    elif "-s" in args:
        src = os.path.abspath(args["-s"])
        if not os.path.exists(src):
            die(f"nema titla {src}")
        ext = os.path.splitext(src)[1].lower()
        t = os.path.join(tmp, "t" + ext)
        shutil.copy(src, t)
        vf = (f"ass={t}" if ext in (".ass", ".ssa") else f"subtitles={t}") + ",format=yuv420p"
    elif "--bez-titla" in args:
        vf = "format=yuv420p"
    else:
        die("treba -s <titl>, -t <N> ili --bez-titla")

    a, poruka_a = izaberi_audio(info, args.get("-l", "eng"))
    enk = args.get("-e", "auto")
    if enk == "auto":
        # merenje na stvarnom 1080p HEVC izvoru: mediacodec ~1.35x brži od
        # libx264 ultrafast (36.8 s vs 49.6 s za 60 s); sa titlom ~1.75x realtime
        enk = "mediacodec" if visina >= 1000 and ima_enkoder("h264_mediacodec") else "x264"

    def komanda(enkoder):
        c = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostats",
             "-progress", p["prog"], "-i", video]
        c += ["-filter_complex", fc] if fc else ["-vf", vf]
        c += ["-map", vmap]
        if a is not None:
            c += ["-map", f"0:{a['index']}"]
            c += ["-c:a", "copy"] if a["codec_name"] in KOPIJA_AUDIO else ["-c:a", "aac", "-b:a", "192k"]
            c += ["-disposition:a:0", "default"]
        if enkoder == "mediacodec":
            c += ["-c:v", "h264_mediacodec", "-b:v", "6M" if visina >= 1000 else "3M"]
        else:
            c += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23"]
        c += ["-pix_fmt", "yuv420p", "-sn", "-dn", "-map_chapters", "-1",
              "-movflags", "+faststart", p["part"]]
        return c

    def zapisi_info(enkoder):
        with open(p["info"], "w") as fh:
            json.dump({"pid": os.getpid(), "start": time.time(), "trajanje": trajanje,
                       "enkoder": enkoder, "izlaz": izlaz}, fh)

    zapisi_info(enk)
    log = open(p["log"], "w")
    log.write(f"video  : {video}\nizlaz  : {izlaz}\n{poruka_a}\nenkoder: {enk} ({visina}p)\n")
    log.flush()
    print(poruka_a)
    r = subprocess.run(komanda(enk), stdout=log, stderr=log)
    if r.returncode and enk == "mediacodec":
        log.write("\nmediacodec nije uspeo — ponavljam sa libx264\n")
        log.flush()
        zapisi_info("x264")
        r = subprocess.run(komanda("x264"), stdout=log, stderr=log)
    shutil.rmtree(tmp, ignore_errors=True)
    for k in ("prog", "info"):
        if os.path.exists(p[k]):
            os.remove(p[k])
    if r.returncode:
        log.write(f"\nNIJE PROŠLO: ffmpeg izlazni kod {r.returncode}\n")
        log.close()
        if os.path.exists(p["part"]):
            os.remove(p["part"])
        die(f"ffmpeg pao — vidi {p['log']}")

    # ---- provera
    o = probe(p["part"])
    tr = float(o["format"].get("duration", 0))
    ov = next(s for s in o["streams"] if s["codec_type"] == "video")
    greske = []
    if abs(tr - trajanje) > 1.5:
        greske.append(f"trajanje {tr:.1f}s ≠ ulaz {trajanje:.1f}s")
    if ov.get("pix_fmt") != "yuv420p":
        greske.append(f"pix_fmt {ov.get('pix_fmt')} (treba yuv420p)")
    if any(s["codec_type"] == "subtitle" for s in o["streams"]):
        greske.append("ostao soft titl")
    with open(p["part"], "rb") as fh:
        glava = fh.read(1 << 16)
    if b"moov" not in glava:
        greske.append("nema faststart")
    rez = (f"\n--- REZULTAT ---\nizlaz   : {izlaz}\ntrajanje: {tr:.1f}s (ulaz {trajanje:.1f}s)\n"
           f"video   : {ov['codec_name']} {ov.get('profile')} {ov.get('pix_fmt')}\n{poruka_a}\n")
    if greske:
        rez += "NIJE PROŠLO: " + "; ".join(greske) + f"\n(ostavljeno kao {p['part']})\n"
    else:
        os.replace(p["part"], izlaz)
        rez += "OK\n"
    log.write(rez)
    log.close()
    if not greske:                       # uspeh: folder epizode ostaje čist
        for k in ("log", "out"):
            if os.path.exists(p[k]):
                os.remove(p[k])
    print(rez)
    return 1 if greske else 0


def main():
    argv = sys.argv[1:]
    if not argv or "-h" in argv or "--help" in argv:
        print(__doc__)
        return 0
    if argv[0] in ("--status", "--stop"):
        if len(argv) < 2:
            die(f"{argv[0]} traži putanju izlaza")
        return status(argv[1]) if argv[0] == "--status" else zaustavi(argv[1])
    args, i = {}, 0
    while i < len(argv):
        if argv[i] in ("--pozadina", "--bez-titla"):
            args[argv[i]] = True
            i += 1
        elif i + 1 < len(argv):
            args[argv[i]] = argv[i + 1]
            i += 2
        else:
            die(f"opcija {argv[i]} traži vrednost")
    if "-i" not in args:
        die("treba -i <video>")
    if args.pop("--pozadina", False):
        args["-o"] = izlaz_za(args)
        cmd = [sys.executable, os.path.abspath(__file__)]
        for k, v in args.items():
            cmd += [k] if v is True else [k, v]
        pr = subprocess.Popen(cmd, stdout=open(putanje(args["-o"])["out"], "w"),
                              stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                              start_new_session=True)
        print(f"render pokrenut u pozadini (pid {pr.pid}) -> {args['-o']}\n"
              f"napredak: python3 {os.path.abspath(__file__)} --status \"{args['-o']}\"")
        return 0
    return render(args)


if __name__ == "__main__":
    sys.exit(main())
