#!/usr/bin/env python3
"""session-turn-state.py — ishod poslednjeg turna u zivom dsh logu (zstd jsonl).

    python3 session-turn-state.py <session.v4.jsonl.zstd>

Ispisuje jednu JSON liniju:
  {"events":N,"turns":N,"lastTurn":N,"kind":"completed|error|aborted|...",
   "error":"...","toolCalls":N,"lastEvent":"tool/result"}

`toolCalls` je broj tool/call dogadjaja POSLE poslednjeg turn/start — sluzi kao
dokaz da sesija stvarno radi (a ne samo da je turn prihvacen).
"""
import json
import subprocess
import sys

path = sys.argv[1]
try:
    raw = subprocess.run(["zstd", "-dc", path], capture_output=True, timeout=60).stdout
except Exception as exc:  # noqa: BLE001
    print(json.dumps({"error": f"zstd failed: {exc}"}))
    sys.exit(0)

events = 0
turns = 0
last_turn = None
last_kind = None
last_error = ""
tool_calls = 0
last_event = ""
last_turn_start_seq = -1

for line in raw.splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        entry = json.loads(line)
    except ValueError:
        continue
    events += 1
    kind = entry.get("type", "")
    last_event = kind
    if kind == "turn/start":
        last_turn_start_seq = events
        tool_calls = 0
    elif kind == "tool/call" and last_turn_start_seq >= 0:
        tool_calls += 1
    elif kind == "turn/end":
        turns += 1
        data = entry.get("data", {})
        reason = data.get("reason", {}) or {}
        last_turn = data.get("turn")
        last_kind = reason.get("kind")
        err = reason.get("error") or {}
        last_error = str(err.get("message", ""))[:240]

print(json.dumps({
    "events": events,
    "turns": turns,
    "lastTurn": last_turn,
    "kind": last_kind,
    "error": last_error,
    "toolCalls": tool_calls,
    "lastEvent": last_event,
}, ensure_ascii=False))
