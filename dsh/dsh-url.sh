#!/data/data/com.termux/files/usr/bin/bash
# dsh-url.sh — restartuj dsh i ispisi tokenizovani URL (za PWA / "DSH 手机版").
#
# ZASTO RESTART: launch-token je randomBytes() po PROCESU i drzi se samo u
# memoriji (dsh-client-connection: PROCESS_LAUNCH_TOKENS). Ne postoji fajl iz
# kog se moze procitati, pa je URL iz prethodnog pokretanja mrtav. Jedini nacin
# da se dobije svez token je novi proces.
#
# Cookie koji se dobije otvaranjem tog URL-a potpisuje TRAJNI secret iz
# ~/.dsh/.credentials.yaml (record `client-connection/browser-session`) i vazi
# 30 dana — prezivljava restarte. Zato se ovo radi retko: samo kad se $DSH_HOME
# recreate-uje (nova instalacija / brisanje ~/.dsh), jer tada secret bude nov.

set -uo pipefail

LOG="$HOME/dsh/dsh-web.log"
PORT=3081
PATTERN='dsh/lib/bin[.]js'

echo "dsh-url: gasim postojecu instancu ..." >&2
pkill -f "$PATTERN" 2>/dev/null
for _ in $(seq 1 30); do
  pgrep -f "$PATTERN" >/dev/null 2>&1 || break
  sleep 1
done
sleep 1

: > "$LOG"
nohup "$HOME/.local/bin/dsh-termux" >> "$LOG" 2>&1 &
echo "dsh-url: dizem dsh, cekam URL (max 45s) ..." >&2

url=""
for _ in $(seq 1 45); do
  sleep 1
  url=$(grep -o "http://127\.0\.0\.1:$PORT/?token=[A-Za-z0-9_-]*" "$LOG" | head -1)
  [ -n "$url" ] && break
done

if [ -z "$url" ]; then
  echo "dsh-url: URL nije nadjen. Poslednje linije $LOG:" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

echo
echo "$url"
echo
echo "Otvori ovaj URL u Chrome-u; ako i aplikacija ('DSH 手机版') treba da radi," >&2
echo "otvori ga tako da zavrsi U APLIKACIJI (share/long-press -> Open in app)," >&2
echo "ili force-stopuj aplikaciju pa je otvori posle ovoga." >&2

# Posalji isti URL i u aplikaciju (WebAPK) preko Android intents. Potrebno je jer
# WebAPK pri pokretanju iz lansera ne dobija session cookie — ovako ga dobije iz
# same aplikacije. Zahteva "Display over other apps" za com.termux (proveri sa:
# `am start --check-draw-over-apps-permission -a com.termux.probe.NOOP`).
if command -v am >/dev/null 2>&1; then
  if am start -a android.intent.action.VIEW -d "$url" >/dev/null 2>&1; then
    echo "dsh-url: URL poslat i u aplikaciju (am start)." >&2
  else
    echo "dsh-url: am start nije uspeo — otvori URL rucno U APLIKACIJI." >&2
  fi
fi
