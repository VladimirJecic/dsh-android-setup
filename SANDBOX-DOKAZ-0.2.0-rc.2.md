# Sandbox dokaz: dsh 0.2.0-rc.2 (major skok 0.1.7-rc.2 → 0.2.0-rc.2)

Datum: 2026-10-06. Sve ispod je izvršeno u **sandboxu**
(`$TMPDIR/dsh-update-sandbox`, `--no-swap`); živa instalacija na portu 3081 **nije
dirana** do faze 7 (vidi sekciju 7).

Node `v26.4.0`, npm `11.19.1`, `process.platform=android`, `process.arch=arm64`.

## 1. Uzrok: `koffi@3.1.1` nema android prebuild i ne može da se kompajlira

`npm install` za 0.2.0-rc.2 puca **pre nego što se ijedan paket instalira**:

```
npm error path .../dsh/node_modules/koffi
npm error command sh -c node ./cnoke.cjs -P . -D src/koffi --prebuild --release
npm error Failed to load prebuilt binary, rebuilding from source
npm error base.cc:2967:19: error: cannot initialize a member subobject of type '__u32'
                                with an lvalue of type 'const char *'
npm error  2967 |     if (statx(fd, pathname, stat_flags, stat_mask, &sxb) < 0) {
```

Lanac je:

| korak | činjenica |
|---|---|
| `dsh-fs-local@0.2.0-rc.2` | pinuje **tačno** `koffi: 3.1.1` (0.1.7-rc.2 je imao `^3.1.0`, pa se sam rešio na 3.3.2) |
| `koffi@3.1.1` | `optionalDependencies` **ne sadrže** `@koromix/koffi-android-arm64` — android grana postoji tek od **3.2.1** |
| posledica | `cnoke --prebuild` ne nađe prebuilt → `node-gyp`/CMake build iz izvora → `statx` u Bionicu nije funkcija sa glibc potpisom → build pada → ceo `npm install` pada |

Provereno na npm-u: `@koromix/koffi-android-arm64` postoji za `3.2.1`, `3.3.0`,
`3.3.1`, `3.3.2`; **ne** postoji za `3.1.1` i `3.2.0`. Isto pinovanje ima i
`0.2.1-alpha.1`, pa zamka ostaje i za sledeće izdanje.

> ⚠️ `npm install --global --prefix <dir>` **ignoriše** `overrides` iz
> `<dir>/package.json` (provereno: `koffi` ostane 3.1.1). `overrides` radi samo u
> pravom *project* instaliranju, koje pak hoistuje zavisnosti van `dsh/node_modules`
> — a to razbija atomsku zamenu. Zato se koffi rešava zamenom paketa (faza 4b),
> a ne `overrides`-om.

Sve koffi upotrebe u 0.2.0-rc.2 su **lazy i win32-only** (`advapi32.dll`,
`kernel32.dll`, `user32.dll`): `dsh-fs-local`, `dsh-session-persistence-jsonl`,
`dsh-subprocess-local`, `dsh-win32-process`, `dsh-sandbox-windows-acl`,
`dsh-host-directory-picker-native`. Na Androidu se koffi **ne učitava**, ali npm
ipak mora da prođe njegov *install script* — zato zamena, a ne brisanje.

## 2. Rešenje (ugrađeno u `~/dsh/dsh-update.sh`, faze 4 / 4b / 4c)

```bash
# 4) instalacija BEZ install skripti (inače koffi obori ceo install)
npm install --global --prefix "$SANDBOX" --ignore-scripts --prefer-online \
    @deepseek-ai/dsh@0.2.0-rc.2                    # 530 paketa, ~50 s

# 4b) koffi 3.1.1 nema android prebuild -> zameni ga verzijom koja ima
npm install --prefix "$SANDBOX/koffi-src" --ignore-scripts koffi@3.3.2
cp -a .../koffi                       "$SB_DIR/node_modules/koffi"
cp -a .../@koromix/koffi-android-arm64 "$SB_DIR/node_modules/@koromix/"

# 4c) tek sada install/postinstall skripte nad VEĆ razrešenim drvetom
npm rebuild --global --prefix "$SANDBOX"           # node-pty node-gyp build itd.
```

