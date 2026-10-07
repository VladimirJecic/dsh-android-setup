# Clear Context u DSH-u

U DSH-u (DeepSeek Harness) ne postoji posebna sistemska skripta pod nazivom "clear-context", već se čišćenje konteksta (istorije poruka u sesiji) obavlja na sledeće načine:

1. **U Web interfejsu (GUI):**
   - Klikom na dugme za novu sesiju (New Session / Reset) unutar panela za sesije.
   - Brisanjem ili resetovanjem trenutnog toka razgovora u GUI-ju, čime se startuje svez kontekst bez prethodnih poruka.

2. **Ručno brisanje privremenih sesija u fajl sistemu:**
   - Sesije se čuvaju na lokaciji: `/storage/emulated/0/Download/dsh-sessions` (ili u `.dsh/_tmp_sess`).
   - Brisanjem foldera ili fajlova specifične sesije unutar tog direktorijuma uklanja se sačuvana istorija konteksta.
