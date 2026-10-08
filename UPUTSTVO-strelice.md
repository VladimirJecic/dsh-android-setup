# Uputstvo: strelice ▲▼ kroz MOJE poruke (`dsh-chat-jump-arrows`)

Plugin: `~/dsh/dsh-chat-jump-arrows` (`client.js` + `index.js` + `cordis.patch.yml`).
Ništa se ne patchuje u dsh-u — plugin se kači na zvanični `shell.overlay` seat
(frame-wide lebdeći sloj), pa ga `npm install -g @deepseek-ai/dsh@latest` ne dira.

## Zašto postoji

Na telefonu jedan odgovor agenta ume da bude hiljade piksela „procesa", a tvoje
pitanje ostane visoko iznad ekrana. Dsh-ov ugrađeni turn rail šeta TURN-ove (ne
pitanja) i **sakriven je na uskim ekranima**, a ugrađeno „to bottom" dugme je
samo jednosmerno. Ovo su dve strelice koje šetaju tačno tvoje poruke.

## Kako se koristi

Strelice stoje **uz desnu ivicu razgovora, po sredini visine** (ne uz ivicu
ekrana — ako je sidebar otvoren, drže se ivice chata).

| Element | Šta radi |
|---|---|
| **▲** | prethodna **moja** poruka (`user`, i `steering` = ono što sam poslao dok je agent radio). Sleti 12px pod vrh ekrana. |
| **▼** | sledeća moja poruka; kad sam na poslednjoj, odlazi na **dno** razgovora (i time se dsh-ov „follow tail" sam ponovo uključi). |
| **`n/m`** | badge između strelica: koja sam od koliko svojih poruka trenutno gledam. `0/3` = iznad svih svojih poruka. |

Ponašanje:

- Strelice se **vide čim je poslata bar jedna moja poruka** u tom razgovoru; u
  praznoj sesiji ih nema.
- Usklađena strelica je **siva (isključena)**: ▲ na prvoj mojoj poruci, ▼ na dnu.
- Ponovljeni klik na ▲ ide redom nagore (poslednja → pretposlednja → … → prva).
- Ako dsh učita stariju istoriju i pomeri sadržaj posle sletanja, plugin
  **jednom ispravi** poziciju — ali samo dok se skrol smiri i samo ako nisi
  dirao ekran; svaki tvoj gest otkazuje ispravku.
- U pogledima bez chat transkripta (npr. Trajectory) strelica nema.
- **Dok je otvoren picker / dijalog / meni, strelica nema uopšte** (od
  2026-10-08). Sloj strelica stoji iznad composera, pa bi inače lebdele preko
  „Dodaj u kontekst" pickera i kradle dodire — 🗑️ se teško klikne, a prevlačenje
  preko kartice skroluje transkript iza nje. Čim se picker zatvori, strelice se
  vraćaju na isto mesto sa istim `n/m`.

## Ako se ne pojave

1. Posle svake izmene klijentskog bundla treba **hard refresh** (dsh ne
   hot-reload-uje klijentske bundlove).
2. Nova plugina traži **restart**: `/restart-dsh` iz „+" menija (ili skill).
3. Provera da je dsh živ: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3081`.
4. Ako ih nema samo dok je nešto otvoreno — to je namerno (vidi gore).
5. Offline dokaz logike (bez browsera): `node ~/dsh/tests/test-chat-jump-arrows.mjs`
   (53 provere).
