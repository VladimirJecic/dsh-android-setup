---
name: uplati
description: Generate an NBS IPS QR payment code for a saved contact and open it in the Banca Intesa app to confirm payment. Use when the user types /uplati <name fragment>, says "uplata <Ime Prezime>", "uplati <ime>", "uplati Marku", "plati <ime>", "pay to <name>", or otherwise asks to pay/send money to a saved contact via QR.
---

# uplati

Builds a Serbian **NBS IPS QR** code from a stored contact template and hands the
PNG to Android's share sheet, where the user picks **Banca Intesa** (its app
registers `android.intent.action.SEND` for `image/*`, so it reads the QR and
opens a prefilled payment form).

## Triggers

Serbian is the primary phrasing, and it arrives through voice input, so match
loosely on the **dative case** — the name will be inflected:

- **"uplata <Ime Prezime>"** — the user's usual spoken form; whatever follows
  the word "uplata" is the recipient's name ("uplata Marko Avramović")
- `/uplati marku`, "uplati Marku", "uplati Lani 2000", "uplati Branku za stan"
- `plati <ime>`, "posalji pare <imenu>"
- English: `/pay-to <name>`, "pay to Marko", "pay Marko 500"

**Pass the name through as spoken — do not try to de-inflect it yourself.** The
matcher stems Serbian case endings on both sides and ignores diacritics, so
`marku`, `lani`, `branku`, `avramovicu` and `Marko Avramović` all resolve
correctly. If nothing matches, run `--list` and match by eye rather than
guessing an account.

## Layout

- Templates: `~/.uplati/<slug>.txt` (Termux private storage, mode 0700/0600 —
  account numbers are not readable by other apps; edit them from Termux, not a
  file manager. `UPLATI_DIR` overrides the base dir.)
- Generated QR images: `~/.uplati/temp/<slug>.png`
- Script: `~/.claude/skills/uplati/uplati.py`

Template format (one `key: value` per line; `name`, `account` required):

```
name: Marko Avramović
account: 170-0010320644000-86
amount: 500,00
description: za qr kod ideju
code: 289
payer: Vladimir Ječić        # optional
reference: 9744PFM0396B26    # optional poziv na broj, model + broj
```

`amount` and `description` are the **last used** values — the script rewrites
them after each run so the next `/uplati <ime>` reuses them. A template with no
`amount` falls back to the global default **500,00 RSD** (`DEFAULT_AMOUNT` in
`uplati.py`).

## Usage

```bash
python3 ~/.claude/skills/uplati/uplati.py "avramovic"
python3 ~/.claude/skills/uplati/uplati.py "marko" -a "1.250,50" -d "za kafu"
python3 ~/.claude/skills/uplati/uplati.py --list
```

Flags: `-a/--amount`, `-d/--description`, `-r/--reference`, `--list`,
`--no-share` (write PNG only), `--default-app`, `--keep` (don't update the template).

The base directory can be overridden with `UPLATI_DIR` (or the legacy
`PAY_TO_DIR`).

## How to run it

1. Match on a name **or** surname fragment, diacritic- and case-insensitive
   (`avramovicu` → `Marko Avramović`). Ambiguous matches are an error, not a
   guess.
2. If the user gives a new amount/description in the prompt, pass them as flags.
3. If no template matches, show the user the existing contacts and offer to
   create a new template — never invent an account number.
4. Run the script, then report the payment details back so the user can verify
   before confirming in the bank app.

## Why the share sheet cannot be skipped

Asked for in this session and proven impossible; do not retry either route.

- **Explicit `am start` to the bank app.** Its entry activity
  `hr.asseco.android.intesa.isbd.bib/com.internationalvalueservices.digical.MainActivity`
  is `exported=true` and accepts `SEND` with `*/*`, so the intent does arrive —
  but the app cannot read the image and falls back to showing its own file
  picker. Banca Intesa targets SDK 35 and declares only
  `READ_EXTERNAL_STORAGE`, inert since Android 13, and never
  `READ_MEDIA_IMAGES`. It cannot read any path on shared storage, and depends
  entirely on the temporary read grant carried by a `content://` URI — which
  only Termux:API can mint, and only through a share.
- **`termux-share -d`** (send to the default receiver) skips the explicit
  chooser, but Android then shows the resolver whose "Just once" / "Always"
  buttons apply to the app Android puts in the top slot — WhatsApp on this
  device, not Banca Intesa, which sits below under "Use a different app" and is
  therefore always a one-off. A stray tap on "Always" would route every future
  payment QR to WhatsApp, so it stays opt-in behind `--default-app`.

One tap on Banca Intesa in the share sheet is the floor Android allows. Say so
plainly if the user asks for it to open directly.

## Notes

- **Serbian notation**: `,` is decimal, `.` groups thousands — `1.250,50` is one
  thousand two hundred fifty dinars and 50 para. The parser handles both, output
  is always `RSD 1.250,50`.
- Account is normalised to the 18-digit IPS form (`170-0010320644000-86` →
  `170001032064400086`); anything else is rejected.
- Payment code (`SF`) defaults to `289` (transfer / other). Use `221` for goods
  and services invoices.
- IPS limits enforced: name/payer ≤ 70, description ≤ 35, reference ≤ 25 chars,
  payload ≤ 331 bytes.
- Requires `termux-api` (share sheet) and the `qrcode` + `pillow` Python packages.
- The user still confirms and signs the payment inside Banca Intesa — this skill
  never moves money on its own.
