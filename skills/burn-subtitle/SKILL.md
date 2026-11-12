---
name: burn-subtitle
description: Trajno upeče (burn-in) titl u video i pravi MP4 koji puštaju telefon, TV i Chromecast — iz MP4 ili MKV, iz .ass/.srt fajla ili iz titla ugrađenog u MKV (tekst ili PGS). Audio je uvek engleski ako postoji. Koristi se kad korisnik traži "spoji titl", "burn subtitle", "upeci titl", "ubaci prevod u video", "napravi sub-burnt epizodu", kad drugi skill (partial-prevod) treba render, ili kad TV ne pušta HEVC/10-bit video.
---

# burn-subtitle

Sav render ide kroz **jednu skriptu**: `~/.dsh/skills/burn-subtitle/burn.py`.
Ne piši ffmpeg komandu ručno — skripta već rešava sve zamke ispod.

```bash
B=~/.dsh/skills/burn-subtitle/burn.py

python3 $B -i "epizoda.mkv" -s "titl.ass" -o "11-sub-burnt.mp4" --pozadina
python3 $B --status "11-sub-burnt.mp4"        # ponavljaj dok ne piše GOTOVO
```

| želim | komanda |
| --- | --- |
| titl iz fajla (.ass ili .srt) | `-i video -s titl.ass` |
| titl ugrađen u MKV | `-i video.mkv -t 0` (N-ta titl-traka; vidi `--lista` u `partial-prevod/izvuci_titl.py` ili `ffprobe`) |
| samo MP4 koji TV pušta, bez titla | `-i video.mkv --bez-titla` |
| drugi audio jezik | `-l ger` / `-l jpn` (podrazumevano `eng`) |
| izbor enkodera | `-e x264` / `-e mediacodec` (podrazumevano `auto`) |

Podrazumevani izlaz: `<ime videa>-sub-burnt.mp4` (sa `--bez-titla`: `-tv.mp4`)
pored videa. Ako `NN-sub-burnt.mp4` već postoji, daj drugo ime (`-o`), da ne
pregaziš staru epizodu.

## Uvek `--pozadina`

Render epizode traje minutima, a alat ubija sinhronu komandu na 60 s (ostane
odsečen fajl od 2–3 min). Sa `--pozadina` skripta se odmah vrati, a render
radi dalje. Napredak:

```
RADI   41.3%  brzina 1.9x  proteklo 4.2 min  preostalo ~6.0 min  enkoder x264
GOTOVO: /…/11-sub-burnt.mp4  (23.7 min)
```

Proveravaj `--status` na 60 s, ne u petlji svake sekunde — svaki poll vraća
liniju u kontekst. Dok radi, postoji samo `<izlaz>.part.mp4` — konačni fajl se
pojavi tek kad provera prođe, pa nedovršen render nikad ne izgleda kao gotov.

### Prekid rendera: `--stop`

```bash
python3 $B --stop "11-sub-burnt.mp4"
```

Ubija **celu process grupu** (i `ffmpeg` dete, koje bi inače nastavilo da piše u
`.part.mp4`), briše `.part.mp4`/`.progress`/`.burn.json` i ostavlja `.log` za
dijagnostiku. Ne koristi `kill <pid>` iz `.burn.json` — u epizodi 1 je tako
ubijen samo roditelj, a zaostali `ffmpeg` je nastavio render.

## Šta skripta radi (i zašto)

- **Engleski audio** (`eng`, `en` ili „English” u naslovu trake), jedan i
  default. Bez toga ffmpeg uzme traku sa najviše kanala — kod anime MKV-a to
  je japanski 5.1. Ako engleskog nema: prvi audio + UPOZORENJE.
- **Audio kodek**: aac/mp3/ac3/eac3 se kopira; opus/flac/dts/truehd → AAC 192k.
  Opus i FLAC u MP4 TV/caster uglavnom ne pušta.
- **8-bit H.264** (`yuv420p`). Anime MKV je često 10-bitni; bez ovoga izlaz je
  „H.264 High 10”, koji većina telefona, TV-a i Chromecast ne dekodira.
- **`+faststart`** — indeks na početku; bez toga casting stuca.
- **Bez soft titlova** (`-sn`) — MP4 ih ionako ne nosi upotrebljivo.
- **Pravi filter**: `ass=` za .ass/.ssa (čuva stilove i poziciju),
  `subtitles=` za .srt, `overlay` za PGS/VobSub iz MKV-a.
- Titl se pre rendera kopira pod bezbednim imenom, pa `[Judas] … (it's).ass`
  i slične putanje ne lome filter.
- **Enkoder `auto`**: ≥1080p → `h264_mediacodec`, a ako ne uspe — automatski
  ponovi sa `libx264`. Ispod 1080p → `libx264 -preset ultrafast -crf 23`.
  Merenje na stvarnom 1080p HEVC izvoru (60 s isečak, bez titla): `libx264`
  49,6 s vs `mediacodec` 36,8 s → **~1,35×**, a sa upečenim titlom ceo render
  ide ~1,75× realtime jer je `-vf ass` + dekodiranje usko grlo, ne enkoder.
  Zato spuštanje preseta ne pomaže; jedino pomaže niža rezolucija.
- **Provera na kraju**: trajanje = ulaz (±1.5 s), yuv420p, nema soft titla,
  faststart. Ako ne prođe, ostaje `.part.mp4` i log `<izlaz>.log`.

## Provera kadra — samo kad treba

Samo ako menjaš stilove/poziciju titla ili korisnik prijavi problem. Na
**gotovom** MP4 titl je deo slike, pa je brzo traženje (`-ss` pre `-i`) ispravno:

```bash
ffmpeg -y -v error -ss 00:04:22 -i "11-sub-burnt.mp4" -frames:v 1 -threads 1 -f image2 provera.png
```

(`-ss` posle `-i` treba samo kad se titl primenjuje filterom u istoj komandi —
tada `-ss` pre `-i` pomera vremensku osu titla.) PNG + jedna nit izbegava
mjpeg grešku `ff_frame_thread_encoder_init failed` na ovom telefonu.

## Napomene

- Slikovni titl (PGS/VobSub) iz MKV-a ide kroz `overlay`; ta grana nije
  isprobana na pravom PGS fajlu — ako izlaz ne izgleda dobro, javi korisniku.
- `mediacodec` grana je pisana prema merenju sa telefona, ali nije isprobana
  van njega; ako `--status` pokaže sporiji rad od `libx264`, koristi `-e x264`.
- Samo remux MKV → MP4 bez titla (sekunde, bez gubitka) je skill `mkv-to-mp4`.
