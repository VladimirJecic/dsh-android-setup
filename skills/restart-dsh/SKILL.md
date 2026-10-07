---
name: restart-dsh
description: The single restart-dsh command — kills and relaunches the dsh (DeepSeek Harness) web server on Termux through its real wrapper, so the Android patches are re-applied. Use when the user says /restart-dsh, "restartuj dsh", "restart", "ugasi upali dsh", or wants dsh's web UI/plugins reloaded after an edit. The in-GUI "/restart-dsh" command (dsh-composer-extras) calls this same skill, so there is only one restart implementation.
user-invocable: false
---

# restart-dsh

The one and only dsh restart. Both entry points run the **same script**:

| Odakle | Kako |
|---|---|
| „+" meni u dsh GUI-ju | serverska komanda `/restart-dsh` (dsh-composer-extras plugin) detaširano pozove ovaj skript sa `--delay 2 --quiet` |
| terminal / agent | ovaj skill: `bash ~/.dsh/skills/restart-dsh/restart-dsh.sh` |

> **`user-invocable: false` je namerno.** Skript je i dalje model-invocable
> (agent ga poziva kad korisnik kaže „restartuj dsh"), ali se NE pojavljuje
> kao zaseban `/restart-dsh` u „+" meniju — tamo je samo komanda iz plugina.
> Bez toga bi isti naziv stajao dva puta (Skills + Commands), što je tačno
> ona zabuna koju je korisnik prijavio 2026-10-07 („restart i restart dsh,
> treba nam jedna ne 2 komande").

## Jedini korak

```bash
bash ~/.dsh/skills/restart-dsh/restart-dsh.sh
```

Skript sam radi sve (nikad ne kucaj `pkill`/`nohup` ručno — to je stara,
duplirana logika):

1. `pkill -f 'dsh/lib/bin[.]js'` (pa `-9` ako se ne preda u ~3 s);
2. detaširano podigne `~/.local/bin/dsh-termux` — PRAVI wrapper, jer on pri
   svakom bootu ponovo primenjuje Android zakrpe (hard-link, dir-fsync,
   ripgrep shim, koffi, require-builtin fallback, PWA SameSite). Običan `dsh`
   alias / `/usr/bin/dsh` sve to preskoči;
3. čeka da port 3081 odgovori (200/301/302/401/403 = živ, 000 = mrtav);
4. piše u `~/dsh/restart-dsh.log` + Android notifikaciju;
5. izlazi sa 0 ako je dsh živ, 1 ako nije.

Argumenti: `--delay SEKUNDI` (plugin koristi 2), `--quiet`.

## Posle restarta

1. Ako je menjan klijentski bundle (npr.
   `~/dsh/dsh-composer-extras/client.js`), **hard refresh** u browseru —
   dsh ne hot-reload-uje klijentske bundlove.
2. Ako je browser prikazao „Failed to load plugins", bundle nije umotan u
   `window.__ModuleLoader__.load({id, factory})` — vidi
   `~/dsh/dsh-composer-extras/client.js` za ispravan obrazac (dsh loader
   nije običan ESM).
3. Provera da je dsh živ: `curl -s -o /dev/null -w '%{http_code}\n'
   http://127.0.0.1:3081` (401/403 je takođe u redu — to je auth, ne pad).
4. Reci korisniku da je dsh živ; wrapper pri podizanju ume sam da otvori
   browser tab.