`--prefer-online` je obavezan: sa bajatim npm kešom `--prefer-offline` ume da
prijavi **lažni `ETARGET`** za pakete koji na npm-u normalno postoje (zabeleženo
30.09.2026: `@deepseek-ai/dsh-acp-app@0.2.0-rc.2`, `dsh-agent-instructions`).

Bez 4c `node-pty` ostane bez `build/Release/pty.node` (nema android prebuild u
`prebuilds/`, samo darwin/linux/win32) — dsh se **digao** u ranijem testu i bez
toga, ali terminal alati pucaju u radu. Sa 4c: `pty.node` 64 472 B, `require("node-pty")` ok.

## 3. Zakrpe: svi ciljevi i dalje postoje u 0.2.0-rc.2

`python3 ~/dsh/patch-android-dsh.py --root "$SB_DIR" --pwa-samesite` prolazi
**bez izmena patchera** — nijedno paket-ime se nije promenilo:

| zakrpa | ishod u sandboxu |
|---|---|
| 1 hardlink (`dsh-attachment-local`, `dsh-session-persistence-jsonl`, `dsh-fs-local`) | `[ok]` |
| 2 dir-fsync (`dsh-attachment-local`) | `[ok]` |
| 3 ripgrep shim (`@vscode/ripgrep-android-arm64`) | `[ok]` |
| 3b cache-slot (`dsh-agent-loop`) | `[ok]` |
| 3c flock mock (`node-addon-system`) | `[ok]` |
| 3d PWA SameSite (opt-in) | `[ok]` |
| 3e require-builtin JS fallback | `[ok]` |
| 3f tool_use redosled (`dsh-llm`, `dsh-llm-deepseek`) | `[ok]` |

## 4. Validacija (`~/dsh/dsh-update.sh --version 0.2.0-rc.2 --no-swap`)

```
flock mock: tryLockExclusive(0) -> resolve OK
ripgrep: /data/data/com.termux/files/usr/bin/rg | ripgrep 15.2.0
koffi: ok (.../dsh/node_modules/koffi/index.cjs)
node-pty: ok (.../dsh/node_modules/node-pty/lib/index.js)
npm ls: ok
smoke test OK (HTTP 401 na portu 3089)
```

Nove probe (`koffi`, `node-pty`) su dodate u fazu 6 — bez njih bi „uspešan"
update mogao da ostavi nedirnut `pty.node`.

## 5. Lokalni plugin `dsh-composer-extras` — radi i na 0.2.0-rc.2

Boot sandboxa sa **pravim** web profilom (bundles uključuju `dsh-composer-extras`,
link `~/.dsh/profiles/web/node_modules/dsh-composer-extras`):

| provera | rezultat |
|---|---|
| boot | HTTP 401 posle 9 s, `boot.log` bez ijedne greške/warning-a |
| server half plugina | `POST /composer-extras/api/fs-tree-workspace` → **HTTP 400** (ruta postoji; 404 bi značio da plugin nije aktivan) |
| client boot graf | `GET /?token=…` → HTTP 200, `{"id":"dsh-composer-extras","url":"plugins/??dsh-composer-extras/client.js&rev=3681b058e0cf",…}` |
| client bundle | `GET /plugins/??dsh-composer-extras/client.js&rev=…` → **HTTP 200, 95 473 B** |
| markeri u bundle-u | `conversation.input.left` ×11, `sidebar.right.tab.document.actions` ×2, `android-share` ×2, `delete-paths` ×1 |
| slotovi u 0.2.0 | `conversation.input.left` (`dsh-client-ui-conversation`), `sidebar.right.tab.document.actions` (`dsh-client-ui-sidebar-documentpreview`) — oba i dalje postoje |

Zamka koju **ne** treba popravljati: `dsh.client.inject` u pluginovom
`package.json` pominje `@deepseek-ai/dsh-client-runtime`, a taj paket u 0.2.0
**više ne postoji**. To je bezopasno — `dsh-client-modules/lib/client.js` radi
`const dependency = this.graphRows.get(packageName); if (dependency !== void 0) …`,
pa se nepostojeći id tiho preskoči (isti kod postoji i u 0.1.7), a `client.js`
plugina ionako traži samo `require("react")`.

## 6. End-to-end: pravi agent + bash alat (headless, stvarni API)

