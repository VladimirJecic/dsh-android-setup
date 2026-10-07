---
name: burn-subtitle
description: Spaja (burn-in) SRT/ASS titl u MP4 video pomoću ffmpeg-a i pravi novu epizodu sa trajno upečenim prevodom. Koristi se kada korisnik traži "spoji titl", "burn subtitle", "ubaci prevod u video", "napravi sub-burnt epizodu" ili slično.
---

# `burn-subtitle` Skill

Trajno upeče (burn-in) titl iz `.srt` / `.ass` fajla u video i sačuva novi MP4.
Koristi se za pravljenje `NN-sub-burnt.mp4` epizoda.

## Kako se zove izlaz

Podrazumevano: `<broj_epizode>-sub-burnt.mp4` u istom folderu kao izvorni video.
Ako epizoda već ima `NN-sub-burnt.mp4`, koristi drugo ime da ne pregaziš
original (npr. `NN-sub-burnt-vocab.mp4`).

## KRITIČNO: ffmpeg uvek u pozadini

Pun render epizode (23 min, 852x480) traje **nekoliko minuta** na telefonu i
**prekoračuje timeout alata**. Ako ga pokreneš sinhrono, alat ga ubije na 60 s i
ostane **skraćen, neupotrebljiv fajl** (npr. samo 2 min i 45 s umesto 23 min).

Zato se ffmpeg **obavezno** pokreće sa `run_in_background: true`, a posle
proveri `job_output` i trajanje izlaza pre nego što tvrdiš da je gotovo.

## Komanda

Čist titl (SRT sa `{\an8}` tagovima ili običan SRT):

```bash
ffmpeg -y -i "input.mp4" \
  -vf "subtitles=putanja/do/titl.srt" \
  -c:a copy -c:v libx264 -preset ultrafast -crf 23 \
  "izlaz-sub-burnt.mp4"
```

Stilizovan titl (ASS sa dva stila — preporučeno, daje tačnu poziciju):

```bash
ffmpeg -y -i "input.mp4" \
  -vf "ass=putanja/do/titl.ass" \
  -c:a copy -c:v libx264 -preset ultrafast -crf 23 \
  "izlaz-sub-burnt.mp4"
```

Napomene:

- Putanja u filteru: ako sadrži razmake ili dvotačku, escapeduj je
  (`subtitles=filename='...'`) ili prvo `cd` u folder pa koristi relativnu putanju.
- `-c:a copy` čuva originalni zvuk bez re-enkodiranja.
- `-preset ultrafast` je najbrži; `-crf 23` drži kvalitet blizu izvornog.
- Za ASS fajl koristi `ass=` filter, ne `subtitles=`.

## Provera posle renderа (obavezno)

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 "izlaz-sub-burnt.mp4"
```

Trajanje izlaza mora biti **isto kao trajanje ulaza** (do ~1 s razlike). Ako je
izlaz znatno kraći, render je prekinut — pokreni ponovo u pozadini.

Vizuelna provera pozicije titla (izvuci kadar i pogledaj ga `read_image` alatom):

```bash
ffmpeg -y -ss 00:04:22 -i "izlaz-sub-burnt.mp4" -frames:v 1 -q:v 2 "provera.jpg"
```

Ako ovo pukne sa `ff_frame_thread_encoder_init failed` / `Non full-range YUV is
non-standard` i ffmpeg visi, mjpeg enkoder je problem — koristi PNG, jednu nit i
`-f image2`:

```bash
ffmpeg -y -v error -i "izlaz-sub-burnt.mp4" -ss 00:04:22 \
  -frames:v 1 -threads 1 -f image2 "provera.png"
```

## Greške koje treba izbeći

- **Sinhrono pokretanje** → skraćen fajl. Uvek pozadina.
- **Pogrešan filter** (`subtitles=` na `.ass`) → izgubljeni stilovi i pozicija.
- **Nedostaje `-y`** → ffmpeg čeka potvrdu i visi.
- **Prepisivanje originala** → nikad ne upisuj u isti fajl kao ulaz.
