#!/data/data/com.termux/files/usr/bin/bash
# mkv2mp4.sh — brz MKV -> MP4 (stream copy) za casting.
# Deo skilla: ~/.dsh/skills/mkv-to-mp4/SKILL.md
set -u

IN=""
OUTDIR=""
PREF="eng"
KEEP_ALL=0
STRIP_ONLY=0

usage() {
  cat <<'EOF'
Upotreba: mkv2mp4.sh -i <input.mkv> [-o <izlazni_folder>] [-l <jezik>] [-k]

  -i  ulazni MKV (obavezno)
  -o  izlazni folder (default: folder ulaznog fajla)
  -l  željeni audio jezik, npr. eng / jpn / srp (default: eng)
  -k  zadrži sve audio zapise (traženi jezik ide prvi i default)
  -h  pomoć

Radi: -c copy (bez re-enkodiranja), baca titlove (-sn), +faststart,
postavlja izabrani audio kao default, pa verifikuje trajanje i moov atom.
EOF
}

die() { echo "GREŠKA: $*" >&2; exit 1; }

while getopts ":i:o:l:kh" opt; do
  case "$opt" in
    i) IN="$OPTARG" ;;
    o) OUTDIR="$OPTARG" ;;
    l) PREF="$OPTARG" ;;
    k) KEEP_ALL=1 ;;
    h) usage; exit 0 ;;
    :) die "opcija -$OPTARG traži vrednost" ;;
    *) die "nepoznata opcija -$OPTARG (vidi -h)" ;;
  esac
done

[ -n "$IN" ] || { usage; exit 1; }
[ -f "$IN" ] || die "nema ulaznog fajla: $IN"
command -v ffmpeg >/dev/null || die "ffmpeg nije instaliran"
command -v ffprobe >/dev/null || die "ffprobe nije instaliran"

LOGFILE="${TMPDIR:-/data/data/com.termux/files/usr/tmp}/mkv2mp4.$$.log"
: > "$LOGFILE" 2>/dev/null || LOGFILE=/dev/null
trap 'rm -f "$LOGFILE"' EXIT

# --- 1. Popis audio streamova: "indeks|kodek|jezik|naslov" ---
# (polja se čitaju pojedinačno: csv ispušta prazne tagove pa se kolone pomere)
mapfile -t AUDIO < <(ffprobe -v error -select_streams a -show_entries \
  stream=index,codec_name:stream_tags=language,title -of json "$IN" | python3 -c '
import json, sys
for s in json.load(sys.stdin).get("streams", []):
    t = s.get("tags", {})
    print("|".join([str(s["index"]), s.get("codec_name", "?"),
                    (t.get("language") or "und").lower(), (t.get("title") or "").replace("|", " ")]))')
[ "${#AUDIO[@]}" -gt 0 ] || die "fajl nema audio zapis"

echo "Audio zapisi u ulazu:"
for a in "${AUDIO[@]}"; do
  IFS='|' read -r idx cod lng ttl <<<"$a"
  echo "  index=$idx  lang=$lng  codec=$cod  $ttl"
done | tee -a "$LOGFILE"

# varijante oznake jezika: eng = en = English (naslov trake), ger = deu = de …
case "$PREF" in
  eng|en)  ALIASES="eng en english" ;;
  ger|deu|de) ALIASES="ger deu de german deutsch" ;;
  jpn|ja)  ALIASES="jpn ja japanese" ;;
  *)       ALIASES="$PREF" ;;
esac
odgovara() {   # $1 = jezik, $2 = naslov
  local x w
  for x in $ALIASES; do
    [ "$1" = "$x" ] && return 0
    if [ "${#x}" -gt 3 ]; then
      for w in $(echo "$2" | tr 'A-Z()[]' 'a-z    '); do [ "$w" = "$x" ] && return 0; done
    fi
  done
  return 1
}

# --- 2. Izbor zapisa ---
SEL=""; SEL_COD=""
for a in "${AUDIO[@]}"; do
  IFS='|' read -r idx cod lng ttl <<<"$a"
  if odgovara "$lng" "$ttl"; then SEL="$idx"; SEL_COD="$cod"; break; fi
done
if [ -z "$SEL" ]; then
  IFS='|' read -r SEL SEL_COD lng ttl <<<"${AUDIO[0]}"
  echo "UPOZORENJE: nema audio jezika '$PREF' — koristim prvi: index=$SEL lang=$lng" | tee -a "$LOGFILE"
else
  echo "Izabran audio: index=$SEL (lang=$PREF, $SEL_COD)" | tee -a "$LOGFILE"
fi

