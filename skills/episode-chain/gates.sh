#!/data/data/com.termux/files/usr/bin/bash
# gates.sh — nezavisne kapije za JEDNU epizodu niza (Black Clover, SOFT).
#
# Ne veruje agentu: proverava fajlove. Ako sve prođe, briše originalni MKV
# (protokol: original ide tek posle konačnog soft imena i provera).
#
# Upotreba:
#   gates.sh <brojEpizode> [--season DIR] [--ne-brisi]
#
# Exit: 0 = sve prošlo (i original obrisan), 1 = kapija pala, 2 = loši argumenti.
set -uo pipefail

EP=""; SEASON="$(pwd)"; BRISI=1
while [ $# -gt 0 ]; do
  case "$1" in
    --season) SEASON="${2:?--season trazi dir}"; shift 2 ;;
    --ne-brisi) BRISI=0; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) echo "gates.sh: nepoznata opcija: $1" >&2; exit 2 ;;
    *) EP="$1"; shift ;;
  esac
done
[ -n "$EP" ] || { echo "gates.sh: daj broj epizode" >&2; exit 2; }
case "$EP" in ''|*[!0-9]*) echo "gates.sh: '$EP' nije broj" >&2; exit 2 ;; esac
NN=$(printf '%02d' "$EP")
cd "$SEASON" || { echo "gates.sh: nema foldera $SEASON" >&2; exit 2; }
SEASON="$(pwd)"

EPDIR="$SEASON/ep$NN"
SOFT="$SEASON/$NN-soft-vocab.mkv"
MKV="$SEASON/[Judas] Black Clover - S01E$NN ($((10#$NN))).mkv"
# tačno ime izvora: S01E16 (016).mkv
MKV="$SEASON/$(printf '[Judas] Black Clover - S01E%s (%s).mkv' "$NN" "$NN")"

