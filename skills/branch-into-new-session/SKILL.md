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
   `-t "<naslov>"`, `--history` (fork; default je prazna sesija),
   `--smart`/`--model p/m` (uključi smart; default je OFF),
   `--dry-run`, `--force` (granaj i iz već branchovane sesije), `-h`.
3. Skripta ispiše `OK session=session-… group=… smartModel=…` (ili `FAIL …`).
   `smartModel` pokazuje koji je model izabran za prvi prompt; po defaultu je
   `default (smart iskljucen)` — vidi „Smart start" ispod.
4. **Odgovori korisniku samo kratko**, npr.:
   > Nova sesija `session-…` je napravljena u grupi `…` i preuzeće zadatak.
   > (Ovaj razgovor se ne nastavlja.)
   i **prekini** — bez rešavanja zadatka, bez alata, bez dodatnog teksta.

## Dva moda (od 2026-11-15)

**Mod bira ULAZ, nikad tekst prompta.** Nema `--new` markera u promptu.

| Ulaz | Mod | Šta nova sesija dobija |
|---|---|---|
| **dropdown na dugmetu** u composeru → *Fork (sa istorijom)* | fork | istoriju do zadnjeg završenog turna + prompt |
| **dropdown na dugmetu** → *Nova (prazna)* | prazna | samo prompt |
| `/branch <prompt>` | fork | isto kao fork |
| `/branch-new <prompt>` | prazna | isto kao prazna |
| `branch.sh <fajl>` | **prazna** (default) | samo prompt |
| `branch.sh --history <fajl>` | fork | istorija + prompt |

**Fork** (`controller.fork`) seče na granici **završenog** turna, pa snimak
nikad nema nedovršene `tool-call`-ove, a prefiks zahteva ostaje identičan
onome što je izvorna sesija slala — provider-ov keš pogađa. Ako glavna sesija
još nema završen turn, fork vraća `409`.

**Prazna** sesija je default u `branch.sh` (kompatibilnost sa starijim
ponašanjem i sa zaštitom od lančanog grananja), a **fork** je default u
GUI-ju i komandama — tamo je „prebaci ovo tamo" gotovo uvek fork.

## Kako radi

`branch.sh` (i dugme, i komande) šalju `POST
http://127.0.0.1:3081/composer-extras/api/branch-session` (plugin
`dsh-composer-extras`, server deo). Telo:

```json
{"prompt": "…", "parentSession": "session-…", "cwd": "/…", "mode": "fork"|"new"}
```

- `mode: "fork"` → `ctx.get('sessionController').fork({ sessionId })` pa
  `prompt`; `mode: "new"` → `controller.create({ workspaceId })` pa `prompt`
- oba idu kroz **jednu** funkciju `sendToNewSession` (`index.js`) — jedina
  implementacija grananja
- nova sesija je **attach-ovana na isti workspace** (zato ista grupa u sidebar-u)
- ruta upiše oznaku `~/dsh/.branch-into-new-session/children/<nova-sesija>`
  (zaštita od lančanog grananja; čita je `branch.sh` pre POST-a)
- dete dobija **isti model** kao izvor preko `agent.model.select()` — namerno
  ne `sessionController.selectModel`, jer taj put trajno menja profilni default

Za razliku od starog pristupa (`dsh headless` u pozadini), ovo se izvršava
**u samom web serveru**, pa se sesija odmah registruje u GUI-ju i može da se
otvori i nastavi.

## Smart start — ISKLJUČEN po defaultu (odluka 2026-11-15)

**Default: nova sesija kreće na profilnom default modelu. Smart se ne dira.**

Zašto je default okrenut: ruta zove `sessionController.selectModel`, a taj put
na kraju izvrši `agentDefaultModel.saveSelection()` — dakle **trajno prepiše
deployment default model u `cordis.patch.yml`**, za sve buduće sesije, ne samo
za novu. Dok je `SMART=1` bio default, svako grananje je tiho prebacivalo profil
na Gemini Flash-Lite. Zato skripta sada podrazumevano ne dira model.

Ako se smart ipak želi, uključuje se **izričito**:

- `--smart` — smart start sa podrazumevanim `google/gemini-flash-lite-latest`.
- `--model <provider>/<model>` — smart start sa drugim modelom (i sam uključuje
  `--smart`).
- `--no-smart` — i dalje postoji (sada je default) da bi izričito poništio
  prethodni `--smart`/`--model`.

Ako izbor modela padne (nema Google ključa i sl.), branch se **ne obara**:
sesija krene na default modelu, a skripta ispiše `modelError=...`.

Kad je smart uključen, važi i dalje:

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

Ruta zato u odgovoru vraća `smart`, `model` i `modelError`; skripta ispisuje
`smartModel=…` (ili `default (smart iskljucen)`).

## Zamke

- Ruta je deo plugina — posle izmene `~/dsh/dsh-composer-extras/index.js`
  treba **jedan restart dsh-a** da se učita. Kad ruta ne postoji, skripta
  ispiše `FAIL: … restartuj dsh …`.
- **Ne granaj iz sesije koja je i sama branchovana.** Skripta to odbija
  (`exit 3`) preko oznake u `children/`; ako baš treba lanac, `--force`.
- Bez `--history` skripta pravi **praznu** sesiju. Za kopiju istorije koristi
  `--history`, ili `/branch` komandu / dropdown „Fork" u composeru.
- Ako pozivajuća sesija nije ni u jednom workspace-u, nova sesija ide u
  „Ungrouped" (nema šta da se nasledi).
- **Ne koristi `--smart` olako** — vidi gore: `selectModel` trajno prepiše
  profilni default model.
- Ne diraj `~/.config/dsh-secrets.env`.

## Primer

```bash
cat > "$TMPDIR/branch-task.md" <<'EOF'
Proveri da li postoje burnovane epizode sezone 3 i odgovori direktno.
EOF
~/.dsh/skills/branch-into-new-session/branch.sh -t "Sezona 3" "$TMPDIR/branch-task.md"
# -> OK session=session-xxxx group=... historyShared=False smartModel=default (smart iskljucen)

# izričito smart start (prvi prompt na Gemini — PAZI: menja i profilni default):
~/.dsh/skills/branch-into-new-session/branch.sh --smart "$TMPDIR/lako.md"
# ili eksplicitno drugi model (takođe uključuje smart):
~/.dsh/skills/branch-into-new-session/branch.sh --model deepseek/deepseek-flash "$TMPDIR/tesko.md"
```
