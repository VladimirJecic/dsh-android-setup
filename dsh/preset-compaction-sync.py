#!/usr/bin/env python3
"""Compaction config u dsh web profilu — generator patch bloka.

STA SE PISE
-----------
`auto: false` — dsh NIKAD ne kompaktuje sam. Kompakciju pokrece iskljucivo
korisnik: `/compact` iz komande trake, ili dugme „Compact session" u context
guard-u (dsh-composer-extras) koje se pojavljuje kao PREDLOG na 50% konteksta.
`thresholdRatio: 0.6` je zapisan samo zato da prag bude tacno 60% ako se auto
ikada ponovo ukljuci.

ZASTO OVAKO
-----------
`compaction-basic` u web profilu NE postoji kao host red: `dsh-web-app` ga
iskljucuje (`- id: compaction-basic / disabled: true`) jer compaction zivi u
realm-u agent preseta. Aktivne kopije su redovi unutar deklaracije preseta
(`preset-standard`, `preset-ptc`, `preset-cordis`), pa se config menja tamo.

Patch mehanizam (vidi skill `cordis-composition-reference`):
  * `insert: [rows]` dodaje redove;
  * patch sa `id` i bez `insert` menja postojeci red tog id-a, ali
    **`config` se zamenjuje u celosti, nikad se ne spaja dubinski** —
    zato override preseta mora da ponovi ceo `config.plugins`.

Ova skripta zato ne pise YAML rucno: ona prepise deklaraciju preseta iz
instaliranog bundle-a (`dsh-web-app/presets/<id>.patch.yml`), ubaci `config` u
red `compaction-basic` i upise rezultat u profil patch izmedju markera.
Idempotentna je — posle `npm install -g @deepseek-ai/dsh` (drugi bundle, novi
preseti) dovoljno je pustiti je ponovo.

EFEKTIVNI PRAG (vazi samo ako je auto ukljucen)
----------------------------------------------
compaction-basic racuna:
    threshold = min(contextWindow * thresholdRatio,
                    contextWindow - rezervisani_output - headroomTokens)
gde je rezervisani output = model.maxTokens (deepseek-flash 256000),
a headroomTokens = 65536 (default). Za 0.6:
    deepseek-flash (window 1000000):   min(600000, 678464) = 600000  -> 60.0%
    gemini-flash-lite (window 1048576): min(629145, 950272) = 629145 -> 60.0%

Primena: `python3 ~/dsh/preset-compaction-sync.py` (poziva je i
`~/.local/bin/dsh-termux` pri svakom startu, kao gemini katalog).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
PROFILE_PATCH = HOME / ".dsh/profiles/web/cordis.patch.yml"

BEGIN = "# >>> preset-compaction (auto-generisano; ne edituj rucno — pokreni preset-compaction-sync.py) >>>"
END = "# <<< preset-compaction <<<"

DEFAULT_RATIO = 0.6
DEFAULT_PRESETS = ("standard", "ptc", "cordis")

# Gde se trazi instalirani bundle; prva koja nadje presets/ pobedjuje.
BUNDLE_CANDIDATES = (
    HOME / ".dsh/profiles/web/node_modules/@deepseek-ai/dsh-web-app",
    Path("/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app"),
)


def find_presets_dir() -> Path:
    for base in BUNDLE_CANDIDATES:
        presets = base / "presets"
        if presets.is_dir() and any(presets.glob("*.patch.yml")):
            return presets
    raise SystemExit(
        "preset-compaction-sync: ne nalazim dsh-web-app/presets; "
        "proveri gde je instaliran @deepseek-ai/dsh-web-app"
    )


def extract_preset_row(text: str, preset_id: str) -> list[str]:
    """Vrati deklaraciju preseta iz shipped fajla, bez `insert:` i bez uvoda.

    Shipped fajl je oblika:

        - insert:
            - id: preset-standard
              name: '@deepseek-ai/dsh-agent-preset'
              config: ...

    Vracamo redove od `- id: preset-<id>` (4 razmaka manje uvucene), jer
    override patch ne sme da ima `insert:`.
    """
    lines = text.splitlines()
    insert_at = next((i for i, line in enumerate(lines) if line.rstrip() == "- insert:"), None)
    if insert_at is None:
        raise SystemExit(f"preset-compaction-sync: {preset_id}: nema '- insert:' u fajlu")

    rows: list[str] = []
    for line in lines[insert_at + 1:]:
        if line.strip() == "":
            rows.append("")  # prazni redovi su deo block-scalar teksta (plan-mode)
            continue
        if line.startswith("    "):
            rows.append(line[4:])
            continue
        break  # manje uvucen red => kraj insert liste

    if not rows or not rows[0].startswith(f"- id: preset-{preset_id}"):
        raise SystemExit(
            f"preset-compaction-sync: {preset_id}: ocekivao '- id: preset-{preset_id}', "
            f"dobio {rows[0] if rows else '(nista)'!r}"
        )
    return rows


def with_threshold(rows: list[str], ratio: float) -> list[str]:
    """Ubaci `config` u red `compaction-basic` unutar preseta.

    `auto: false` je sustina: DSH tada NIKAD ne kompaktuje sam — jedini putevi
    su korisnikov `/compact` i dugme „Compact session" u context guard-u
    (dsh-composer-extras), koje ide na istu komandu. `thresholdRatio` ostaje
    zapisan da prag bude tacno 60% ako se auto ikada ponovo ukljuci.
    """
    out: list[str] = []
    injected = False
    index = 0
    while index < len(rows):
        line = rows[index]
        followed_by_name = (
            index + 1 < len(rows) and "dsh-compaction-basic" in rows[index + 1]
        )
        if not injected and line.strip() == "- id: compaction-basic" and followed_by_name:
            name_line = rows[index + 1]
            indent = len(name_line) - len(name_line.lstrip())
            out.append(line)
            out.append(name_line)
            out.append(" " * indent + "config:")
            out.append(" " * (indent + 2) + "auto: false")
            out.append(" " * (indent + 2) + f"thresholdRatio: {ratio:g}")
            injected = True
            index += 2
            continue
        out.append(line)
        index += 1
    if not injected:
        raise SystemExit("preset-compaction-sync: nema reda '- id: compaction-basic' u presetu")
    return out


def build_block(presets_dir: Path, presets: tuple[str, ...], ratio: float) -> str:
    lines = [
        BEGIN,
        "#",
        "# AUTO-COMPACT JE ISKLJUCEN (`auto: false`): dsh nikad ne kompaktuje sam.",
        "# Kompakciju pokrece ISKLJUCIVO korisnik — `/compact` iz komande trake ili",
        "# dugme Compact session u context guard-u (dsh-composer-extras), koje se",
        "# pali kao PREDLOG na 50% konteksta. `thresholdRatio` je tu samo da prag",
        "# bude 60% ako se auto ikada ponovo ukljuci.",
        "#",
        "# Red `compaction-basic` u web profilu je disabled, pa se config menja na",
        "# deklaraciji svakog agent preseta. Patch sa `id` zamenjuje `config` celog",
        "# reda (nikad se ne spaja dubinski), zato je ovaj blok pun - generise ga",
        "# ~/dsh/preset-compaction-sync.py iz instaliranog dsh-web-app bundle-a.",
        "#",
        f"# thresholdRatio = {ratio:g} -> min(window x ratio, window - maxTokens - 65536):",
        "#   deepseek-flash      (1.000.000): min(600000, 678464) = 600000 = 60%",
        "#   gemini-flash-lite   (1.048.576): min(629145, 950272) = 629145 = 60%",
        "#",
    ]
    for preset in presets:
        source = presets_dir / f"{preset}.patch.yml"
        if not source.is_file():
            print(f"preset-compaction-sync: presets/{preset}.patch.yml ne postoji — preskacem", file=sys.stderr)
            continue
        if "id: compaction-basic" not in source.read_text(encoding="utf-8"):
            print(f"preset-compaction-sync: preset '{preset}' ne montira compaction — preskacem", file=sys.stderr)
            continue
        rows = with_threshold(extract_preset_row(source.read_text(encoding="utf-8"), preset), ratio)
        lines.append(f"# --- preset-{preset} (iz {source.name}) " + "-" * max(0, 40 - len(preset)))
        lines.extend(rows)
    lines.append(END)
    return "\n".join(lines) + "\n"


def apply_block(patch_path: Path, block: str) -> str:
    """Zameni markerima oznacen blok; ako ga nema, dodaj ga na kraj."""
    if not patch_path.is_file():
        raise SystemExit(f"preset-compaction-sync: nema {patch_path}")
    text = patch_path.read_text(encoding="utf-8")
    if BEGIN in text and END in text:
        pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.S)
        new_text = pattern.sub(block, text)
        action = "zamenjen"
    else:
        new_text = text.rstrip("\n") + "\n\n" + block
        action = "dodat"
    if new_text == text:
        return "nepromenjen"
    patch_path.write_text(new_text, encoding="utf-8")
    return action


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ratio", type=float, default=DEFAULT_RATIO, help="prag kao deo konteksta (default 0.6)")
    parser.add_argument("--presets", default=",".join(DEFAULT_PRESETS), help="lista preset id-jeva, zapeta")
    parser.add_argument("--check", action="store_true", help="samo ispisi sta bi uradio")
    args = parser.parse_args()

    if not 0 < args.ratio < 1:
        raise SystemExit("preset-compaction-sync: --ratio mora biti izmedju 0 i 1")
    presets = tuple(p.strip() for p in args.presets.split(",") if p.strip())

    presets_dir = find_presets_dir()
    block = build_block(presets_dir, presets, args.ratio)

    if args.check:
        print(block)
        return 0

    action = apply_block(PROFILE_PATCH, block)
    print(f"preset-compaction-sync: {action} blok u {PROFILE_PATCH} (ratio={args.ratio:g}, preseti={','.join(presets)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
