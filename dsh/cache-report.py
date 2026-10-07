#!/usr/bin/env python3
"""cache-report.py — koliko je prompt-keša stvarno iskorišćeno, iz session loga.

dsh čuva sesiju kao zstd-komprimovan JSONL: `~/.dsh/sessions/<workspace>/<session>/session.v4.jsonl.zstd`.
Svaki asistentski korak ima `data.usage` sa:
  inputTokens        — NEKEŠIRANI (novi) deo prompta — plaća se skuplje
  cacheReadTokens    — deo pročitan iz keša — plaća se ~10x jeftinije
  cacheWriteTokens   — deo koji je upisan u keš
  outputTokens       — generisano

Upotreba:
  python3 ~/dsh/cache-report.py                 # tekuća sesija (iz $DSH_SESSION_ID)
  python3 ~/dsh/cache-report.py --last 12       # zadnjih N koraka (default 10)
  python3 ~/dsh/cache-report.py --session <id>  # konkretna sesija
  python3 ~/dsh/cache-report.py --all-sessions  # sumarno po sesijama (danas)

Cena se ne izmišlja: dashboard (platform.deepseek.com) je izvor istine. Ovde se
vidi STRUKTURA — koliko procenata prompta ide iz keša i koliki je vremenski razmak
između koraka (keš se posle dovoljno duge pauze evakuiše, pa se sve plaća skuplje).
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import time

SESS_ROOT = os.path.expanduser("~/.dsh/sessions")


def decompress(path):
    """Vrati JSONL linije iz .zstd (ili plain .jsonl) fajla."""
    if path.endswith(".zstd"):
        try:
            out = subprocess.run(
                ["zstd", "-dc", path], capture_output=True, check=False
            ).stdout
        except FileNotFoundError:
            sys.exit("nema `zstd` — pkg install zstd")
        text = out.decode("utf-8", "replace")
    else:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    return text.splitlines()


def find_session_file(session_id):
    hits = glob.glob(os.path.join(SESS_ROOT, "*", session_id, "session.v*.jsonl.zstd"))
    hits += glob.glob(os.path.join(SESS_ROOT, "*", session_id, "session.v*.jsonl"))
    if not hits:
        sys.exit(f"nema session log za {session_id}")
    return sorted(hits)[-1]


def records(path):
    """(ts_ms, usage) za svaki korak koji ima usage."""
    for line in decompress(path):
        line = line.strip()
        if not line or '"usage"' not in line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        u = (d.get("data") or {}).get("usage")
        if not isinstance(u, dict):
            continue
        ts = d.get("at") or d.get("ts") or d.get("time") or d.get("createdAt")
        if isinstance(ts, str):
            try:
                ts = int(float(ts))
            except ValueError:
                ts = None
        yield ts, u


def fmt(n):
    return f"{n:,}".replace(",", ".")


def pct(part, whole):
    return f"{(100.0 * part / whole):5.1f}%" if whole else "   n/a"


# Zvanične cene za deepseek-flash (api-docs.deepseek.com/quick_start/pricing, 2026-09-29):
#   input CACHE HIT  off-peak $0.003 / peak $0.006  (po 1M)
#   input CACHE MISS off-peak $0.15  / peak $0.30
#   output           off-peak $0.60  / peak $1.20
# Peak = 01:00-04:00 i 06:00-10:00 UTC, pon-pet (bez kineskih praznika); ostalo off-peak.
FLASH = {"hit": (0.003, 0.006), "miss": (0.15, 0.30), "out": (0.60, 1.20)}


def estimated_cost(hit_tokens, miss_tokens, out_tokens, peak=False):
    i = 1 if peak else 0
    return (
        hit_tokens / 1e6 * FLASH["hit"][i]
        + miss_tokens / 1e6 * FLASH["miss"][i]
        + out_tokens / 1e6 * FLASH["out"][i]
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", default=os.environ.get("DSH_SESSION_ID"))
    ap.add_argument("--last", type=int, default=10)
    ap.add_argument("--all-sessions", action="store_true")
    ap.add_argument("--cost", action="store_true", help="procena troska po zvanicnim flash cenama")
    ap.add_argument("--peak", action="store_true", help="racunaj po peak cenama (2x)")
    a = ap.parse_args()

    files = (
        sorted(glob.glob(os.path.join(SESS_ROOT, "*", "*", "session.v*.jsonl.zstd")))
        if a.all_sessions
        else [find_session_file(a.session)]
    )

    grand = {"in": 0, "cache": 0, "write": 0, "out": 0, "steps": 0}
    for path in files:
        rows = list(records(path))
        if not rows:
            continue
        sid = os.path.basename(os.path.dirname(path))
        # inputTokens = nekeširani deo; cacheReadTokens = keširani deo.
        tot_in = sum(u.get("inputTokens", 0) for _, u in rows)
        tot_cache = sum(u.get("cacheReadTokens", 0) for _, u in rows)
        tot_write = sum(u.get("cacheWriteTokens", 0) for _, u in rows)
        tot_out = sum(u.get("outputTokens", 0) for _, u in rows)
        grand["in"] += tot_in
        grand["cache"] += tot_cache
        grand["write"] += tot_write
        grand["out"] += tot_out
        grand["steps"] += len(rows)

        print(f"\n=== {sid}  ({len(rows)} koraka)")
        prompt_all = tot_in + tot_cache
        print(f"  nekeširano    : {fmt(tot_in):>14}")
        print(f"  iz keša       : {fmt(tot_cache):>14}   {pct(tot_cache, prompt_all)} od ukupnog prompta")
        print(f"  prompt ukupno : {fmt(prompt_all):>14}")
        print(f"  output        : {fmt(tot_out):>14}")
        if a.cost:
            with_cache = estimated_cost(tot_cache, tot_in, tot_out, a.peak)
            no_cache = estimated_cost(0, tot_in + tot_cache, tot_out, a.peak)
            print(f"  ~cena         : ${with_cache:0.4f}   (bez keša bi bilo ${no_cache:0.4f} — {no_cache / with_cache:0.1f}x više)")
        if a.all_sessions:
            continue

        # poslednjih N koraka: vreme, razmak, keš hit
        print(f"\n  zadnjih {min(a.last, len(rows))} koraka:")
        print("   vreme      pauza   prompt      iz keša   %keš   output")
        prev = None
        for ts, u in rows[-a.last:]:
            i = u.get("inputTokens", 0)
            c = u.get("cacheReadTokens", 0)
            o = u.get("outputTokens", 0)
            clock = time.strftime("%H:%M:%S", time.localtime(ts / 1000)) if ts else "  --  "
            gap = "--" if prev is None or not ts else f"{(ts - prev) / 60000:5.1f}m"
            print(f"   {clock}  {gap:>6}  {fmt(i):>10}  {fmt(c):>9}  {pct(c, i + c)}  {fmt(o):>7}")
            if ts:
                prev = ts

    if a.all_sessions or len(files) > 1:
        print("\n=== UKUPNO (sve sesije u logu)")
        print(f"  koraka: {grand['steps']}")
        print(f"  nekeširano: {fmt(grand['in'])}   iz keša: {fmt(grand['cache'])} ({pct(grand['cache'], grand['in'] + grand['cache'])})")
        print(f"  output: {fmt(grand['out'])}")
    print("\nNapomena: cenu gledaj na platform.deepseek.com (dashboard je izvor istine).")
    print("Ovde je bitno: % iz keša i pauza između koraka — posle duge pauze keš se")
    print("evakuiše, pa prvi korak posle nje ima nizak %keš i plaća se skuplja cena.")


if __name__ == "__main__":
    main()
