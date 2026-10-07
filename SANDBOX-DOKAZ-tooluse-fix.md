# Sandbox dokaz: Gemini→DeepSeek `tool_use` fix radi (0.2.0-rc.2)

Datum: 2026-09-30. **Živa instalacija (0.1.7-rc.2, port 3081) nije dirana** —
provereno hash-evima i verziom na kraju (sekcija 6).

## 1. Uzrok je dokazan protiv živog API-ja (minimalni A/B)

`ab-test.mjs` — 4 sićušna zahteva na `https://api.deepseek.com/anthropic/v1/messages`
(model `deepseek-flash`, isti tool_use/tool_result par, menja se samo oblik assistant poruke):

| assistant content | rezultat |
|---|---|
| `[tool_use, text("")]`  ← Gemini (pi-ai) upisuje ovako | **HTTP 400** `messages.1.1: tool_use ids were found without tool_result blocks immediately after: call_1` |
| `[tool_use]`            ← oblik posle fixa | **HTTP 200** |
| `[text(""), tool_use]`  ← DeepSeek-ov sopstveni oblik | **HTTP 200** |
| `[tool_use, text("hi")]` | **HTTP 400** |

Dakle: DeepSeek servira `tool_use` samo dok su ti blokovi **poslednji** u assistant
poruci. Bilo kakav tekst iza njih (i prazan) ruši ceo zahtev.

## 2. Sandbox instalacija novog dsh (po uputstvu iz arhive)

`~/dsh/dsh-update.sh --no-swap` (sandbox, bez zamene) **pada**, i to iz dva razloga:

1. **`--prefer-offline` + bajat npm keš** → lažni `ETARGET`
   (`No matching version found for @deepseek-ai/dsh-acp-app@0.2.0-rc.2`, pa isto za
   `dsh-agent-instructions`). Ti paketi **postoje** na npm-u; svež `npm view` ih vidi.
2. **`koffi` native build na Bionicu** (kada se keš osveži, stigne se do ovoga):
   `cnoke` prevodi iz izvora i pada:
   `base.cc:2967: error: cannot initialize a member subobject of type '__u32' with an lvalue of type 'const char *'`
   (`statx` u Bionicu je makro/DB, ne funkcija sa tim potpisom). Bez `--ignore-scripts`
   `npm install` puca i **ništa se ne instalira**.

   > ⚠️ **Ispravka (2026-10-06):** ovde je prvobitno pisalo da `koffi@3.3.2` nema
   > android prebuild. **Netačno** — prebuild (`@koromix/koffi-android-arm64`)
   > postoji od `3.2.1`, i `3.3.2` ga ima. Problem je `koffi@3.1.1`, koji
   > `dsh-fs-local@0.2.x` pinuje **tačno**; `3.1.1` i `3.2.0` nemaju android
   > granu. Isto tako, živa 0.1.7-rc.2 **ima** `koffi` sa `.node` binarkom
   > (`node_modules/@koromix/koffi-android-arm64/android_arm64/koffi.node`, koffi
   > 3.3.2). Detalji i trajno rešenje: `SANDBOX-DOKAZ-0.2.0-rc.2.md`.

Sa te dve korekcije sandbox je prošao ceo put:

```bash
SB="$HOME/.dsh/tmp/dsh-test-sandbox"
npm install --global --prefix "$SB" --no-audit --no-fund --prefer-online --ignore-scripts \
    @deepseek-ai/dsh@0.2.0-rc.2          # 530 paketa, ~2 min
python3 ~/dsh/patch-android-dsh.py --root "$SB/lib/node_modules/@deepseek-ai/dsh" --pwa-samesite
```

> ℹ️ Ova „ručna" varijanta (`--ignore-scripts` bez ičega dalje) ostavlja `koffi`
> bez binarke i `node-pty` bez `pty.node`. `dsh-update.sh` od 2026-10-06 radi
> isto **plus** fazu 4b (koffi → 3.3.2) i 4c (`npm rebuild`), pa oba native
> modula budu ispravna; faza 6 ih i proverava.

Zakrpe na sandbox drvo: hardlink, dir-fsync, **ripgrep shim**, **cache-slot (3b)**,
**flock mock**, **require-builtin JS fallback**, PWA SameSite — sve `[ok]`, i `--check`
potvrđuje. Probe: `flock mock OK`, `ripgrep 15.2.0`, `no-hardlink OK`, `npm ls` čist.

## 3. Boot (izolovan `DSH_HOME`, slobodan port) — PRE i POSLE fixa