```bash
DSH_HOME=<sandbox>/headless-home DSH_PERMISSION_MODE=danger-full-access \
  node --expose-internals --max-old-space-size=2048 --require <sb>/no-hardlink.cjs \
  <sb>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js headless --json \
  "Koristi bash alat da pokrenes tacno: echo SANDBOX_020_OK. Zatim mi kazi samo taj izlaz."
```

```
{"type":"tool_call","callId":"call_74718","tool":"bash","input":{"command":"echo SANDBOX_020_OK"}}
{"type":"tool_result","callId":"call_74718","status":"completed","result":"SANDBOX_020_OK\n"}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
{"type":"final","text":"SANDBOX_020_OK"}
```

Model: `google/gemini-flash-lite-latest` iz živog `cordis.patch.yml` (patch se
primenjuje i na 0.2.0 — `llm-pi-ai`, `ui-settings-general`,
`agent-default-model` čvorovi i dalje postoje). `stderr` prazan, `rc=0`.

## 7. Atomska zamena

`~/dsh/dsh-update.sh --version 0.2.0-rc.2` (bez `--no-swap`) posle svih gore
navedenih provera. Backup ostaje u `<global-root>/.dsh-backup-0.1.7-rc.2-<ts>`,
pointer u `<global-root>/.dsh-backup-latest`; `--rollback` vraća 0.1.7-rc.2.
Nova verzija se aktivira **tek posle restarta** dsh-a (živi proces drži staru).

### 7b. Odloženi restart (`~/dsh/.restart-after-update.sh`)

Pošto restart ubija proces u kome živi tekuća agentska sesija, aktivacija se radi
**detaširano**:

```bash
setsid nohup env IDLE=120 bash ~/dsh/.restart-after-update.sh >/dev/null 2>&1 &
```

1. čeka `IDLE` (default 120 s) mira u `~/.dsh/sessions/**` — ako korisnik piše,
   čeka dalje, najduže `MAX_WAIT` (default 2 h; tada odustaje i javlja
   notifikacijom);
2. `pkill -f 'dsh/lib/bin[.]js'` → `nohup ~/.local/bin/dsh-termux` (pravi
   launcher: ponovo primeni zakrpe i Gemini katalog);
3. čeka HTTP 200/301/302/401/403 do 90 s;
4. ako se **nije** digao → `~/dsh/dsh-update.sh --rollback` + ponovno dizanje;
5. sve u `~/dsh/restart-after-update.log` + `termux-notification`;
6. `DRY=1` samo prijavi šta bi uradio (provera detekcije mirovanja).

Izvršeno 2026-10-06: mirno u 20:38:27 → restart → `OK: HTTP 401 (PID=13152)` u
20:40:25. Dokaz da **živ** proces služi 0.2.0: `GET /` na 3081 sadrži module koji
postoje samo u 0.2.0 (`@deepseek-ai/dsh-client-ui-cordis`,
`@deepseek-ai/dsh-client-ui-agent-preset`), `dsh-composer-extras` je i dalje u
boot grafu, a `POST /composer-extras/api/fs-tree-workspace` → 400 (ruta živa).

> ℹ️ Sesija i token: razgovor se **nastavlja** preko restarta (sesije su na
> disku), a otvoren tab nastavlja da radi preko svog kolačića — zato restart
> izgleda kao da se „ništa nije desilo". Vidljivi tragovi: novi `token=` u
> `~/dsh/dsh-web.log`, novi PID (`pgrep -f 'dsh/lib/bin[.]js'`) i (opciono)
> Android notifikacija.

## 8. Fajlovi

| fajl | čemu služi |
|---|---|
| `~/dsh/dsh-update.sh` | faze 4 / 4b / 4c + probe `koffi`/`node-pty` (faza 6) |
| `~/dsh/.restart-after-update.sh` | odloženi restart + verifikacija + auto-rollback (7b) |
| `~/dsh/patch-android-dsh.py` | nepromenjen — svi ciljevi postoje i u 0.2.0 |
| `~/dsh/update.log` | log ovog i prethodnih update-a |
| `~/dsh/restart-after-update.log` | log odloženog restarta |
| `~/dsh/SANDBOX-DOKAZ-tooluse-fix.md` | prethodni sandbox (tool_use fix); sekcija 2 je ispravljena ovim dokumentom |
