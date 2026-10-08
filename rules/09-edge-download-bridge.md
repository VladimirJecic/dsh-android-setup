# 09. Edge → Download bridge (Shizuku)

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md). Skripta:
> `~/dsh/edge-download-bridge.sh`, komanda `edge-bridge` (symlink u `~/bin/`).

## Problem

- **Edge za Android (Chromium) ne piše u javni `Download`.** Sve ide u
  `/storage/emulated/0/Android/data/com.microsoft.emmx/files/Download`, sa
  imenom oblika `2026_10_08_<originalni naziv>`.
- **Edge nema podešavanje za download folder** (potvrđeno na Microsoft Q&A) —
  ne postoji način da se to promeni iz same aplikacije.
- **Termux bez root-a ne vidi `Android/data`** (scoped storage, Android 11+):
  `ls /storage/emulated/0/Android/data/…` → `Permission denied`.

Zato je jedini put do tih fajlova **Shizuku** (uid=shell).

## Rešenje

`~/dsh/edge-download-bridge.sh` preko `~/rish` pročita Edge fasciklu, prebaci
sve u `/storage/emulated/0/Download`, pokrene `termux-media-scan` (da se odmah
vidi u Files/Downloads) i pošalje notifikaciju.

```bash
edge-bridge              # jedan prolaz
edge-bridge --watch 60   # petlja (60s)
edge-bridge --status     # stanje: Shizuku, Edge fascikla, watcher, log
edge-bridge --stop       # zaustavi petlju
```

- Log: `~/.edge-bridge.log` · PID: `~/.edge-bridge.pid`
- Ime u koliziji: `naziv (1).pdf`, `naziv (2).pdf` … (ništa se ne prepisuje)

## Trajnost — odluka

Trajno (preživi reboot): skripta, `~/bin/edge-bridge`, hook u `~/.bashrc`
(auto-start watchera, idempotentan preko PID fajla) i **JobScheduler posao
`4242`** (`persisted=true`, svakih 15 min) — dokazano da se izvršava i bez
otvorenog Termuxa.

**Ali sve to zavisi od Shizuku servera.** Bez root-a se Shizuku **ne diže sam
posle reboota** — pokreće se ručno (`Start via Wireless debugging` + pairing
kod). Dok je ugašen, bridge samo zapiše `SKIP` i ne dira ništa; čim se pokrene,
**prvi ciklus prebaci sve nagomilano** (skripta ne gleda „novo", nego celo
stanje fascikle), pa se ništa ne gubi.

Ako bi Termux ikad dobio pristup `Android/data` (root, drugi ROM), bridge radi
i bez Shizuku-a — zavisnost je samo posledica scoped storage-a.

## Zamke (dokazano na ovom telefonu)

- **`rish` ne propagira exit kod** (uvek 0) i izlaz ume da završi na `stderr` →
  u skripti se koristi sentinel `__OK__` + `2>&1`, nikad `$?`.
- **`rish` čita stdin** → obavezno `</dev/null`, inače „pojede" ostatak
  `while read` petlje (drugi fajl se nikad ne obradi).
- **Ne diraj Edge fasciklu** (brisanje/symlink): Edge tamo piše običnim file
  I/O-om; `Download` u `Android/data` se ne sme zameniti symlinkom na javni
  `Download` (FUSE/symlink + scoped storage → download bi pukao).

## Pakovanje u arhivu

Skripta živi u `~/dsh/` i navedena je na **sva tri** spiska: `SCRIPTS`
(`make-restore-archive.sh`), `DSH_FILES` (`restore.sh`) i `FILES`
(`restore-patches.sh`). `restore.sh` posle vraćanja pravi i symlink
`~/bin/edge-bridge`, hook u `~/.bashrc` i JobScheduler posao.
