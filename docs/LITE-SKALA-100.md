# Gullkornet Lite – skalering til 100 per dag (15.10.2026)

Teknisk sprint. **Live-utsending er AV, og ingen e-post er sendt.** Tallene under er målt, ikke anslått, med mindre noe annet står.

## Bransjer (SN2025, AS/ASA i Oslo og Akershus)

| Bransje | NACE | Enheter | Research (gap ≥ 30 %) | Aktivert |
|---|---|---|---|---|
| Frisør | 96.210 | – | ja (fra før) | ja |
| Rørlegger | 43.221 | – | ja (fra før) | ja |
| Elektriker | 43.210 | 738 | 7/23 (30 %) | **ja** |
| Snekker/tømrer | 43.320 | 744 | 7/18 (39 %) | **ja** |
| Bilverksted | 95.310 | 625 | 6/17 (35 %) | **ja** |
| Taktekker | 43.410 | 126 | ja | **ja** |
| Renhold | 81.210 | 531 | 8/20 (40 %) | **ja** |
| Regnskapsbyrå | 69.202 | 926 | ja | **ja** |
| Byggmester | 41.000 | 2 057 | ingen felles gap ≥ 30 % | nei. Malens påstand er ikke dokumentert |
| Maler | 43.340 | 424 | ingen felles gap ≥ 30 % | nei. Samme grunn |

Researchen er AES-kryptert i `research/segments/` og gjelder i 90 dager. Byggmestere og malere ble ikke trukket ut på nytt for å få tallene over terskelen.

## Leadbuffer

| | Antall |
|---|---|
| Brreg-enheter i de 8 dokumenterte segmentene | 5 053 (1 214 med registrert e-post) |
| Kvalifisert før dedupe (lokal tørrkjøring) | 511 |
| **Lite Ready i Airtable nå** | **423** (77 fra før + 326 + 17 + 3 nye) |
| Allerede kjent og hoppet over | ca. 470 rader, i Lite eller den avanserte pipelinen (inkl. tidligere kontaktede) |
| Avvist | navngitt adresse 445, frimail 322, ingen e-post 3 760, domenet stemmer ikke 36 |

Hvert lead er kontrollert for: AS/ASA og aktiv status (Brreg), rolleadresse, at domenet stemmer med nettsiden, at det ikke er frimail, dedupe mot alle Airtable-rader (e-post, domene, org.nr.), og dokumentert segment. MX og fersk Brreg-status kontrolleres på nytt rett før sending.

**700 nås ikke i Oslo og Akershus med disse 8 segmentene.** Markedet er nesten tømt: siste kjøring fant 3 nye. Neste kilde er en ny region (krever research per segment × region) eller nye segmenter.

### Teknisk kvalifisert ≠ lovlig kontaktgrunnlag

At et lead er «Lite Ready», betyr bare at reglene i koden er oppfylt. Om e-post til en felles adresse hos et AS er lovlig uten samtykke (mfl. § 15), er **ikke avklart**. Se [LITE-JURIDISK-BESLUTNINGSPAKKE.md](LITE-JURIDISK-BESLUTNINGSPAKKE.md).

## Automatisk påfylling

- Den planlagte jobben *Gullkornet Lite Lead Intake* kjører kl. 04:40 UTC med `--source auto` (Brreg + nettside). Den fyller opp til `GULLKORNET_LITE_BUFFER_TARGET` (700) og leser alle dokumenterte segmenter fra side 0. Det gamle 3-sidersvinduet ga 0 treff for små segmenter.
- Variablene `GULLKORNET_LITE_INTAKE_ENABLED=true` og `GULLKORNET_LITE_INTAKE_SYNC=true` er **satt 15.10.2026**.
- Verifisert ved 3 manuelle kjøringer av samme kodevei (`source=auto`): +326, +17 og +3. Varighet 4–9 minutter (grensen er 45). Den første planlagte kjøringen er 16.10 kl. 04:40 UTC og er ikke observert ennå.
- Et uttømt segment gir bare 0 nye. De andre fortsetter.

## Kapasitet 100 per dag

| Test | Resultat |
|---|---|
| Simulering (kode): 100 sendinger på én dag fordelt på 10-minutterskjøringer | **Bestått.** 100 sendt, 100 unike bedrifter, 100 unike idempotensnøkler, alle innenfor 08–20 |
| Konfigurasjon 100/dag med dagens Resend-plan | **Feiler med vilje:** 100 × 31 = 3 100 > `RESEND_MONTHLY_QUOTA` 3 000. Maks på dagens plan er **96 per dag** |
| Svaroppslag i batch (produksjon, positiv og negativ kontroll) | **PASS.** Batch og enkeltoppslag gir samme svar |
| Reply Sync ved mange sendte rader | Batcher på 200. Stopper ikke lenger ved 200 rader (før ville den feilet på dag 3) |
| Forhåndsvisning av 100 kandidater (produksjon, main 93530b4, 10:02–10:28 UTC) | **Bestått.** scanned=100, eligible=95, stale=5 (ingen MX), refused=0, replied=0, noResearch=0, **sent=0**. 26 min (grense 45) |
| Idempotens | Raden settes `Sent` før sending, Resend-idempotensnøkkel per rad, og domenet blokkeres (testet) |
| Tidsgrenser | Outreach og Reply Sync 45 min, intake 45 min |

En live-kjøring sender maks `GULLKORNET_LITE_MAX_PER_RUN` (5) per 10 minutter. Med 15 per time og 12 timer i vinduet gir det plass til 100 per dag. Dagens pilotinnstilling er 5 per dag og 1 per kjøring.

## Beslutninger før aktivering (eieren)

1. **Juridisk (blokkerer):** advokatens svar på mfl. § 15 (felles adresse i AS) og ehl. § 9 (emnefeltet). Se beslutningspakken.
2. **Personvernerklæring:** ikke publisert. `cideamarketing.com/personvern` viser forsiden (kontrollert 15.10). Forslaget til ny mal lenker dit.
3. **Mal:** behold 2026-10-14.2, eller godkjenn forslaget 2026-10-14.3 (krever punkt 2).
4. **Resend-plan:** 100 per dag krever en månedskvote på minst 3 100 (oppgradering, kostnad). Ellers maks 96 per dag. Bestem dette og sett `RESEND_MONTHLY_QUOTA` og `GULLKORNET_LITE_DAILY_LIMIT` deretter.
5. **Databehandleravtaler:** bekreft Airtable, Resend og Railway (se LITE-DATABEHANDLERE.md).
6. **Avsender:** cideamarketing.com er verifisert i Resend (eu-west-1). DKIM, SPF (send.) og DMARC p=quarantine er på plass. Ingen endring trengs.
7. Til slutt: `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`, først med pilotgrensene.
