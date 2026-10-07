#!/usr/bin/env python3
"""uplati — build an NBS IPS QR (Serbian instant-payment QR) from a saved
contact template and hand it to the Banca Intesa app via the Android share sheet.

Templates live in ~/.uplati/*.txt, one per contact, as simple `key: value`
lines. Generated PNGs go to that dir's temp/.

That is Termux's *private* storage (mode 0700), not /storage/emulated/0: a
template holds a real bank account number, and any app holding
READ_EXTERNAL_STORAGE can read shared storage. The tradeoff is that templates
are no longer editable from a file manager — edit them from Termux, or set
UPLATI_DIR (or the older PAY_TO_DIR) to move the base directory back.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata

DEFAULT_BASE_DIR = os.path.join(os.path.expanduser("~"), ".uplati")
BASE_DIR = (
    os.environ.get("UPLATI_DIR")
    or os.environ.get("PAY_TO_DIR")
    or DEFAULT_BASE_DIR
)
# Templates sit directly in BASE_DIR (not in a `templates/` subdir) so they stay
# easy to open and edit from a file manager.
TEMPLATE_DIR = BASE_DIR
TEMP_DIR = os.path.join(BASE_DIR, "temp")

DEFAULT_AMOUNT = "500,00"  # used when a template has no amount of its own

FIELDS = ("name", "account", "amount", "description", "payer", "code", "reference")
# IPS QR field length limits (NBS specification)
LIMITS = {"name": 70, "payer": 70, "description": 35, "reference": 25}


def fold(text):
    """Lowercase, strip diacritics — so 'avramovic' matches 'Avramović'."""
    text = text.replace("đ", "dj").replace("Đ", "Dj")
    stripped = unicodedata.normalize("NFD", text)
    stripped = "".join(c for c in stripped if unicodedata.category(c) != "Mn")
    return stripped.lower()


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", fold(name)).strip("-")


# Serbian case endings, longest first. Spoken input arrives inflected —
# "uplati Marku", "uplati Lani", "uplati Avramovicu" — so both the query and the
# stored name are reduced to a stem before comparing.
CASE_TAILS = ("ovima", "evima", "ima", "ama", "om", "em", "ju", "u", "i", "e", "a", "o")
MIN_STEM = 3


def stem(word):
    for tail in CASE_TAILS:
        if word.endswith(tail) and len(word) - len(tail) >= MIN_STEM:
            return word[: -len(tail)]
    return word


def word_matches(part, word):
    """True if a query fragment plausibly refers to this name word."""
    if word.startswith(part):
        return True
    a, b = stem(part), stem(word)
    return bool(a) and bool(b) and (a.startswith(b) or b.startswith(a))


# ---------------------------------------------------------------- templates

def read_template(path):
    data = {"_path": path}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            key, _, value = line.partition(":")
            data[key.strip().lower()] = value.strip()
    return data


def write_template(data):
    lines = ["# pay-to contact template — edit freely, values are reused as defaults"]
    for key in FIELDS:
        if data.get(key):
            lines.append(f"{key}: {data[key]}")
    with open(data["_path"], "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    try:
        os.chmod(data["_path"], 0o600)
    except OSError:
        pass  # shared storage ignores chmod; not fatal


def list_templates():
    if not os.path.isdir(TEMPLATE_DIR):
        return []
    return sorted(
        os.path.join(TEMPLATE_DIR, f)
        for f in os.listdir(TEMPLATE_DIR)
        if f.endswith(".txt")
    )


def find_template(query):
    """Match a name/surname fragment against filename and the `name:` field."""
    needle = fold(query).replace("-", " ").strip()
    parts = [p for p in needle.split() if p]
    hits = []
    for path in list_templates():
        data = read_template(path)
        haystack = fold(os.path.basename(path)[:-4].replace("-", " ") + " " + data.get("name", ""))
        words = {w for w in haystack.split() if w}
        if all(any(word_matches(p, w) for w in words) for p in parts):
            hits.append(data)
    return hits


# ------------------------------------------------------------- normalising

def parse_amount(raw):
    """Serbian notation: ',' is the decimal separator, '.' groups thousands."""
    text = str(raw).strip().upper().replace("RSD", "").replace("DIN", "").strip()
    text = text.replace(" ", "").replace(" ", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", text):
        text = text.replace(".", "")  # 1.500 -> 1500
    value = round(float(text), 2)
    if value <= 0:
        raise ValueError("amount must be greater than zero")
    return value


def format_amount(value):
    """3334.0 -> '3334,00' (IPS wants a bare decimal amount, no thousands separator)."""
    return f"{value:.2f}".replace(".", ",")


def normalize_account(raw):
    """'170-0030038233008-42' -> 18-digit '170003003823300842'."""
    digits = re.sub(r"\D", "", str(raw))
    if len(digits) != 18:
        raise ValueError(
            f"account must be 18 digits, got {len(digits)} from {raw!r} "
            "(format: bbb-xxxxxxxxxxxxx-kk)"
        )
    return digits


def build_payload(data, amount, description):
    payload = [
        "K:PR",
        "V:01",
        "C:1",
        "R:" + normalize_account(data["account"]),
        "N:" + data["name"],
        "I:RSD" + format_amount(amount),
    ]
    if data.get("payer"):
        payload.append("P:" + data["payer"])
    payload.append("SF:" + (data.get("code") or "289"))
    if description:
        payload.append("S:" + description)
    if data.get("reference"):
        payload.append("RO:" + re.sub(r"\s+", "", data["reference"]))

    for key, limit in LIMITS.items():
        value = {"name": data.get("name"), "payer": data.get("payer"),
                 "description": description, "reference": data.get("reference")}[key]
        if value and len(value) > limit:
            raise ValueError(f"{key} is {len(value)} chars, IPS limit is {limit}")

    text = "|".join(payload)
    if len(text.encode("utf-8")) > 331:
        raise ValueError("payload exceeds the 331-byte IPS QR limit")
    return text


# ------------------------------------------------------------------ output

def render(payload, path):
    import qrcode

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=12, border=4)
    qr.add_data(payload.encode("utf-8"))
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(path)


SHARE_DIR = "/storage/emulated/0/Download"
SHARE_PREFIX = "uplati-qr"


def media_scan(path):
    """Tell MediaStore the file changed (or is gone). Best-effort."""
    subprocess.run(["termux-media-scan", path], check=False,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def clear_stage():
    """Delete the QRs earlier runs left on shared storage, if any.

    Each removed path is rescanned so MediaStore drops its row instead of
    keeping a stale one pointing at content that no longer exists.
    """
    try:
        names = os.listdir(SHARE_DIR)
    except OSError:
        return
    for name in names:
        if name.startswith(SHARE_PREFIX) and name.endswith(".png"):
            stale = os.path.join(SHARE_DIR, name)
            try:
                os.remove(stale)
            except OSError:
                continue
            media_scan(stale)


def share(path, default_app=False):
    """Hand the QR to Banca Intesa, directly by default.

    The share sheet cannot be skipped, and attempts to do so are dead ends —
    both were tried and are recorded here so they are not tried again:

    * An explicit `am start -n hr.asseco.android.intesa.isbd.bib/...` with a
      `file://` URI reaches the bank app, but it cannot read the file and falls
      back to showing its own picker. Banca Intesa targets SDK 35 and declares
      only READ_EXTERNAL_STORAGE, which has been inert since Android 13; it does
      not declare READ_MEDIA_IMAGES. It therefore cannot read *any* path on
      shared storage, and depends entirely on the temporary read grant attached
      to a `content://` URI. Only Termux:API can mint that URI.
    * `termux-share -d` skips the explicit chooser, but Android then shows the
      resolver whose "Just once"/"Always" buttons apply to the app in the top
      slot, chosen by Android — WhatsApp here, not Banca Intesa. Tapping Banca
      Intesa lower down is still a one-off. Worse, a stray tap on "Always" would
      permanently route every future payment QR to WhatsApp, so this stays
      opt-in behind --default-app.

    One tap on Banca Intesa in the share sheet is the floor Android allows.

    Banca Intesa does not use the temporary read grant that comes with the
    share intent; it looks for the image as an ordinary file, so it cannot see
    anything in Termux's private storage. Stage a copy on shared storage and
    hand that over instead. Only this one QR is ever exposed, and the next run
    deletes it — the templates, which hold the account numbers, stay private.

    The staged copy gets a unique name per run and is media-scanned before the
    share sheet opens. Reusing one fixed path meant Banca Intesa could resolve
    a stale MediaStore row and read the previous (or half-indexed) image, which
    showed up as a wrongly prefilled payment form on the first attempt.
    """
    target = path
    stage = os.path.join(SHARE_DIR, f"{SHARE_PREFIX}-{os.getpid()}-{int(time.time())}.png")
    staged = False
    try:
        shutil.copyfile(path, stage)
        media_scan(stage)
        target = stage
        staged = True
    except OSError:
        pass  # no shared storage — fall back to the private path

    cmd = ["termux-share", "-a", "send", "-c", "image/png"]
    if default_app:
        cmd.append("-d")
    cmd.append(target)
    subprocess.run(cmd, check=False)
    return "default-app" if default_app else "chooser"


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(prog="uplati")
    ap.add_argument("query", nargs="?", help="name or surname fragment")
    ap.add_argument("-a", "--amount", help="override amount, e.g. 1.250,50")
    ap.add_argument("-d", "--description", help="override payment description")
    ap.add_argument("-r", "--reference", help="poziv na broj, e.g. 9744PFM0396B26")
    ap.add_argument("--list", action="store_true", help="list saved contacts")
    ap.add_argument("--no-share", action="store_true", help="only write the PNG")
    ap.add_argument("--default-app", action="store_true",
                    help="send to Android's default receiver instead of the share "
                         "sheet (see share() — the Always button targets the app "
                         "Android puts on top, which is not Banca Intesa)")
    ap.add_argument("--keep", action="store_true", help="do not update the template")
    args = ap.parse_args()

    clear_stage()  # drop the previous run's QR from shared storage

    # 0700 where the filesystem allows it: these hold bank account numbers.
    # Android's shared storage ignores or rejects chmod, so this is best-effort.
    for d in (BASE_DIR, TEMPLATE_DIR, TEMP_DIR):
        os.makedirs(d, mode=0o700, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass

    if args.list or not args.query:
        rows = [read_template(p) for p in list_templates()]
        if not rows:
            print(f"No templates yet in {TEMPLATE_DIR}")
            return 0
        for row in rows:
            print(f"{os.path.basename(row['_path'])[:-4]:<24} {row.get('name','?')} | "
                  f"{row.get('account','?')} | {row.get('amount','-')} | "
                  f"{row.get('description','-')}")
        return 0

    hits = find_template(args.query)
    if not hits:
        print(f"No template matches {args.query!r}. Templates in {TEMPLATE_DIR}:",
              file=sys.stderr)
        for path in list_templates():
            print("  " + os.path.basename(path)[:-4], file=sys.stderr)
        return 1
    if len(hits) > 1:
        print(f"{args.query!r} matches several contacts — be more specific:",
              file=sys.stderr)
        for hit in hits:
            print("  " + os.path.basename(hit["_path"])[:-4], file=sys.stderr)
        return 1

    data = hits[0]
    if args.reference:
        data["reference"] = args.reference
    raw_amount = args.amount or data.get("amount") or DEFAULT_AMOUNT
    try:
        amount = parse_amount(raw_amount)
        # An explicit -d "" means "no purpose at all" (the S tag is optional in
        # the IPS spec); only a missing -d falls back to the saved value.
        description = (
            args.description
            if args.description is not None
            else data.get("description", "")
        )
        payload = build_payload(data, amount, description)
    except (ValueError, KeyError) as err:
        print(f"Cannot build the QR: {err}", file=sys.stderr)
        return 1
    out = os.path.join(TEMP_DIR, slugify(data.get("name", args.query)) + ".png")
    render(payload, out)

    if not args.keep:
        data["amount"] = format_amount(amount)
        data["description"] = description
        write_template(data)

    print(f"Primalac:    {data['name']}")
    print(f"Racun:       {data['account']}")
    print(f"Iznos:       RSD {format_amount(amount)}")
    print(f"Svrha:       {description or '-'}")
    if data.get("reference"):
        print(f"Poziv na br: {data['reference']}")
    print(f"Payload:     {payload}")
    print(f"QR:          {out}")

    if not args.no_share:
        share(out, default_app=args.default_app)
        print("Share sheet opened — choose Banca Intesa to confirm the payment.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
