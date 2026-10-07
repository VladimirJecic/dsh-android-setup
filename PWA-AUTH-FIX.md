# Zašto „DSH 手机版" (PWA) traži autentikaciju — dijagnoza

**Datum:** 2026-09-15 · **Živi dsh:** PID 28847 (port 3081), **nije gašen**

## Simptom

U Chrome-u radi, u aplikaciji (WebAPK „DSH 手机版") ne:

```
dsh web authentication required; reopen the URL printed by dsh web.
```

## Kako auth stvarno radi (iz `dsh-client-connection`)

| Deo | Gde živi | Životni vek |
|---|---|---|
| **launch token** | `randomBytes()`, samo u memoriji procesa (`PROCESS_LAUNCH_TOKENS`) | **jedan proces** |
| **cookie** | potpisan HMAC-om, `cookieName(authority)` | **30 dana** (`cookieMaxAgeDays`, default 30) |
| **signing secret** | `~/.dsh/.credentials.yaml` → record `client-connection/browser-session` | **trajan** |

Tok: otvaranje `/?token=<launch token>` → server mintuje cookie (303 + `set-cookie`)
→ dalje sve ide preko cookie-ja. Bez cookie-ja: 401 sa tom porukom.

## Uzrok

**`~/.dsh` je recreate-ovan pri instalaciji nove verzije.** Svi fajlovi nose
istu vremensku oznaku:

```
~/.dsh/skills           23:37
~/.dsh/.anonymous-user-id 23:38
~/.dsh/settings.yaml    23:39
~/.dsh/.credentials.yaml 23:40   <- novi signing secret
```

Novi secret → **svaki cookie potpisan starim je nevažeći** → WebAPK, koji je još
držao stari cookie, dobija 401. Chrome radi jer je posle toga otvoren tokenizovani
URL i tamo je mintovan svež cookie.

## Ovo NIJE od hot-load-a

Dokazi:
- `.credentials.yaml` mtime **23:40** — pre moje sesije (radila je 00:22–00:35);
  da je hot-load rotirao secret, mtime bi bio kasniji.
- Proces **nije restartovan**: isti PID 28847, `ELAPSED` ~21 min (start ~00:14).
- Hot-load je ionako **odradio automatski rollback** i nije se montirao.

## Fix

1. **Bez restarta:** force-stop aplikacije (Android → Apps → „DSH 手机版" → Force stop),
   pa je otvori. Ako Chrome i WebAPK dele cookie jar (normalno dele), radiće.
2. **Ako i dalje traži auth:** otvori tokenizovani URL tako da sleti **u aplikaciju**
   (share / long-press → „Open in app"), ne u Chrome.
3. **Ako je URL izgubljen** (token je per-proces i ispisuje se samo na stdout):
   pokreni `~/dsh/dsh-url.sh` — restartuje dsh i ispiše svež URL.

## Zašto se ovo neće ponavljati

Cookie traje 30 dana, a secret je trajan — **preživljava restarte dsh-a**. Puklo je
samo zato što je `$DSH_HOME` bio recreate-ovan. Sledeći put se to dešava samo ako se
`~/.dsh` opet obriše/recreira.

⚠️ **Paznja za budući `patch-android-dsh.py`:** on po uputstvu „migrira" ključeve iz
`.credentials.yaml` u `~/.config/dsh-secrets.env` i ostavlja fajl „prazan". Ako pri
tome pregazi i record `client-connection/browser-session`, **rotiraće signing secret**
i ponovo oboriti PWA. Migracija mora da sačuva taj record.
