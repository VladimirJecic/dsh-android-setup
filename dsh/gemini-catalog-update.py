#!/usr/bin/env python3
"""gemini-catalog-update.py — drzi Gemini katalog sveden na "latest" Flash modele.

Launcher (`~/.local/bin/dsh-termux`) ga zove pri SVAKOM startu, pa
`npm install -g @deepseek-ai/dsh` ne moze trajno da ga ponisti. Idempotentan je.

Sta radi: u `~/.dsh/profiles/web/cordis.patch.yml` obezbedi id-targeted
override cvora `llm-pi-ai` sa uskim spiskom modela za rutu `google`:
    google -> gemini-flash-latest, gemini-flash-lite-latest

Zasto `models:` suzava katalog: pi-ai prvo ucita svoj ugradjeni katalog za
rutu, pa ga "materializuje" pod konfigurisanim unosima — navedeni `id`-ovi
zadrzavaju katalog default-e, a sve sto nije navedeno se ne prikazuje u pickeru.

Zasto `deepseek-flash` NE pripada ovde (bivsi bug): model sluzi native
`llm-deepseek` adapter iz dsh-base, koji VEC registruje rutu
`deepseek-official`. Drugi adapter na istoj ruti se odbija kao
DUPLICATE_ADAPTER, a zapis pod `google:` bi trazio da Google servira DeepSeek
model. Obe varijante su greska, pa ih skripta sada i eksplicitno prijavljuje.

Provera je strukturna (PyYAML), ne tekstualna: ranija verzija je gledala samo
da li se ID-jevi modela negde pojavljuju, pa je prijavljivala "[ok]" i za fajl
u kome su Gemini modeli i `deepseek-flash` stajali pod istim `google:` kljucem.

Bezbednost: skripta NIKAD ne prepisuje fajl koji ima tudje izmene. Ako
`cordis.patch.yml` nije ni prazan ni nas, samo prijavi i izadje sa 1.
"""
import os
import sys
from pathlib import Path

import yaml

HOME = Path(os.path.expanduser("~"))
PATCH = HOME / ".dsh" / "profiles" / "web" / "cordis.patch.yml"

GOOGLE_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"]

# Ruta koju registruje native `llm-deepseek` adapter; deklarisati je u
# llm-pi-ai znaci DUPLICATE_ADAPTER.
NATIVE_DEEPSEEK_ROUTE = "deepseek-official"
NATIVE_DEEPSEEK_MODELS = ["deepseek-flash"]

BODY = """# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
#
# llm-pi-ai: katalog sveden na Gemini "latest" Flash par.
#
# `deepseek-flash` se NE deklarise ovde. Sluzi ga native `llm-deepseek`
# adapter iz dsh-base, koji vec registruje rutu `deepseek-official`; drugi
# adapter na istoj ruti se odbija kao DUPLICATE_ADAPTER. Zapis pod `google`
# bi pak trazio da Google servira DeepSeek model — obe varijante su greska.
#
# Odrzava ga ~/dsh/gemini-catalog-update.py (launcher ga zove pri startu).
- id: llm-pi-ai
  config:
    providers:
      google:
        apiKeyEnv: GOOGLE_API_KEY
        models:
{models}"""


def render():
    return BODY.format(
        models="".join(f"          - id: {m}\n" for m in GOOGLE_MODELS)
    )


class _Loader(yaml.SafeLoader):
    """SafeLoader that tolerates cordis' `!!js` tags and spots duplicate keys."""


def _unknown_tag(loader, tag_suffix, node):
    # cordis evaluates `!!js` itself; here we only need the shape, so keep it raw.
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


_Loader.add_multi_constructor("!", _unknown_tag)


def _construct_mapping(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise ValueError(f"duplikat YAML kljuca: {key!r} (linija {key_node.start_mark.line + 1})")
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep=deep)


_Loader.construct_mapping = _construct_mapping


def parse(text):
    return yaml.load(text, Loader=_Loader)


