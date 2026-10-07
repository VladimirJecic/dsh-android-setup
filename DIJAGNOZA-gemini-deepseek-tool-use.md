# Dijagnoza: `session-5a658786` (i još 3 sesije) — Gemini + DeepSeek tool_use

Izvor: `~/storage/downloads/dsh-session-session-5a658786-9b6d-402b-91f6-4ba973aec19a.zip`
(skinut 23:14) → `session.v4.jsonl`, **105 događaja, kompletno** — identično
sa živim fajlom `~/.dsh/sessions/--data-data-com.termux-files-home-dsh--/session-5a658786-.../session.v4.jsonl.zstd`.

## 1. Šta se tačno desilo u toj sesiji

| vreme | turn | šta |
|---|---|---|
| 16.09. 09:50 | 1 | Gemini odgovorio na pitanje o DeepSeek keširanju. Sesija zatvorena (`session/end-seed`). |
| 29.09. 23:09:58 | 2 | Nastavak. Gemini (`gemini-flash-lite-latest`) izvršio **8 tool poziva** (`grep`, `skill`, `bash`×4, `read`) za ~17 s. |
| 23:13:25 | 2 | 9. poziv → **429 RESOURCE_EXHAUSTED** (free tier: `generate_content_free_tier_input_token_count`, limit **250.000** input tokena/min, model `gemini-3.5-flash-lite`, „retry in 34s“). Kvota se sabrala jer je 8 koraka poslalo celu rastuću istoriju (grep rezultat sam ima ~48 KB) u 17 sekundi. Nema retry-ja — QUOTA je konačna greška, turn pada. |
| 23:13:26 | 3 | Korisnik menja model na `deepseek-official/deepseek-flash`, „try again“ → **400** `messages.3.1: tool_use ids were found without tool_result blocks immediately after: call_75173` |
| 23:13:44 | 4 | „opet se desilo“ → **isti 400** |
| 23:13:55 | 5 | „nemoj da citas tool use“ → **isti 400** |

Bitno: **429 nije uzrok kvara**. On je samo naterao prelazak na DeepSeek. Isti
kvar se desio i u sesiji `a83cd6da` gde su svi Gemini turnovi završeni normalno
(bez 429), a prvi DeepSeek turn posle prelaska je pao.

## 2. Uzrok

Tool pozive je pravio **Gemini**, a DSH ih u istoriju upisuje kao assistant
poruku oblika:

```
[tool-call, text("")]          ← Gemini (pi-ai ruta)
[reasoning, text?, tool-call]  ← DeepSeek (sopstvene poruke), tool-call je UVEK poslednji
```

DeepSeek „Messages“ (Anthropic-kompatibilni) endpoint **odbija svaku istoriju u
kojoj iza `tool_use` bloka sledi tekst** — prijavljuje to kao da `tool_result`
ne postoji. DSH durabilna istorija se ne menja, pa se isti otrov ponovo šalje u
svakom sledećem turnu → sesija je **trajno neupotrebljiva na DeepSeek modelu**,
a na Geminiju i dalje radi (dokaz: `a83cd6da`, turn 6 je `completed` posle
povratka na Gemini).

### Dokaz 1 — indeks iz greške se poklapa 1:1 sa onim što DSH zaista šalje

Preslikao sam stvarni `serialize()` iz instaliranog `dsh-llm-deepseek` preko
izvezenog loga (`~/sesslog/fold.mjs`):

```
session-5a658786   greška: messages.3.1  call_75173
  [3] assistant tool_use:call_75173 | text(EMPTY)      ← Gemini poruka
  [4] user      tool_result:call_75173

session-6f3e1270   greška: messages.1.1  call_354980
  [1] assistant tool_use:call_354980 | text(EMPTY)
  [2] user      tool_result:call_354980

session-154ab422   greška: messages.7.2  call_20858, call_20861
  [7] assistant tool_use:call_20858 | tool_use:call_20861 | text(EMPTY)
  [8] user      tool_result:call_20858 | tool_result:call_20861
```

### Dokaz 2 — oblik assistant poruka po provajderu (sve sesije u workspace-u)

```
520x  deepseek-official   [reasoning tool-call]
141x  deepseek-official   [reasoning text tool-call]
 98x  deepseek-official   [reasoning tool-call tool-call]
 43x  google              [tool-call text(empty)]        ← jedini oblik sa Gemini
  2x  google              [tool-call tool-call text(empty)]
```

Nijedna DeepSeek poruka nikad nema tekst posle tool-call-a. Svaka Gemini poruka ima.