# --- 2b. Kodeci: šta TV/caster pušta u MP4 ---
# audio: aac/mp3/ac3/eac3 se kopira; opus/flac/dts/truehd/vorbis -> AAC (samo zvuk, brzo)
case "$SEL_COD" in
  aac|mp3|ac3|eac3) ACODEC=(-c:a copy) ;;
  *) ACODEC=(-c:a aac -b:a 192k)
     echo "Audio $SEL_COD nije pouzdan u MP4 za TV — prebacujem u AAC (samo zvuk)" | tee -a "$LOGFILE" ;;
esac
VINFO=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt -of csv=p=0 "$IN")
VTAG=()
case "$VINFO" in
  hevc*) VTAG=(-tag:v hvc1)    # bez hvc1 Apple/mnogi TV ne prepoznaju HEVC u MP4
         echo "UPOZORENJE: video je HEVC ($VINFO) — Chromecast i stariji TV ga često ne puštaju." \
              "Ako ne radi: python3 ~/.dsh/skills/burn-subtitle/burn.py -i <mkv> --bez-titla --pozadina" | tee -a "$LOGFILE" ;;
  *10le*|*10be*) echo "UPOZORENJE: 10-bitni video ($VINFO) — mnogi TV/telefoni ga ne puštaju." | tee -a "$LOGFILE" ;;
esac

# --- 3. Izlazna putanja ---
[ -n "$OUTDIR" ] || OUTDIR="$(dirname "$IN")"
mkdir -p "$OUTDIR" || die "ne mogu da napravim folder: $OUTDIR"
BASE="$(basename "$IN")"
BASE="${BASE%.*}"
OUT="$OUTDIR/$BASE.mp4"
if [ "$(readlink -f "$IN")" = "$(readlink -f "$OUT")" ]; then die "izlaz bi pregazio ulaz"; fi

# --- 4. Mape ---
MAPS=(-map 0:v:0 -map "0:$SEL")
DISP=(-disposition:a:0 default)
if [ "$KEEP_ALL" -eq 1 ]; then
  n=1
  for a in "${AUDIO[@]}"; do
    idx="${a%%|*}"
    [ "$idx" = "$SEL" ] && continue
    MAPS+=(-map "0:$idx"); DISP+=(-disposition:a:$n 0); n=$((n+1))
  done
fi

# --- 5. Remux ---
echo "Remux: $IN -> $OUT" | tee -a "$LOGFILE"
START=$(date +%s)
ffmpeg -y -hide_banner -loglevel error \
  -i "$IN" \
  "${MAPS[@]}" \
  -c copy "${ACODEC[@]}" "${VTAG[@]}" -sn -dn \
  "${DISP[@]}" \
  -movflags +faststart \
  -map_metadata 0 -map_chapters 0 \
  "$OUT" >>"$LOGFILE" 2>&1 \
  || { echo "ffmpeg pao — detalji: $LOGFILE" >&2; exit 1; }
END=$(date +%s)

# --- 6. Verifikacija ---
DUR_IN=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
DUR_OUT=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
SUBS_OUT=$(ffprobe -v error -select_streams s -show_entries stream=index -of csv=p=0 "$OUT" | wc -l | tr -d ' ')
AUD_OUT=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$OUT" | wc -l | tr -d ' ')
SIZE=$(du -h "$OUT" | cut -f1)

FASTSTART="ne"
head -c 4096 "$OUT" | tr -d '\000' | grep -qa moov && FASTSTART="da"

printf '\n--- REZULTAT ---\n' | tee -a "$LOGFILE"
printf 'izlaz     : %s (%s)\n' "$OUT" "$SIZE" | tee -a "$LOGFILE"
printf 'vreme     : %ss\n' "$((END-START))" | tee -a "$LOGFILE"
printf 'trajanje  : ulaz %s / izlaz %s\n' "$DUR_IN" "$DUR_OUT" | tee -a "$LOGFILE"
printf 'audio     : %s stream(ova)\n' "$AUD_OUT" | tee -a "$LOGFILE"
printf 'titlovi   : %s (mora biti 0)\n' "$SUBS_OUT" | tee -a "$LOGFILE"
printf 'faststart : %s\n' "$FASTSTART" | tee -a "$LOGFILE"

FAIL=0
awk -v a="$DUR_IN" -v b="$DUR_OUT" 'BEGIN{ d=a-b; if (d<0) d=-d; exit (d>1.5) }' || {
  echo "GREŠKA: trajanje se razlikuje više od 1.5 s" >&2; FAIL=1; }
[ "$FASTSTART" = "da" ] || { echo "GREŠKA: nema faststart (moov nije na početku)" >&2; FAIL=1; }
[ "$SUBS_OUT" = "0" ] || { echo "GREŠKA: u izlazu su ostali titlovi" >&2; FAIL=1; }
[ "$FAIL" -eq 0 ] && echo "OK" | tee -a "$LOGFILE" || exit 1
