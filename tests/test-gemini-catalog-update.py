#!/usr/bin/env python3
"""Regresija za `~/dsh/gemini-catalog-update.py` (katalog se zove pri startu).

Najvaznija provera je `!!js`: cordis dozvoljava JS izraze u patch sloju, a
`dsh-base` ih stvarno koristi (`disabled: !!js process.platform === 'win32'`).
PyYAML `!!js` ne resava u lokalni tag nego u `tag:yaml.org,2002:js`, pa je
multi-konstruktor registrovan samo pod `"!"` propustao taj tag i ceo patch sloj
je padao na `could not determine a constructor` — tiho, u logu starta
(2026-10-08). Ovaj test cuva bas taj slucaj.

Pokretanje:  python3 ~/dsh/tests/test-gemini-catalog-update.py
"""

import contextlib
import importlib.util
import io
import sys
import tempfile
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parent.parent / "gemini-catalog-update.py"

passed = 0
failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


def load_module():
    spec = importlib.util.spec_from_file_location("gemini_catalog_update", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_main():
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = m.main()
    return code, buffer.getvalue()


m = load_module()

# ────────────────────────────────────────────────── 1. `!!js` izrazi (bug)

print("\n1. `!!js` tag se parsira i ostaje sirov string")

scalar = m.parse("disabled: !!js process.platform === 'win32'\n")
check("skalar sa `!!js` ne puca", scalar == {"disabled": "process.platform === 'win32'"}, repr(scalar))

nested = m.parse(
    "plugins:\n"
    "  - id: tool-bash\n"
    "    disabled: !!js process.platform === 'win32'\n"
    "  - id: tool-pwsh\n"
    "    disabled: true\n"
)
check(
    "`!!js` unutar liste/mapa cuva strukturu",
    nested["plugins"][0]["disabled"] == "process.platform === 'win32'"
    and nested["plugins"][1]["disabled"] is True,
    repr(nested),
)

local = m.parse("disabled: !js ctx.get('a')\n")
check("lokalni `!js` takodje prolazi", local == {"disabled": "ctx.get('a')"}, repr(local))

# Prava linija iz cordis.patch.yml koja je obarala start.
real = m.parse("      - id: tool-bash\n        disabled: !!js process.platform === 'win32'\n")
check("prava linija iz patch sloja prolazi", real[0]["id"] == "tool-bash", repr(real))

# ─────────────────────────────────────────── 2. duplikat kljuca se i dalje vidi

print("\n2. duplikat YAML kljuca ostaje greska")

duplicate_raised = False
try:
    m.parse("id: llm-pi-ai\nid: drugi\n")
except ValueError as error:
    duplicate_raised = "duplikat" in str(error)
check("duplikat kljuca baca ValueError", duplicate_raised)

# ───────────────────────────────────────────── 3. `is_effectively_empty`

print("\n3. prazan/tudji fajl")

check("prazan string je prazan", m.is_effectively_empty("") is True)
check("samo komentari su prazni", m.is_effectively_empty("# komentar\n\n# joss\n") is True)
check("`[]` je prazno", m.is_effectively_empty("[]\n") is True)
check("nas blok nije prazan", m.is_effectively_empty(m.render()) is False)

# ────────────────────────────────────── 4. diagnose: nas i pokvaren katalog

print("\n4. diagnose() nad nasim i nad pokvarenim katalogom")

ok = m.parse(m.render())
ok_problems = m.diagnose(ok, m.render())
check("nas katalog je bez problema", ok_problems == [], repr(ok_problems))
check(
    "oba gemini modela su u nasem katalogu",
    m.google_models(m.find_entry(ok, "llm-pi-ai")) == m.GOOGLE_MODELS,
)

broken = m.parse(
    "- id: llm-pi-ai\n"
    "  config:\n"
    "    providers:\n"
    "      deepseek-official:\n"
    "        models:\n"
    "          - id: deepseek-flash\n"
)
broken_problems = m.diagnose(broken, "")
check(
    "native ruta u llm-pi-ai se prijavljuje kao DUPLICATE_ADAPTER",
    any("DUPLICATE_ADAPTER" in p for p in broken_problems),
    repr(broken_problems),
)

missing = m.parse(
    "- id: llm-pi-ai\n"
    "  config:\n"
    "    providers:\n"
    "      google:\n"
    "        models:\n"
    "          - id: gemini-flash-latest\n"
)
missing_problems = m.diagnose(missing, "")
check("model koji fali se prijavljuje", any("fale modeli" in p for p in missing_problems), repr(missing_problems))
check("koren koji nije lista se prijavljuje", m.diagnose({"id": "llm-pi-ai"}, "") != [])

# ─────────────────────────── 5. main() end-to-end nad fajlom sa `!!js`

print("\n5. main() prihvata tudji `!!js` i ne prepisuje tudje izmene")

with tempfile.TemporaryDirectory() as tmp:
    patch = Path(tmp) / "cordis.patch.yml"
    patch.write_text(m.render() + "\n- id: ui-settings-general\n  disabled: !!js process.platform === 'win32'\n")
    m.PATCH = patch
    code, out = run_main()
    check("main() vrati 0 za ispravan katalog sa `!!js`", code == 0, f"code={code} out={out!r}")
    check("main() potvrdi da je katalog podesen", "katalog podesen" in out, out)
    check("tudji `!!js` unos je ostao u fajlu", "!!js" in patch.read_text())

    # Pokvaren nas blok, ali fajl je SAMO nas -> auto-ispravka.
    patch.write_text("- id: llm-pi-ai\n  config:\n    providers:\n      google:\n        models: []\n")
    code, out = run_main()
    check("main() sam ispravi nas pokvaren blok", code == 0 and "ispravljen" in out, out)
    check(
        "posle ispravke oba modela su tu",
        m.google_models(m.find_entry(m.parse(patch.read_text()), "llm-pi-ai")) == m.GOOGLE_MODELS,
    )

    # Fajl sa tudjim izmenama se NE prepisuje.
    patch.write_text(
        "- id: llm-pi-ai\n  config:\n    providers:\n      google:\n        models: []\n"
        "- id: tudji\n  disabled: true\n"
    )
    before = patch.read_text()
    code, out = run_main()
    check("tudji fajl se ne prepisuje", code == 1 and patch.read_text() == before, out)

# ────────────────────────────────────────── 6. pravi profil na ovoj masini

print("\n6. stvarni ~/.dsh/profiles/web/cordis.patch.yml (ako postoji)")

real_patch = Path.home() / ".dsh" / "profiles" / "web" / "cordis.patch.yml"
if real_patch.is_file():
    text = real_patch.read_text()
    try:
        doc = m.parse(text)
        check("stvarni patch sloj se parsira", True)
        problems = m.diagnose(doc, text)
        check("stvarni patch sloj je bez problema", problems == [], repr(problems))
    except Exception as error:  # noqa: BLE001 — test prijavljuje, ne pada
        check("stvarni patch sloj se parsira", False, repr(error))
else:
    check("stvarni patch sloj postoji (preskoceno ako ne postoji)", False, str(real_patch))

print(f"\n{'✅' if failed == 0 else '❌'} {passed} provera prošlo, {failed} palo\n")
sys.exit(0 if failed == 0 else 1)