### Dokaz 3 — korelacija nad svim sesijama (`~/sesslog/scan_sessions.py`)

* DeepSeek turnovi čija je istorija sadržala Gemini tool pozive: **12/12 palo**
  sa istom greškom (4 sesije), **0 uspešnih**.
* DeepSeek turnovi bez Gemini tool poziva: **17 uspešnih**.
* Jedini Gemini→DeepSeek prelaz koji je prošao (`11fc5768`, turn 26) u istoriji
  nije imao Gemini tool pozive.

Ovo objašnjava i raniju grešku koju si sam prijavio:
`messages.7.2 ... call_20858, call_20861`.

**Praktična posledica:** `branch-into-new-session` „SMART start“ (prvi prompt na
Gemini Flash-Lite, pa prelaz na DeepSeek) obara sesiju uvek kada Gemini u tom
prvom potezu pozove bilo koji tool.

## 3. Popravka

Normalizovati redosled blokova **na izlazu DeepSeek adaptera** (durabilna
istorija i keš se ne diraju):

Fajl: `.../node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js`,
funkcija `assistant()` (linije 1534–1555). Posle `message.content.map(...)`
dodati:

```js
/* android-tool-use-order-fix */
const calls = blocks.filter((block) => block.type === "tool_use");
if (calls.length === 0) return blocks;
const rest = blocks.filter((block) => block.type !== "tool_use" &&
  !(block.type === "text" && block.text.length === 0));
const ordered = [...rest, ...calls];
return ordered.length === blocks.length &&
  ordered.every((block, index) => block === blocks[index]) ? blocks : ordered;
```

Za DeepSeek-ove sopstvene poruke (`[reasoning, text, tool_use]`) ovo je **no-op**,
pa prefiks-keš ostaje netaknut; menja se samo ono što je ionako pucalo.
Signature iz `replayState` ostaju zalepljene za svoj blok jer se sortira posle
mapiranja. Za strane (pi-ai) replay envelope važi postojeći `readReplay`
graceful-degrade, pa skraćenje niza ne baca grešku.

Verifikovano lokalno (patch na kopiji bundle-a, `~/sesslog/patched-deepseek.js`,
harness `fold-patched.mjs`) — ista sesija se sada foldira u:

```
[3] assistant tool_use:call_75173
[4] user      tool_result:call_75173        ← oblik identičan DeepSeek-ovom
```

Nakon patcha i `restart-dsh` **iste sesije se mogu nastaviti na DeepSeek-u bez
prepravke logova** (patch radi u vreme sastavljanja zahteva).

## 4. Pogođene sesije (za kasnije testiranje)

| sesija | greška |
|---|---|
| `session-5a658786-…` | messages.3.1 call_75173 |
| `session-154ab422-…` | messages.7.2 call_20858, call_20861 |
| `session-6f3e1270-…` | messages.1.1 call_354980 |
| `session-a83cd6da-…` | messages.5.1 call_67824 |

## 5. Pomoćni fajlovi

* `~/sesslog/session.v4.jsonl` — izvezena sesija (105 događaja) + `transcript.txt` (čitljiv transkript)
* `~/sesslog/fold.mjs` — stvarni DSH `serialize()` nad logom (dokazuje indekse)
* `~/sesslog/patched-deepseek.js`, `fold-patched.mjs` — validiran patch
* `~/sesslog/scan_sessions.py`, `shapes.py` — skener svih sesija

---

## 6. PRIMENJENO NA ŽIVU INSTALACIJU (2026-10-06)

Isti kvar se ponovio u sesiji `session-154bc11b-…` (18:34): Gemini je u turnu 1
napravio 42 tool poziva, pao na `Request quota exhausted`, a prvi DeepSeek turn
posle smene modela vratio je identičan
`messages.1.1: tool_use ids were found without tool_result blocks … call_331600`.
Zakrpa je zato primenjena na živu instalaciju (0.1.7-rc.2).

### 6.1 Dva sloja (oba u `~/dsh/patch-android-dsh.py`, sekcija **3f**)

