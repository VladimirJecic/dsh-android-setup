---
name: mkv-to-mp4
description: Brzo prebacivanje MKV u MP4 (stream copy) za Web Video Caster / DLNA / TV — bez titlova, uvek sa ENGLESKIM audiom kao jedinim/default (ako postoji). Koristi se kada korisnik traži "mkv u mp4", "cast na tv", "prebaci u mp4", "engleski audio default", "prebaci epizodu za caster" ili slično.
---

# `mkv-to-mp4` Skill

MKV → MP4 u **nekoliko sekundi** (stream copy), pripremljen za casting
(Web Video Caster, DLNA, Chromecast). Bez titlova, sa jasno izabranim audio
jezikom. Ako trebaju titlovi → skill [`burn-subtitle`](../burn-subtitle/SKILL.md).

**Audio je uvek engleski** (`eng`, `en` ili „English” u naslovu trake), osim
ako korisnik izričito traži drugi jezik (`-l`). Ako engleskog nema, skripta
uzme prvi audio i to javi — tada to reci korisniku.

## Tri pravila koja rešavaju 95% problema

1. **Nikad ne mapiraj subtitle u MP4.**
   MP4 ne podržava SubRip. Rezultat je:
   `Could not find tag for codec subrip in stream #2, codec not currently supported in container`
   i ffmpeg **ne napiše ništa** (exit 234). Jedini izlaz je `mov_text`, koji TV
   rendereri i Web Video Caster uglavnom ignorišu — dakle beskorisno.
   → Titlovi se **izbacuju** (`-sn`), a ako trebaju da se vide: burn-in.

2. **Audio mora biti jedan i default.**
   Web Video Caster ne nudi biranje audio zapisa. Ako MKV ima dual audio
   (npr. `jpn` + `eng`) i `jpn` je prvi/default, dobijaš japanski. Zato se
   traženi jezik stavlja kao `-map` i `-disposition default`, a ostali izbacuju.

3. **Video `-c copy` + `-movflags +faststart`.**
   Copy = sekunde, bez gubitka kvaliteta (video ~5 Mbps, 25 min ≈ 940 MB).
   `+faststart` premešta `moov` na početak — bez toga caster/TV mora da skače na
   kraj fajla (~1 GB) po indeks, što se na TV-u oseti kao stucanje zvuka.

## Komanda

```bash
ffmpeg -y -hide_banner -loglevel error \
  -i "epizoda.mkv" \
  -map 0:v:0 -map 0:2 \
  -c copy -sn -dn \
  -disposition:a:0 default \
  -movflags +faststart \
  -map_metadata 0 -map_chapters 0 \
  "epizoda.mp4"
```

`-map 0:2` je **indeks audio streama** iz `ffprobe` (0:v je video, 0:1 prvi
audio, 0:2 drugi audio...). Uvek prvo pogledaj mapu:

```bash
ffprobe -v error -select_streams a \
  -show_entries stream=index,codec_name:stream_tags=language \
  -of csv=p=0 "epizoda.mkv"
# 1,jpn
# 2,eng   ← ovo je željeni engleski
```

ILI koristi skriptu ispod — sama nađe jezik i sve odradi + verifikuje.

## Skripta

`mkv2mp4.sh` (u istom folderu kao ovaj SKILL.md):

```bash
bash mkv2mp4.sh -i "epizoda.mkv"                 # traži eng audio, izlaz pored ulaza
bash mkv2mp4.sh -i "epizoda.mkv" -o jojo-mp4     # u podfolder
bash mkv2mp4.sh -i "epizoda.mkv" -l jpn          # drugi jezik
bash mkv2mp4.sh -i "epizoda.mkv" -k              # zadrži SVE audio zapise (eng prvi)
```

Skripta:
- bira engleski (prepoznaje `eng`, `en` i „English” u naslovu), javlja ako ga
  nema i pada nazad na prvi audio uz upozorenje;
- video kopira; audio kopira ako je aac/mp3/ac3/eac3, a opus/flac/dts/truehd
  prebaci u AAC (samo zvuk, sekunde) — u MP4 ih TV/caster često ne pušta;
- HEVC dobija `-tag:v hvc1` i upozorenje (Chromecast/stariji TV često ne puštaju
  HEVC ni 10-bitni video);
- sa `-k` ostali audio zapisi ostaju, ali samo izabrani je default;
- baca titlove, `+faststart`, pa verifikuje trajanje, titlove i `moov`.

**Uvek koristi skriptu**, ne ručnu komandu — ručna komanda iznad je samo
objašnjenje i ne radi zamene kodeka.

## Verifikacija (obavezno posle svakog posla)

```bash
ffprobe -v error -show_entries format=duration \
  -show_entries stream=index,codec_name,codec_type \
  -of compact "epizoda.mp4"
```

- Trajanje izlaza = trajanje ulaza (±1 s).
- Tačno 1 video + 1 audio (ili više ako je `-k`).
- Nema `subtitle` streama.
- `moov` pre `mdat`:
  `head -c 200 "epizoda.mp4" | xxd | head -3` → posle `ftyp` ide `moov`.

## Ako trebaju titlovi ili TV ne pušta video

Ne pravi prvo MP4 pa onda upecanje — `burn-subtitle` čita MKV direktno (jedan
re-encode, engleski audio, 8-bit izlaz):

```bash
B=~/.dsh/skills/burn-subtitle/burn.py
python3 $B -i "epizoda.mkv" -s "titl.ass" --pozadina     # titl iz fajla
python3 $B -i "epizoda.mkv" -t 0 --pozadina              # ugrađeni titl (traka s:0)
python3 $B -i "epizoda.mkv" --bez-titla --pozadina       # HEVC/10-bit -> H.264 za TV
python3 $B --status "<izlaz>.mp4"
```

Re-encode traje minutima (zavisi od rezolucije); remux iz ovog skilla sekundama.

## Greške koje treba izbeći

- **Subtitle u `-map`** → ffmpeg padne i ne napiše fajl.
- **Dual audio bez `-map`** → caster pušta japanski (prvi/default), bez načina
  da se prebaci.
- **Bez `+faststart`** → stucanje/kašnjenje pri castovanju velikog fajla.
- **Re-encode umesto copy** kad nije potreban → 20× sporije i gubi kvalitet.
- **`-c:a copy` na HE-AAC uz TV koji ne podržava** → TV transkoduje u letu i
  zvuk stuca; tada `-c:a aac -b:a 192k` (samo audio, brzo).
- **Opus/FLAC kopiran u MP4** → fajl „radi” na telefonu, ali TV ćuti. Skripta
  ih sama prebacuje u AAC.
