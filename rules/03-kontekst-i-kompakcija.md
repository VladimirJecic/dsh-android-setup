# 03. Kontekst, token-metar i kompakcija

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Kod:
> `~/dsh/dsh-composer-extras/client.js`, `~/dsh/preset-compaction-sync.py`.

## Dva broja koja se stalno mešaju

| Gde | Šta je | Da li samo raste |
|---|---|---|
| pill „… tok" u composer stats traci (ikona baze) | `tokenUsage.totals` — **kumulativni saobraćaj cele sesije** (`uncached + cacheRead + cacheWrite + output`, sabrano preko svih zahteva) | da, nikad ne pada |
| kružić desno od inputa | `contextPressure.projectedTokens / contextWindow` — **trenutna zauzetost konteksta** | ne — pada posle compacta |

- **Restart ne resetuje ni jedan broj.** Sesija se pri otvaranju replay-uje iz
  `session.v4.jsonl.zstd` kroz projekcije, pa zbirovi ispadnu isti.
- Reset metra = **nova sesija** (`+`); za postojeću reset ne postoji.
- **Keširani tokeni se ponovo broje u svakom zahtevu** — u jednoj merenoj sesiji
  98% metra je `cacheRead` (isti prompt se čita iz keša 200×). Cache hit je 50×
  jeftiniji od miss-a, ali nije 0 i nije „već jednom brojan".
- `compact` **ne kešira ništa** — on skraćuje prompt; keš gradi provajder sam.
  Prvi zahtev posle compacta je zato skoro ceo cache **miss** (puna cena), pa se
  keš u sledećih par zahteva vrati na ~99% hit.

## Prozor (`contextWindow`) je per-provider/model

- Prozor dolazi iz adaptera, ne iz sesije: `deepseek-official/deepseek-flash` →
  **1.000.000**, `google/gemini-flash-lite-latest` → **1.048.576**. dsh emituje
  `request/context` čim se provider/model/prozor promeni.
- Brojilac (`contextPressure.pressureTokens`, iz usage-a) i imenilac
  (`contextWindow`, iz `request/context`) su **dva nezavisna last-wins slota**,
  pa posle promene modela procenat može **jedan zahtev** da bude netačan.
- Zato hook/provera treba da gleda **procenat iz kružića**, nikad kumulativni
  „… tok" (greška koja je već jednom napravljena: prag od 500.000 tokena na metru
  koji meri saobraćaj, ne zauzetost).

## Auto-compact je ISKLJUČEN — kompakciju uvek odobrava korisnik

**Odluka 2026-10-07:** dsh nikad ne sme da kompaktuje sam. U profilu stoji
`auto: false` na `compaction-basic`, pa su jedini putevi:

1. **Predlog na 50% konteksta** — `dsh-composer-extras` „context guard" popup
   (dugmad: *Branch into new session* / *Compact session* / *Nastavi dalje*).
2. **Ručni `/compact`** iz komande trake (ili `/clear-context`, koji je samo
   alias preko `ctx.commands.execute`).

Zato **nema `compaction/start` bez klika korisnika**. Automatski bi se u logu
video kao `compaction/start` **bez** `sourceCommandId` i bez `command/run`;
ručni ima `sourceCommandId: cmd-…` (tabela ispod).

### Context guard (predlog, ne akcija)