| sloj | fajl | šta radi |
|---|---|---|
| `android-tool-use-order-fix` | `dsh-llm-deepseek/lib/index.js`, `assistant()` | na IZLAZU adaptera izbacuje prazan tekst i stavlja sve `tool_use` blokove na kraj poruke — **leči i već otrovane sesije** (durabilna istorija i prefiks-keš se ne diraju) |
| `android-empty-text-after-tool-call-fix` | `dsh-llm/lib/index.js`, `BlockAssembler.assembled()` | prazan `text` blok POSLE `tool-call`-a se **ne upisuje** u istoriju (pi-ai/Gemini ruta ga je upisivala); replay envelope se filtrira istim indeksima, pa pi-ai replay ostaje poravnat. **Izuzetak:** ako taj prazan blok u envelope-u nosi `textSignature` (Gemini thought signature ume da dođe na praznom text delu — vidi 6.5), blok se ČUVA; inače bi se izgubio deo replay lanca |

Sloj 2 je „long-term": nove sesije se više ne truju, pa kvar ne zavisi od toga
koji se model koristi posle Geminija. Sloj 1 pokriva sve što je već na disku
(takođe i tekst posle `tool_use` koji nije prazan, jer i to API odbija).

Oba su idempotentna (`--check` ih prijavljuje kao „već zakrpan") i
`~/.local/bin/dsh-termux` ih primenjuje pri svakom pokretanju, pa ih
`npm install -g @deepseek-ai/dsh@…` ne može trajno obrisati. Provera:

```bash
python3 ~/dsh/patch-android-dsh.py --check | grep -A1 3f
```

### 6.2 Dokaz protiv živog API-ja (ista otrovana sesija, isti zahtev)

`~/sesslog/replay-real.mjs` foldira `session-154bc11b` (upto seq 237 = tačno onaj
zahtev koji je pao) i šalje ga na `api.deepseek.com/anthropic/v1/messages`:

```
PRE   (original .bak)    84 poruka, 89 KB   tool_use + text   -> HTTP 400
      messages.1.1: tool_use ids were found without tool_result … call_331600
POSLE (živa instalacija) 84 poruka, 88 KB   tool_use          -> HTTP 200
```

### 6.3 Jedinični test asemblera

`BlockAssembler` nad Gemini oblikom `[tool-call, text("")]`:

| ulaz | pre | posle |
|---|---|---|
| `[tool-call, text("")]` + envelope (2 bloka) | `text("")` u istoriji | `[tool-call]`, envelope 1 blok |
| `[reasoning, text("hi"), tool-call]` (DeepSeek) | isto | **nepromenjeno** (no-op) |
| `[text("")]` bez tool poziva | `[text("")]` | nepromenjeno |
| `max-tokens` sa tool-call-om | tool-call izbačen | isto (+ prazan tekst iza njega) |

### 6.4 Nastavak sesije

Posle restarta se sesija nastavlja preko nove loopback rute
`POST /composer-extras/api/prompt-session` (`{sessionId, text, provider?, model?}`)
— dodata u `~/dsh/dsh-composer-extras/index.js` jer dsh-ove `/api/…` rute traže
browser kolačić, a skripta ga nema. Detalji: `~/dsh/resume-after-restart.sh`.

### 6.5 Uzrok uzroka (upstream) — zašto prazan blok uopšte postoji

Prazan text blok **ne pravi DSH**: dolazi iz sirovog Gemini odgovora, a
materializuje ga `@earendil-works/pi-ai@0.85.1` (zaseban npm dependency, NIJE
vendored u dsh):

* `pi-ai/dist/api/google-generative-ai.js:58` — `if (part.text !== undefined)`
  (prolazi i za `""`), pa `:87-89` otvara `currentBlock = { type: "text", text: "" }`
  i emituje `text_start`; `text_end` sa `""` dolazi na kraju streama (`:184-192`).
  Isti kod u `google-vertex.js` (twin).
* `@google/genai` prosleđuje `content` iz API-ja bez normalizacije
  (`dist/index.mjs` `candidateFromMldev`), pa je izvor **(a) sirov JSON Gemini API-ja**.
* Google to i dokumentuje: kod odgovora sa thought signature, potpis ume da dođe
  u delu sa praznim tekstom. Zato pi-ai namerno čuva *potpisane* prazne blokove
  (`google-shared.js:146`: prazan tekst se preskače samo ako NEMA potpisa) —
  otud izuzetak u sloju 2 gore.
* **Update ne pomaže:** `^0.85.1` drži 0.x na 0.85.x, a i najnoviji `1.0.4`
  (i `main`) imaju isti bezuslovni `if (part.text !== undefined)`. Nema
  upstream issue-a za ovaj slučaj, pa je lokalna zakrpa jedino rešenje —
  pravi upstream fix bio bi „ne otvaraj blok za part bez teksta, a potpis
  prenesi na susedni blok" u `packages/ai/src/api/google-generative-ai.ts`.