fails=0
ok()   { printf '  OK   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }
skip() { printf '  skip %s\n' "$1"; }

echo "== kapije za E$EP ($SOFT)"

# ---- 1) .done.json (meko: E15 i starije ga nemaju)
if [ -f "$EPDIR/.done.json" ]; then
  if python3 - "$EPDIR/.done.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
sys.exit(0 if d.get("ok") is not False else 1)
PY
  then ok ".done.json kaze ok"; else bad ".done.json kaze ok:false"; fi
else
  skip ".done.json (nema — izvodim stanje iz fajlova)"
fi

# ---- 2) titlovi postoje i nisu prazni
for f in "$EPDIR/partial-prevod.ass" "$EPDIR/partial-prevod.srt"; do
  if [ -f "$f" ] && [ "$(stat -c%s "$f")" -gt 20000 ]; then ok "$(basename "$f") ($(stat -c%s "$f") B)"
  else bad "$(basename "$f") nedostaje ili je premali"; fi
done

# ---- 3+4) sadrzaj SRT-a: blokovi sa an8, parovi, duplikati
if [ -f "$EPDIR/partial-prevod.srt" ]; then
  if python3 - "$EPDIR/partial-prevod.srt" <<'PY'
import sys,collections
p=sys.argv[1]
txt=open(p,encoding="utf-8").read()
blocks=[b for b in txt.strip().split("\n\n") if "{\\an8}" in b]
if len(blocks)<200:
    print("     blokova sa an8: %d (<200)"%len(blocks)); sys.exit(1)
pairs=collections.defaultdict(set)
bad_pair=0
for b in blocks:
    # Prvi red posle {\an8} nosi stavke; ASS koristi \N za prelom u NOVI red,
    # pa se i on tretira kao granica stavke (inače nastavak uđe u prethodni par).
    head=b.split("{\\an8}",1)[1].split("\n")[0]
    for row in head.split("\\N"):
        for d in row.split(", "):
            d=d.strip()
            if " = " not in d: continue
            de,_,sr=d.partition(" = ")
            de,sr=de.strip(),sr.strip()
            if not de or not sr or sr.startswith("=") or len(sr)<2: bad_pair+=1; continue
            pairs[de].add(sr)
if bad_pair:
    print("     losih parova: %d"%bad_pair); sys.exit(1)
conflict={}
for k,vs in pairs.items():
    if len(vs)<2: continue
    # Isti prevod sa primerom u zagradi i bez njega NIJE konflikt:
    #   "padati / kleknuti (sie sind gefallen = pali su)" vs "padati / kleknuti"
    # Poredi se osnova prevoda; razlikuje se samo ono sto nije isti prevod.
    bases={re.sub(r"\s*\([^)]*\)\s*$","",v).strip() for v in vs}
    if len(bases)>1: conflict[k]=vs
if conflict:
    k=list(conflict)[0]
    print("     isti kljuc sa razlicitim prevodom: %s -> %s"%(k,list(conflict[k])[:3])); sys.exit(1)
print("     blokova=%d parova=%d"%(len(blocks),len(pairs)))
PY
  then ok "SRT sadrzaj (blokovi + parovi + bez konflikta)"; else bad "SRT sadrzaj"; fi
else skip "SRT sadrzaj (nema srt)"
fi

# ---- 5) soft izlaz sa KONACNIM imenom
if [ -f "$SOFT" ]; then ok "$(basename "$SOFT") ($(stat -c%s "$SOFT") B)"; else bad "nema $(basename "$SOFT")"; fi

# ---- 6) nema zaostalih privremenih fajlova
left=0
for f in "$SOFT.part.mkv" "$SOFT.progress" "$SOFT.burn.json"; do
  [ -e "$f" ] && { bad "zaostalo $(basename "$f")"; left=1; }
done
[ "$left" = 0 ] && ok "nema .part/.progress/.burn.json"

# ---- 7-10) ffprobe provere na soft izlazu
if [ -f "$SOFT" ]; then
  if python3 - "$SOFT" "$EPDIR/partial-prevod.ass" <<'PY'
import subprocess,sys,json
soft,ass=sys.argv[1],sys.argv[2]
def probe(p,sel=None):
    c=["ffprobe","-v","error","-print_format","json","-show_format","-show_streams",p]
    return json.loads(subprocess.run(c,capture_output=True,text=True).stdout)
o=probe(soft)
prod=[]
# 7) trajanje
try: tr=float(o["format"]["duration"])
except Exception: tr=0.0
if tr<=0: prod.append("trajanje nepoznato")
# 8) video traka
v=[s for s in o["streams"] if s["codec_type"]=="video"]
if not v: prod.append("nema video trake")
else:
    v=v[0]
    if v.get("codec_name")!="hevc": prod.append("video %s (ocekivano hevc)"%v.get("codec_name"))
    if v.get("pix_fmt")!="yuv420p10le": prod.append("pix_fmt %s"%v.get("pix_fmt"))
    if int(v.get("width",0))!=1920: prod.append("sirina %s"%v.get("width"))
# 9) ASS traka
s=[x for x in o["streams"] if x["codec_type"]=="subtitle"]
if not s: prod.append("nema titl-trake")
elif s[0].get("codec_name")!="ass": prod.append("titl %s (ocekivano ass)"%s[0].get("codec_name"))
# 10) audio eng i default
a=[x for x in o["streams"] if x["codec_type"]=="audio"]
if not a: prod.append("nema audio trake")
else:
    lang=(a[0].get("tags",{}) or {}).get("language","")
    disp=(a[0].get("disposition",{}) or {}).get("default",0)
    if lang not in ("eng","en"): prod.append("audio jezika '%s' (ocekivano eng)"%lang)
    if int(disp)!=1: prod.append("audio nije default")
# 9b) ASS: broj Dialogue i stilovi kao u ulazu
def ass_info(p,stream=None):
    c=["ffmpeg","-v","error","-i",p]
    c+= ["-map","0:s:0"] if stream is None else []
    c+=["-f","ass","-"]
    out=subprocess.run(c,capture_output=True,text=True).stdout
    n=sum(1 for l in out.splitlines() if l.startswith("Dialogue:"))
    st={}
    for l in out.splitlines():
        if l.startswith("Style:"):
            f=l.split(",")
            st[f[0].replace("Style:","").strip()]=f[18].strip() if len(f)>18 else "?"
    return n,st
try:
    n_in,st_in=ass_info(ass)
    n_out,st_out=ass_info(soft)
    if n_in and n_out!=n_in: prod.append("Dialogue %d != ulaz %d"%(n_out,n_in))
    for k,val in st_in.items():
        if k in st_out and st_out[k]!=val: prod.append("alignment %s: %s != %s"%(k,st_out[k],val))
    if st_in.get("Vocab")!="8": pass
except Exception as e:
    prod.append("provera titla pala: %s"%e)
print("     trajanje=%.1fs, stilovi=%s, dialogue=%d"%(tr,st_out if 'st_out' in dir() else {},n_out if 'n_out' in dir() else 0))
if prod:
    print("     "+"; ".join(prod)); sys.exit(1)
PY
  then ok "ffprobe: hevc/1080p10bit + ass + eng default"; else bad "ffprobe provere"; fi
else skip "ffprobe (nema soft fajla)"
fi

# ---- 11) kritika je radjena
if [ -f "$EPDIR/.done.json" ]; then
  if python3 - "$EPDIR/.done.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1],encoding="utf-8"))
c=d.get("criticism") or {}
sys.exit(0 if c.get("ran") is True and isinstance(c.get("applied"),int) else 1)
PY
  then ok "kritika radjena i primenjena"; else bad "kritika nije zabelezena"; fi
else skip "kritika (.done.json nema)"
fi

echo "== rezultat: $fails greska/e"
if [ "$fails" -gt 0 ]; then
  echo "PROTOKOL: original NIJE obrisan."
  exit 1
fi

# ---- Protokol: obrisi original TEK sada
if [ "$BRISI" = 1 ]; then
  if [ -f "$MKV" ]; then
    case "$MKV" in
      "$SEASON/[Judas] Black Clover - S01E"*" ("*").mkv") rm -f -- "$MKV" && echo "  BRISAN original: $(basename "$MKV")" ;;
      *) echo "  FAIL safety: neocekivano ime $MKV — ne brisem" >&2; exit 1 ;;
    esac
  else
    echo "  original vec obrisan (ili ga nema): $(basename "$MKV")"
  fi
else
  echo "  --ne-brisi: original ostavljen"
fi
exit 0