```
./sandbox-boot-test.sh 3089   -> [ok] BOOT OK — HTTP 401 posle 9s   (0.2.0-rc.2 bez fixa)
python3 patch-tooluse-order.py --root "$SB/lib/.../dsh"      -> [ok] zakrpa primenjena
node --check <adapter>/lib/index.js                          -> syntax OK
./sandbox-boot-test.sh 3090   -> [ok] BOOT OK — HTTP 401 posle 9s   (0.2.0-rc.2 + fix)
```

## 4. Nova sesija + tool poziv (headless, stvarni DeepSeek)

```bash
DSH_HOME=$SB/test-home DSH_PERMISSION_MODE=danger-full-access \
  node --expose-internals --max-old-space-size=2048 --require $SB/no-hardlink.cjs \
  $SB/lib/node_modules/@deepseek-ai/dsh/lib/bin.js headless --json \
  "Koristi bash alat da pokrenes tacno: echo SANDBOX_TOOL_OK ..."
```
Rezultat: `tool_call` bash → `tool_result` `SANDBOX_TOOL_OK` → `turn_end completed`,
odgovor „Izlaz komande je bio: `SANDBOX_TOOL_OK`“.
Neiskorišćeni tokeni: stop 1 `inputTokens 5115`, stop 2 `cacheReadTokens 5376` (keš radi).

## 5. Otrovana sesija `5a658786` — pre i posle, na PRAVOM telu zahteva

`replay-real.mjs` foldira **stvarnu** sesiju adapterom iz sandboxa i šalje telo (96 KB,
20 poruka) na živi DeepSeek API:

| varijanta | tool_use poruke | ishod |
|---|---|---|
| 0.2.0-rc.2 **bez** fixa (shadow kopija) | `tool_use + text` | **HTTP 400** `messages.3.1: ... call_75173` (identično produkcijskoj grešci) |
| 0.2.0-rc.2 **sa** fixom | `tool_use` | **HTTP 200 PRIHVAĆEN** |

I onda pravi end-to-end nastavak u sandboxu:

```bash
cd /data/data/com.termux/files/home/dsh        # sesijin workspace
DSH_HOME=$SB/test-home ... bin.js headless --json \
  --session-id session-5a658786-9b6d-402b-91f6-4ba973aec19a "…"
```
→ `turn 6: turn_end completed`, `inputTokens 32415`, `cacheReadTokens 1280`,
odgovor: „Da — vidim celu istoriju ove sesije (prethodne Gemini poruke, prelaz na
deepseek-flash i grešku sa `tool_use` blokovima)…“

(Napomena: da bi one-shot runner uopšte adoptirao sesiju, u **kopiji** je iz headera
uklonjen `agentPreset:"standard"` — runner odbija sesije sa presetom; u Web UI-ju to
nije potrebno.)

## 6. Živa instalacija — dokaz da je netaknuta

| provera | rezultat |
|---|---|
| verzija | `0.1.7-rc.2` (nepromenjena) |
| sha256 (bin.js, agent-loop, llm-deepseek, flock, ripgrep) | sva 5 **identična** kao pre testa |
| `patch-android-dsh.py --check` (živo) | prolazi |
| server | `HTTP 401` na 3081, PID 8543 (isti proces) |
| živa sesija `5a658786` | 105 događaja, turnovi 1–5, fajl nepromenjen (71 935 B, 23:13) |
| lock / zaostali procesi | nema |

## 7. Bezbednost fixa za keš

Fix je **no-op** za DeepSeek-om sopstvene poruke (`[reasoning, text, tool_use]`).
Dokaz: nova DeepSeek-only sesija iz sandboxa foldirana **pre** i **posle** fixa daje
**bajt-identično** telo (4 176 B oba). Prefiks-keš postojećih DeepSeek istorija se ne menja.

## 8. Fajlovi

| fajl | čemu služi |
|---|---|
| `~/sesslog/patch-tooluse-order.py` | zakrpa (`--root`, `--check`, `--revert`; pravi `.bak`) |
| `~/sesslog/ab-test.mjs` | minimalni A/B protiv živog API-ja |
| `~/sesslog/replay-real.mjs` | replay stvarne sesije na živi API |
| `~/sesslog/fold.mjs` | fold bilo kog loga kroz `serialize()` (`DSH_BUNDLE`, `DSH_DUMP`) |
| `~/sesslog/sandbox-boot-test.sh` | boot sandboxa na izolovanom home/portu |
| `~/sesslog/scan_sessions.py`, `shapes.py` | skener svih sesija (korelacija) |
| `~/dsh/DIJAGNOZA-gemini-deepseek-tool-use.md` | dijagnoza (uzrok + dokazi) |

Sandbox: `~/.dsh/tmp/dsh-test-sandbox` (303 MB) — može se obrisati kad zatreba.
