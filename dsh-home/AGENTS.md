# Globalne instrukcije

## „uplati" = `uplati` skill

Kada korisnik kaže **„uplati"**, **„uplata"**, „plati", „pošalji pare" ili
`/uplati`, to je poziv na **`uplati` skill** — učitaj ga `skill` alatom pod
imenom `uplati` i radi tačno po njegovim uputstvima. Ne izmišljaj slobodnu
interpretaciju i ne pokušavaj ručno da sastavljaš IPS QR.

- Skill: `~/.dsh/skills/uplati/SKILL.md`
- Skripta: `~/.claude/skills/uplati/uplati.py`
- Šabloni kontakata: `~/.uplati/<slug>.txt` (privatno, mode 0600)
- Generisani QR: `~/.uplati/temp/<slug>.png`

Skill fizički živi u `~/.claude/skills/` (deljen sa Claude Code). DSH ga vidi
preko symlinka u `~/.dsh/skills/`, jer web profil skenira `$DSH_HOME/skills`.
Ako `uplati` nije u katalogu skillova, proveri da symlink postoji:

```bash
ls -la ~/.dsh/skills/
```

Nikad ne izmišljaj broj računa — koristi isključivo broj koji je korisnik dao
ili onaj koji već stoji u šablonu. Uplatu uvek potvrđuje korisnik u aplikaciji
banke; skripta samo pravi QR i otvara share sheet.

## Pravilo za dugotrajne operacije i prekid sesija (>5 minuta)

Ukoliko bilo koje istraživanje, generisanje ili izvršavanje zadatka traje duže od 5 minuta:
1. Agent je dužan da prekine beskonačnu rekurziju ili ponavljanje mrežnih/API poziva (poput transportnih grešaka ili blokiranih *retry* petlji).
2. Potrebno je sačuvati dosadašnji napredak (npr. u JSON ili tekstualne fajlove) i vratiti kontrolu korisniku sa jasnim izveštajem o statusu.
3. Zabranjeno je ostavljati aktivne `session.lock` fajlove ili zombi procese u pozadini koji troše tokene i resurse.
