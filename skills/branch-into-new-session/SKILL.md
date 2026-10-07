---
name: branch-into-new-session
description: Prosleđuje zadatak u NOVU praznu dsh sesiju u istom workspace-u (GUI grupa) kao pozivajuća sesija, sa SMART startom (prvi prompt ide Gemini Flash-Lite, pa tek onda DeepSeek) i odmah se zaustavlja. Koristi se kada korisnik kaže "branch into new session", "otvori novu sesiju za ovo", "prebaci ovo u novu sesiju", "nastavi u novoj sesiji" ili "/branch-into-new-session".
---

# `branch-into-new-session` Skill

**Ovo je „prosledi i stani".** Zadatak se predaje **novoj, praznoj** sesiji i
tu se tvoj posao završava — **ne rešavaj zadatak u ovoj sesiji** i ne
odgovaraj na njega. Jedini tvoj izlaz je kratka potvrda da je nova sesija
napravljena.

> **Ako SI ti ta nova sesija, NE granaj dalje.** Sesija koju je ova ruta
> napravila ima oznaku u `~/dsh/.branch-into-new-session/children/<sessionId>`
> i `branch.sh` će iz nje odbiti da grana (`FAIL: … ne granam je ponovo`,
> exit 3). To nije greška skripte — grananje je već obavljeno i zadatak treba
> odraditi **ovde**. Ruta uz prompt šalje i `<system-reminder>` sa istim
> uputstvom; ako ga vidiš u svojoj prvoj poruci, radi posao, ne prosljeđuj ga.
> (2026-10-07: nova sesija je pozvala ovaj skill iz svog prompta, napravila
> treću sesiju, pa je korisnikov tekst ostao u međusesiji — „tekst je otišao u
> pogrešan prozor".)

Nova sesija:
- je **prazna** (ne deli istoriju ovog razgovora — bez fork seed-a, bez
  prethodnih poruka),
- dobija **samo** prosleđeni prompt (ništa više od neophodnog),
- radi u **istom workspace-u** kao pozivajuća sesija, pa se u sidebar-u pojavi
  u **istoj grupi** (npr. `Season 2`, `dsh`), a ne u „Ungrouped".

## Koraci (agent)

1. Sastavi **samostalan** prompt za novu sesiju i upiši ga u fajl, npr.
   `$TMPDIR/branch-task.md`. Nova sesija ne vidi ovaj razgovor — u prompt ide
   sve što joj treba.
2. Pozovi skriptu:

   ```bash
   ~/.dsh/skills/branch-into-new-session/branch.sh "$TMPDIR/branch-task.md"
   ```

   Opcije: `-s <id>` (izvor; default `$DSH_SESSION_ID`), `-c <dir>` (cwd),
   `-t "<naslov>"`, `--dry-run`, `--force` (granaj i iz već branchovane
   sesije), `-h`.
3. Skripta ispiše `OK session=session-… group=… smartModel=…` (ili `FAIL …`).
   `smartModel` pokazuje koji je model izabran za prvi prompt (default Gemini).
4. **Odgovori korisniku samo kratko**, npr.:
   > Nova sesija `session-…` je napravljena u grupi `…` i preuzeće zadatak.
   > (Ovaj razgovor se ne nastavlja.)
   i **prekini** — bez rešavanja zadatka, bez alata, bez dodatnog teksta.

## Kako radi

`branch.sh` šalje `POST http://127.0.0.1:3081/composer-extras/api/branch-session`
(plugin `dsh-composer-extras`, server deo):

- `ctx.get('sessionController').create({ workspaceId })` — prazna sesija
  **attach-ovana na isti workspace** (zato ista grupa),
- `ctx.get('sessionController').prompt({...})` — prosleđen prompt; kao **prvi**
  `text` deo ide `<system-reminder>` koji novoj sesiji zabranjuje ponovno
  grananje, a kao drugi korisnikov tekst,
- ruta upiše oznaku `~/dsh/.branch-into-new-session/children/<nova-sesija>`
  (zaštita od lančanog grananja; čita je `branch.sh` pre POST-a),
- istorija se **ne** kopira (`historyShared: false`).

Za razliku od starog pristupa (`dsh headless` u pozadini), ovo se izvršava
**u samom web serveru**, pa se sesija odmah registruje u GUI-ju i može da se
otvori i nastavi.

## Smart start (Gemini prvi) — default

Nova sesija **ne kreće na DeepSeek-u**: pre prvog prompta ruta pozove
`sessionController.selectModel({ sessionId, provider: "google", model: "gemini-flash-lite-latest" })`.
`selectModel` važi za **sledeći request**, pa prvi (mali) prompt obradi Gemini —
ako je zadatak sitan, cela sesija se završi bez DeepSeek konteksta.

- `--model <provider>/<model>` — drugi model za prvi prompt.
- `--no-smart` — ne diraj model; sesija kreće na profilnom default modelu.
- Ako izbor modela padne (nema Google ključa i sl.), branch se **ne obara**:
  sesija krene na default modelu, a skripta ispiše `modelError=...`.
- Kasniji promptovi u toj sesiji prate **klijentski** `gemini-seek-smart`
  raspored (2 Gemini prompta pa DeepSeek + cooldown); brojač je u klijentu, pa
  prosleđeni prompt nije uračunat u ta 2.
- **😎 indikator se sam upali za tu sesiju — i samo za tu sesiju.** Server
  zapamti branched sesiju (`BRANCH_SMART_SESSIONS`), a klijent na mount-u pita
  `GET /composer-extras/api/branch-info?sessionId=…`; ako je `smart:true`,
  upali svoj režim i trajno označi sesiju u localStorage
  (`composer-extras-gemini-seek-on-<id>`), pa to preživi reload i restart.
  Od 2026-10-07 je to **jedini** način da se smart sam upali: globalna
  preferencija „uključeno svuda" je uklonjena, pa se otvaranje obične
  (nebranchovane) sesije više ne dira model.

Ruta zato u odgovoru vraća `smart`, `model` i `modelError`, a skripta ispisuje
`smartModel=google/gemini-flash-lite-latest`.

## Zamke

- Ruta je deo plugina — posle izmene `~/dsh/dsh-composer-extras/index.js`
  treba **jedan restart dsh-a** da se učita. Kad ruta ne postoji, skripta
  ispiše `FAIL: … restartuj dsh …`.
- **Ne granaj iz sesije koja je i sama branchovana.** Skripta to odbija
  (`exit 3`) preko oznake u `children/`; ako baš treba lanac, `--force`.
- Ne koristi `session/fork` — on **kopira istoriju** do granice; ovde je
  izričito tražena prazna sesija.
- Ako pozivajuća sesija nije ni u jednom workspace-u, nova sesija ide u
  „Ungrouped" (nema šta da se nasledi).
- Ne diraj `~/.config/dsh-secrets.env`.

## Primer

```bash
cat > "$TMPDIR/branch-task.md" <<'EOF'
Proveri da li postoje burnovane epizode sezone 3 i odgovori direktno.
EOF
~/.dsh/skills/branch-into-new-session/branch.sh -t "Sezona 3" "$TMPDIR/branch-task.md"
# -> OK session=session-xxxx group=... historyShared=False smartModel=google/gemini-flash-lite-latest

# zadatak koji sigurno traži DeepSeek (preskoči Gemini):
~/.dsh/skills/branch-into-new-session/branch.sh --no-smart "$TMPDIR/tesko.md"
# ili eksplicitno drugi model:
~/.dsh/skills/branch-into-new-session/branch.sh --model deepseek/deepseek-flash "$TMPDIR/tesko.md"
```
