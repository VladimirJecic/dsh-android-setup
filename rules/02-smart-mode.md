# 02. Smart mode (`gemini-seek-smart`, dugme 😎)

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Kod:
> `~/dsh/dsh-composer-extras/client.js` + `~/dsh/tests/test-composer-extras-smart-default.mjs`.

## Šta je

Rotacija modela: **2 prompta na Gemini Flash-Lite**, pa **60 s cooldown na
DeepSeek Flash**, pa nazad na Gemini — dok je uključeno. Cilj: koristi Gemini
free tier dok ide, a DeepSeek upadne kad Gemini padne na 429.

Raspored (`GEMINI_SEEK_SCHEDULE` u `client.js`):
`google/gemini-flash-lite-latest` (count 2, `windowMs` 60 s) →
`deepseek-official/deepseek-flash` (cooldown 60 s).

## KADA se pali sam (pravilo od 2026-10-07)

| Sesija | Smart |
|---|---|
| **Prazna nova sesija** (dugme „+", `SessionSummary.blank === true`, lista `ready`) | **DA** — podrazumevano |
| Postojeći razgovor sa istorijom | **NE** |
| Sesija koju je `branch-into-new-session` označila kao smart (`…-on-<id>`) | DA — ali samo ako je kontekst poznat i ≤300k |
| Bilo koja sesija sa eksplicitnim 😎 „off" (`…-off-<id>`) | NE — klik pobeđuje sve |
| **Restart / hard refresh** velike sesije sa `…-on-<id>` oznakom | **NE** — vidi „Nepoznat kontekst" ispod |

- „Prazna" = dsh-ov sopstveni `blank` flag iz `sessions.list`, i to **samo kad
  je lista stvarno stigla** (`phase === "ready"`). dsh klijent za nepoznatu
  sesiju počinje kao „conservatively blank" (`session.d.ts`), pa bi `blank: true`
  iz liste koja još učitava vratio smart u razgovor sa istorijom.
- **Zašto tako:** prva verzija fix-a ugasila je auto-paljenje svuda (žalba „sam
  se uključio Smart mode kada sam se prebacio na razgovor"), pa je i obična nova
  prazna sesija ostala bez smart-a — korisnik je to odbio. Sada je prazna sesija
  smart, a **postojeći** razgovori nisu.
- Stari globalni `localStorage` ključ
  `composer-extras-gemini-seek-default-enabled` se **namerno ne čita** (da
  ranije upisano `true` ne bi ponovo palilo smart svuda).
- **Svako gašenje se PAMTI** (`…-off-<id>` u `localStorage`): i 😎 klik, i
  granica od 300k, i **ručni izbor modela** u dropdownu. Do 2026-10-07 je ručni
  izbor gasio smart samo u memoriji, pa ga je prvi reload/restart vratio.

## Nepoznat kontekst NE SME da prebaci model (fix 2026-10-07)

Žalba: „restart dsh je uzrokovao da se smart dugme uključi za ovu sesiju, a
kontekst je već velik." Uzrok je bio **fail-open** guard: `sessionContextTokens`
čita `contextPressure` projekciju, a ona je posle restarta/hard refresh-a prazna
dok se sesija ne uveze i ne replay-uje — pa je `undefined` značilo „nije
prevelika", `activateGeminiSeek` je prebacio model na Gemini, i tek je sledeći
submit otkrio da je sesija >300k (a do tada je već bio na Gemini-ju).

Pravilo sada:

- `geminiContextVerdict()` vraća tri stanja: `"ok"` / `"too-big"` / `"unknown"`.
- **Automatsko paljenje** (prazna sesija ili `…-on-` oznaka) sa `"unknown"` i
  sesijom koja **nije dokazano prazna** → **čeka** projekciju (12 × 250 ms ≈ 3 s)
  pa odlučuje; ako i posle toga nema broja → **ostaje isključeno**. Model se
  **nikad** ne prebacuje na slepo.
- **Dokazano prazna sesija** se pali odmah (nema istorije koju bi merio).
- **Ručni 😎 klik** ostaje trenutan, ali dobija watchdog: ako se ispostavi da je
  kontekst >300k, smart se gasi, model se vraća na DeepSeek i upisuje se „off".
- **Submit sa >300k** sada **vraća model na DeepSeek PRE slanja** (ranije je
  gasio smart, ali je zahtev ipak išao na Gemini koji je ostao izabran).

## Automatizam koji NE treba kvariti

- **429 reakcija:** `session.lastAgentError` protiv
  `/RESOURCE_EXHAUSTED|"code"\s*:\s*429/` — odmah skok na DeepSeek + auto
  `"try again"`, ne čeka se kraj budžeta.
- **Ručni izbor modela gasi toggle** (`directory.store.subscribe`), ali
  `applyingSwitch` blokira reakciju na sopstveni switch — bez toga se toggle
  gasio na svaki auto-switch.
- **Granica 300k tokena:** sesija koja je prerasla Gemini free tier (250k input
  tokena/min) se sama isključi **u trenutku** kad bi inače prešla na Gemini;
  per-session „off" oznaka to pamti.
- **`gemini-flash-lite-latest` NE SME da se izbaci iz kataloga** — bez njega
  nema ni smart-a. Katalog održava `~/dsh/gemini-catalog-update.py` (launcher ga
  zove pri startu; `!!js` regresija iz 2026-10-08 je tu tiho obarala
  osvežavanje — vidi [`05-odrzavanje.md`](05-odrzavanje.md)).
- Kvota je **per Google Cloud projekat**, ne per ključ — drugi Gemini ključ na
  istom projektu ne pomaže.

## Kako se proverava

```bash
node ~/dsh/tests/test-composer-extras-smart-default.mjs   # 31 provera, obavezno zelen posle svake izmene smart pravila
```

Detalji testa: [`05-odrzavanje.md`](05-odrzavanje.md).