- Prag: **50% prozora** (`CONTEXT_GUARD_WINDOW_FRACTION = 0.5`, uz apsolutni
  `CONTEXT_GUARD_TOKENS = 500000` — za 1M prozor se poklope). **Ispod 50% se
  panel ne prikazuje** — korisnikov zahtev od 2026-10-08 („updejtuj da ga ne
  vidim ispod 50%").
  - **Prag se više ne spušta ni privremeno.** 2026-10-08 je bio privremeno 0.25,
    pa 0.05, samo da bi se novi modal video odmah; obe vrednosti su uklonjene
    zajedno sa `⚠️ TEMP` markerom. Za proveru izgleda modala služi
    `~/dsh/panel-preview.html`, a **ne** spuštanje praga i **ne** klik na
    „Compact session" (to je prava kompakcija, ne test).
  - Test prag **čita iz koda** (`CONTEXT_GUARD_WINDOW_FRACTION`) *i* traži da je
    tačno 0.5 — pa padne ako se prag opet spusti.
  - Posle svake izmene klijenta sledi **hard refresh**; config (`auto: false`)
    traži restart, klijent ne (vidi [`01-sesije.md`](01-sesije.md)).
- Meri **isključivo** `contextPressure` (`projectedTokens / contextWindow`),
  nikad `tokenUsage` — taj drugi je kumulativni saobraćaj (test to čuva).
- Ponavlja se svakih `CONTEXT_GUARD_RENUDGE = 100000` tokena iznad praga (≈ na
  60%, 70%, 80%…), a „Nastavi dalje" pamti odbačeni opseg po sesiji
  (`localStorage`).
  - **Odbacivanje nije ćorsokak:** dok je opseg odbačen, ostaje mali pill
    `📦 Kontekst N%` koji na klik vraća pun panel (bez toga se panel ne može
    dozvati do +100k tokena — 2026-10-07: „ne vidim panel"). Zato se odbacivanje
    pamti **jedan opseg niže**, pa je isti opseg ponovo iznad njega.
  - **Pill stoji dole LEVO, ispod „+" dugmeta — nikad uz desnu ivicu.**
    2026-10-08 (drugi krug): `right: 12; bottom: 96` je na telefonu seo preko
    reda sa dugmadima. Mesto se **meri iz DOM-a** (`useComposerPillAnchor`):
    kartica composera je `[data-composer-card]`, a „+" je jedino dugme u njoj sa
    `aria-haspopup="listbox"` (stabilni core atributi — heširane CSS klase se
    menjaju pri svakom build-u). Red sa dugmadima se na telefonu **lomi u dva
    reda** (`tools` pa `trailing`), pa je leva polovina drugog reda, tačno ispod
    „+", prazna — pill ide tamo, poravnat sa levom ivicom „+". Ako tog prostora
    nema (širok ekran, red se ne lomi), pill ide u prazan levi deo dock trake na
    dnu ekrana. Meri se ponovo na `resize` i `scroll`. Bez DOM-a (test harness,
    prvi render) koristi se statični fallback `left: 16; bottom: 52` — i on je
    levo/dole, nikad desno.
- „Compact session" **ne dira draft** i ne submit-uje iz composera: zove našu
  rutu `POST /composer-extras/api/compact` (`{sessionId, waitMs: 90000}`), koja
  čeka da agent pređe u `idle` i vraća **pravi ishod**. Kartica se **sklanja
  odmah na klik** (`📦 Kompaktujem…` ostaje u pill-u), a ako server odbije (npr.
  „agent nije idle") panel se **sam vraća** sa porukom servera — neuspeh se nikad
  ne završava tišinom.
- Zašto ruta, a ne `/compact` u draft: `compactNow` traži **idle** agenta, a
  guard se pali usred turna; ruta sačeka kraj turna umesto da pojede draft.
- **Modal je centriran i ide kroz `createPortal` u `document.body`** (isto kao
  core `SettingsPanel`). `position: fixed` unutar slota u composeru nije vezan za
  viewport ako neki predak napravi containing block (transform/filter), pa je
  kartica 2026-10-08 ispadala **uz desnu ivicu** („izašao je sa strane"). U
  portalu je preko celog ekrana: `fixed` overlay + `flex/center` + maska.
  Zatvaranje: **klik na masku** (bilo gde van kartice), **Esc**, i svako od tri
  dugmeta. Maska je zaseban element (kao u core-u), pa klik na karticu ne može da
  je pogodi — nema `stopPropagation`-a.
- **Svi hookovi idu PRE svakog `return`-a** (prag, opseg i `dismissed` se
  računaju iznad `useState`/`useEffect`). Rani `return` ispred hooka menja broj
  hookova između render-a i React baca „Rendered fewer hooks than expected" — tj.
  puca ceo composer onog trenutka kad sesija pređe (ili padne ispod) praga.
- **Panel mora da ima NEPROVIDNU podlogu.** `--dsw-specific-menu` je u svetloj
  temi `#f8f9fa94` (58% alfa) i u core-u ide uz `backdrop-filter`; u inline stilu
  bez blura se tekst iza panela providi (viđeno 2026-10-07). Zato panel koristi
  `--dsw-alias-bg-base` (#fff / #151517) + `backdrop-filter` kao pojas i šraf +
  amber obod, a „Compact session" je vizuelno primarno dugme. Test (sekcija 8) to
  čuva.
  - Tokeni (`--dsw-*`) su definisani na `body` (`dsh-client-ui-theme`), pa ih
    portalan modal u `document.body` i dalje nasleđuje — zato portal ne menja
    temu, samo geometriju.

### Kako se u logu prepoznaje (ručni vs auto)

| | ručni `/compact` | auto (kad bi bio uključen) |
|---|---|---|
| pre njega | `command/run {name:"compact", source:{kind:"user"}}` | nema tog događaja |
| `compaction/start` | ima `sourceCommandId: cmd-…` | **nema** polje `sourceCommandId` |
| gde stoji | van turn-a (`turn: null`) | unutar turn-a, između `step/end` i `step/start` |
| posle | `command/done` („Compacted N history items (~M tokens)") | ništa u UI-ju |
| server log | — | `compaction (step pressure): shadowed N surface nodes …` |

## Config: menja se na **deklaraciji preseta**, ne na host redu

`compaction-basic` **ne postoji kao aktivan host red** — `dsh-web-app` ga
isključuje (`disabled: true`) jer compaction živi u realm-u agent preseta.
Aktivne kopije su u deklaracijama `preset-standard`, `preset-ptc`,
`preset-cordis`.

- Patch sa `id` menja red, ali **`config` se zamenjuje u celosti** — nikad se ne
  spaja dubinski. Zato override preseta mora da ponovi ceo `config.plugins`.
- To se **ne piše rukom**: `~/dsh/preset-compaction-sync.py` prepisuje
  deklaracije iz instaliranog `dsh-web-app/presets/*.patch.yml` i ubacuje
  `auto: false` (+ `thresholdRatio: 0.6`). Blok stoji između markera
  `# >>> preset-compaction` u `~/.dsh/profiles/web/cordis.patch.yml`.
- Launcher (`~/.local/bin/dsh-termux`) ga zove pri **svakom** startu (kao gemini
  katalog), pa posle `npm install -g @deepseek-ai/dsh` sam uđe u sync.
- **Izmene patcha važe od sledećeg starta** → posle sync-a `restart-dsh`.
  Klijentski deo (guard, prag) traži **hard refresh**.

### Ako se auto ikada vrati: efektivni prag nije `window × ratio`

```
threshold = min(window × ratio, window − maxTokens − headroomTokens)
```

- `headroomTokens` default **65.536**; `maxTokens` iz request headera
  (deepseek-flash 256.000, gemini 32.768).
- Default `thresholdRatio` = **0.8** → deepseek-flash: `min(800.000, 678.464)` =
  **678.464 ≈ 68%** prozora — **ne čeka 90%**.
- Naš zapisani `thresholdRatio` = **0.6** → deepseek **600.000** (60,0%), gemini
  **629.145** (60,0%); sa `auto: false` to ništa ne okida, tu je samo da prag bude
  tačan ako se auto ponovo uključi.
- `retainRatio`/`retainTokens` važe **samo za automatski put**. Ručni `/compact`
  ide preko `compactNow`, koji interno traži `retainTokens: 0` — dakle **reže
  najviše što može** (u jednoj merenoj sesiji: 339 stavki / ~160k tokena, pa je
  sledeći zahtev bio 2,5k). Zato je guard i koristan: trenutak biraš ti, ali rez
  je agresivan.

## Kako se proverava

```bash
node ~/dsh/tests/test-composer-extras-context-guard.mjs   # 73 provere
node ~/dsh/tests/test-preset-compaction.mjs               # 16 provera
```