def is_effectively_empty(text):
    stripped = "\n".join(
        line for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ).strip()
    return stripped in ("", "[]")


def find_entry(doc, entry_id):
    if not isinstance(doc, list):
        return None
    for entry in doc:
        if isinstance(entry, dict) and entry.get("id") == entry_id:
            return entry
    return None


def google_models(entry):
    """Return the model ids configured for the `google` route, or None."""
    try:
        providers = entry["config"]["providers"]
        route = providers["google"]
        models = route["models"]
    except (KeyError, TypeError):
        return None
    if not isinstance(models, list):
        return None
    return [m.get("id") for m in models if isinstance(m, dict)]


def diagnose(doc, text):
    """Return a list of human-readable problems; empty means the file is correct.

    Structural only: comments that *mention* `deepseek-flash` are fine, only an
    actual configured route or model id is a problem.
    """
    problems = []

    if doc is None:
        problems.append("fajl se ne parsira kao YAML lista")
        return problems
    if not isinstance(doc, list):
        problems.append(f"koren nije YAML lista (nego {type(doc).__name__})")
        return problems

    entry = find_entry(doc, "llm-pi-ai")
    if entry is None:
        problems.append("nema unosa sa id: llm-pi-ai")
        return problems

    try:
        providers = entry["config"]["providers"]
    except (KeyError, TypeError):
        problems.append("llm-pi-ai nema config.providers")
        return problems
    if not isinstance(providers, dict):
        problems.append("llm-pi-ai config.providers nije mapa")
        return problems

    foreign = sorted(k for k in providers if k != "google")
    for route in foreign:
        if route == NATIVE_DEEPSEEK_ROUTE:
            problems.append(
                f"ruta {route!r} je deklarisana u llm-pi-ai, a registruje je native "
                f"llm-deepseek adapter -> DUPLICATE_ADAPTER"
            )
        else:
            problems.append(f"neocekivana ruta {route!r} u llm-pi-ai")

    models = google_models(entry)
    if models is None:
        problems.append("llm-pi-ai nema config.providers.google.models")
        return problems

    missing = [m for m in GOOGLE_MODELS if m not in models]
    extra = [m for m in models if m not in GOOGLE_MODELS]
    if missing:
        problems.append(f"google ruti fale modeli: {missing}")
    if extra:
        problems.append(
            f"google ruta sadrzi modele koji joj ne pripadaju: {extra} "
            f"(Google ne moze da servira DeepSeek model)"
        )
    return problems


def main():
    if not PATCH.parent.is_dir():
        print(f"  [!] profil ne postoji: {PATCH.parent}")
        return 1

    if not PATCH.is_file():
        PATCH.write_text(render())
        print(f"  [ok] kreiran {PATCH}")
        return 0

    text = PATCH.read_text()

    try:
        doc = parse(text)
    except Exception as error:
        print(f"  [!] {PATCH} se ne parsira: {error}")
        print("      ne diram fajl — ispravi ga rucno")
        return 1

    problems = diagnose(doc, text)
    if not problems:
        print(f"  [ok] katalog podesen ({len(GOOGLE_MODELS)} gemini modela, "
              f"deepseek na native ruti)")
        return 0

    # Auto-ispravka samo ako je fajl ceo nas (nema tudjih unosa).
    ours_only = isinstance(doc, list) and all(
        isinstance(e, dict) and e.get("id") == "llm-pi-ai" for e in doc
    ) and len(doc) == 1

    if is_effectively_empty(text) or ours_only:
        PATCH.write_text(render())
        print(f"  [ok] katalog ispravljen ({len(GOOGLE_MODELS)} gemini modela)")
        for problem in problems:
            print(f"      - {problem}")
        return 0

    print(f"  [!] {PATCH} ima izmene van naseg bloka — ne prepisujem")
    for problem in problems:
        print(f"      - {problem}")
    print("      ispravi rucno, ili obrisi fajl pa pokreni ponovo")
    return 1


if __name__ == "__main__":
    sys.exit(main())
