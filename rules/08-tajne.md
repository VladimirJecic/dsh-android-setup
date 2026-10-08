# 08. Tajne i bezbednost

> Deo [`rules/`](README.md) — indeks: [`README.md`](README.md).

## Ključevi

```bash
umask 077
cat > ~/.config/dsh-secrets.env <<'EOF'
export DEEPSEEK_API_KEY='...'
export GOOGLE_API_KEY='...'        # Gemini (😎 smart)
# opciono: GROQ_API_KEY, HF_READ, HF_FULL
EOF
chmod 600 ~/.config/dsh-secrets.env
```

- Ključevi **samo** tu (mode **0600**, van `~/.dsh` i van deljenog storage-a).
- **`~/.dsh/.credentials.yaml` NE sme da nosi API ključeve** — samo record
  `client-connection/browser-session` + `version`. Ako se pregazi, PWA
  „DSH 手机版" prestaje da radi.
- **Tajne nikad u restore arhivu ni na deljeni storage.** `*.env`,
  `dsh-secrets.env`, `sessions/`, `*.log`, `*.bak-*` su u `.gitignore` arhive.
- Pre svakog `git commit`-a u arhivi: `grep -rniE "sk-[a-z0-9]{8,}" .` (bez
  `.git`) — u praksi se pokazalo korisnim i za `.credentials.yaml`.
- Kvota Gemini free tier-a je **per Google Cloud projekat**, ne per ključ — drugi
  ključ na istom projektu ne pomaže ([`02-smart-mode.md`](02-smart-mode.md)).

## Mreža i auth

- Sve `dsh-composer-extras` rute su **loopback-only** (`127.0.0.1`/`localhost`/
  `::1`) — nikad `0.0.0.0`.
- PWA cookie: `SameSite=Lax` (zakrpa `--pwa-samesite`); `Strict` obara PWA auth.
- Ne izlaži port 3081 van telefona; ako treba pristup, koristi `dsh-url.sh`
  (prijavljuje URL + `termux-share`), ne `--host 0.0.0.0`.

## Neželjeni ostaci

- Posle probe **obriši i skriptu i njen log** (npr. `restart-when-idle.sh` +
  `restart-when-idle.log`) — inače se u `~/dsh` nakupi jednokratni materijal.
- **Ne ostavljaj** aktivne `session.lock` fajlove ni zombi procese posle duge
  operacije ([`01-sesije.md`](01-sesije.md)).
