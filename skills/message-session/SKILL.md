---
name: message-session
description: Pošalji poruku DRUGOJ dsh sesiji preko loopback rute — eksplicitno po session ID-ju, uz prikaz identiteta te sesije pre slanja. Koristi se kada korisnik kaže "pošalji poruku sesiji session-…", "obavesti drugu sesiju", "javi drugoj sesiji da i mi radimo na tom fajlu", "prosledi ovo sesiji session-…", ili "/message-session".
---

# message-session — poruka drugoj dsh sesiji

Šalje tekst u **postojeću** dsh sesiju preko `POST
/composer-extras/api/prompt-session` (plugin `dsh-composer-extras`).

## Zašto session ID je OBAVEZAN argument

2026-11-15 je prva poruka poslata tako što je ciljna sesija **pronađena grepom
po logovima** (`grep -c glm ~/.dsh/sessions/...`) — i pogodila je, ali to je
**pogađanje**: da se u međuvremenu jedna sesija završila a druga počela, poruka
bi otišla pogrešnoj. Zato ovde **nema** traženja sesije:

- ID daje korisnik (kopira ga iz GUI-ja / sidebar-a),
- skripta **pre slanja** ispiše ŠTA je u toj sesiji — naslov, cwd, model, broj
  turn-ova, vreme poslednje aktivnosti,
- `--check` prikaže isto to ali **ne pošalje** ništa.

Ako naslov/cwd/model ne odgovaraju onome što korisnik misli da šalje — ID je
promašen i **ne šalji**.

## Koraci (agent)

1. **Uzmi ID iz onoga što je korisnik napisao.** Nikad ga ne izmišljaj i nikad
   ga ne pogađaj grepom po logovima. Ako ga korisnik nije dao, **pitaj** ga
   (jedno pitanje), ne traži sam.
2. **Prvo `--check`** (bezbedno, ništa ne šalje):

   ```bash
   bash ~/.dsh/skills/message-session/message-session.sh <session-id> --check
   ```

   Pročitaj naslov/cwd/model i potvrdi da je to ta sesija.
3. **Sastavi poruku kao SAMOSTALAN tekst.** Druga sesija **ne vidi** ovaj
   razgovor. U poruku ide sve što joj treba:
   - ko je pošiljalac (i koji session ID),
   - šta je zajedničko (npr. „obe menjamo `~/.dsh/profiles/web/cordis.patch.yml`"),
   - koje je trenutno stanje ( konkretne vrednosti, ne „radi kako smo se dogovorili"),
   - šta se traži (eksplicitno),
   - zamke na koje je pošiljalac naišao.
4. **Pošalji** (default je `--steer`):

   ```bash
   bash ~/.dsh/skills/message-session/message-session.sh <session-id> --yes "tekst"
   ```

   `--yes` je obavezan iz agenta: skripta pita potvrdu **samo** kad ima TTY, a
   agent nema.
5. **Proveri da je otišlo** — skripta ispiše `OK poslato session-… (mode=…)`.
   Ako ispiše `FAIL`, javi korisniku grešku verbatim; ne tvrdi da je poslato.

## steer (default) vs queue (`--queue`)

| | šta radi | kada |
|---|---|---|
| **`--steer`** (default) | `agent.steer()` → poruka ulazi u **sledeći korak** tekućeg turna; ako sesija **miruje**, `wakeup=true` otvara **novi** turn odmah | kada druga sesija treba **odmah** da zna („prestani da menjaš taj fajl") |
| `--queue` | `agent.followup()` → obrađuje se **tek posle** celog tekućeg turna | kad poruka sme da čeka („kad završiš, javi mi") |

Oba imaju `wakeup=true`, pa nijedan ne „izvisi" — razlika je samo **kada** se
obrađuje: usred turna (steer) ili na granici turna (queue).

Provereno u `dsh-agent-loop`: `steer(input)` → `send(input, "next-step", true)`,
`followup(input)` → `send(input, "next-turn", true)`, a `wakeDriver()` na
mirnom agentu radi `while (await this.turn())`.

## Šta NE radi

- **Ne restartuje** i ne gasi ništa — samo šalje tekst.
- **Ne čeka** da druga sesija završi: `--steer` ubacuje odmah. Ako korisnik
  želi da se nešto uradi **posle** tog posla, to se kaže **u tekstu poruke**
  („kad završiš ovo, javi mi"), ne čekanjem.
- **Ne garantuje** da je druga sesija pročitala — poruka je prihvaćena
  (`accepted: true`), ne i obrađena.
- Ako je ID **ista** sesija kao pošiljalac, skripta odbija (exit 3); za svesno
  slanje sebi postoji `--force`.

## Greške

| Ispis | znači |
|---|---|
| `session ID mora počinjati sa 'session-'` | ID nije u dobrom obliku |
| `sesija … NE POSTOJI (nema loga …)` | ID je pogrešan ili sesija obrisana — **ne** pogađaj drugi |
| `FAIL: session "…" not found` sa rute | host ne zna tu sesiju (obrisana / drugi profil) |
| `FAIL: … busy` / `agent-busy` | retko; probaj `--queue` |

## Napomena o `mode` na ruti

`/composer-extras/api/prompt-session` prosleđuje `mode` u
`sessionController.prompt`. U dsh-u važi: `mode === "steer"` → `agent.steer()`,
**svaka druga vrednost** → `agent.followup()`. Zato skripta šalje tačno
`steer` ili `queue`.
