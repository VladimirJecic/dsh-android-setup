# Clear context u DSH-u (ISPRAVLJENO 2026-09-15)

> Originalna verzija ovog fajla je tvrdila da „ne postoji posebna skripta
> clear-context" i upućivala na brisanje fajlova sesija. To je bilo **netačno**:
> `/clear-context` je registrovan kao prava komanda u `dsh-composer-extras`
> plugin-u i vidi se u composer-ovom „+" meniju.

## Kako stvarno radi

`/clear-context` zove `ctx.compaction.compactNow()` — **isti seam** koji koristi
ugrađeni `/compact` (`dsh-command-compact`).

⚠️ **Nije pravo brisanje na nulu.** DSH u ovoj verziji (0.1.5-rc.1) nema izložen
API za to. `compactNow` interno cilja `retainTokens: 0`, tj. „sažmi koliko možeš
kroz LLM sumarizaciju" — identično ručnom `/compact`. Zato su i ime i opis u
meniju iskreni o tome.

Radi **samo ako je `compaction-basic` uključen** u profilu. U web profilu je
`dsh-web-app` bundle po defaultu isključuje, ali je ovde uključen preko
`cordis.patch.yml`/dump-config-a (`compaction-basic` je u listi aktivnih čvorova).

## Ostali načini (kad treba baš prazan kontekst)

1. **Nova sesija** — dugme u panelu sesija. Ovo je jedini pravi „od nule".
2. **Ugrađeni `/compact`** — isti efekat kao `/clear-context`.
3. **Ručno brisanje sesija sa diska** — `~/.dsh/sessions/`. Pažnja: to briše
   istoriju trajno i ne utiče na već otvorenu sesiju u UI-ju.

## Gde se vidi

Composer → „+" meni → `/clear-context` (pored ugrađenog `/compact`).

## Ako komanda ne radi

Proveri da je plugin živ:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3081/composer-extras/api/debug-provider-check?provider=google&model=gemini-flash-latest'
# 200 = plugin je montiran (ruta postoji)
```

Ako je 404, plugin nije učitan — proveri `~/.dsh/profiles/web/package.json`
(`dsh.profile.bundles` mora sadržati `dsh-composer-extras`) i restartuj dsh.
