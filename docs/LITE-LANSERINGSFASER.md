# Gullkornet — gjeldende lanseringsfaser

Oppdatert 15.10.2026, Europe/Oslo. Målet er en kontrollert pilot, deretter dokumentert opptrapping. Dette dokumentet er gjeldende oversikt; eldre sprintnotater er historikk.

## Fase 1 — stabil og kontrollert drift
Ferdig verifisert før denne leveransen: KeeLead-reparasjon er deployet, søk er avgrenset og bruker reelle kilder. Gullkornet har grønn CI og fungerende svarmonitor. Siste godkjente mal er merget i PR #133 som 5ebd63ce08d8d95cb6355757ef25aed90ffdda6b og Railway-deploy 41c6174a-2db1-43b4-ba16-3dd3e4354683 er SUCCESS. En kort 502 under denne utrullingen ble etterfulgt av verifisert helse=true og svarmonitor running uten feil. Ny backend-endring i denne leveransen må bestå egne kontroller før den regnes som deployet.

## Fase 2 — mottakere og godkjent kommunikasjon
Godkjent mal: **2026-10-15.6**, emne **Dette la vi merke til hos dere**. Bruk alltid vi/dere, aldri jeg/du. Siste setning er fjernet etter uttrykkelig instruks. Teksten skal ikke endres igjen uten konkret instruks. Full tekst i LITE-GJELDENDE-EPOSTMAL.md.

Sist fullførte køaudit: 530 Lite Ready, 505 teknisk klare, 25 uten MX, ingen andre køfeil/duplikater. Kjøring 38764033223. Full gjennomgang av dokumentert pool i 38762174476 fant 0 nye blant 8 898 registerenheter og 316 nettsidekandidater. Målet 700 er ikke nådd; det er ikke en forutsetning for pilot på fem. Ny discovery må bruke nye dokumenterbare kandidater, ikke svakere filtre eller den samme poolen på nytt.

## Fase 3 — personvern, informasjon og faktisk lagring (pågår)
Eier har bekreftet avtalene i orden, CIDEA AS som ansvarlig og at ekstern jurist ikke brukes. Vi bruker dokumentert egenvurdering. Frister er interne nødvendighetsbaserte valg: 90 dager for ukontaktede/ubesvarte prospekter, behovsstyrt dialog med periodisk gjennomgang og 30 dager for ferdigbehandlede meldingskopier. Fristvalg er ikke det samme som aktivert automatisk sletting.

Bygget/testet: køens planlegger og eksplisitte skrive-/utførelsessperrer; gammel/tapt dialog får behovsgjennomgang. Produksjonssimulering 38775945217: delete=0, minimize=0, reviewRequired=0. Nytt i denne leveransen: et autentisert, skrivebeskyttet sammendrag av meldingskopier i svarmonitorens faktiske database. Det godtar ikke utførelse og gir bare tellinger. Ingen produksjonsdata skal slettes.

Gjenstår: verifisere sammendraget i produksjon, håndtering av nødvendig original og sperre-/svarbevis før eventuell separat godkjent opprydding, faktisk innboks-/logg-/backupbevaring og korrekt publisering av /personvern. Oppfyllelse av aktuelle informasjons-/markedsføringskrav må vurderes for de konkrete mottakerne og den godkjente teksten. Malgodkjenning er ikke en erklæring om at alle slike krav er oppfylt. Vi endrer ikke e-posten automatisk for å løse dette. Personvernkontakt kan bruke den eksisterende overvåkede postkassen jelassi@cideamarketing.com; dette krever ingen ny DNS eller adresse.

## Fase 4 — kontrollert pilot (ikke startet)
Etter fase 3: velg fem konkrete, ferskt kontrollerte mottakere; kontroller selskap, reell fellesadresse, relevans, kilde, MX, reservasjon, tidligere kontakt, informasjonsgrunnlag, kvote og nøyaktig mal. Kjør forhåndsvisning og batch-svarsjekk. Maks 5/dag og 1/kjøring. Et særskilt uttrykkelig live-klarsignal kreves før noen utsending. Godkjent tekst eller «fortsett» er ikke live-klarsignal. Første utsending skal kontrolleres før flere; stopp ved avvik.

## Fase 5 — opptrapping og salg (ikke startet)
Gjennomgå levering, svar, reservasjoner og eventuelle klager. Følg opp reell interesse og dokumenter tilbud/resultat. Øk først etter kontrollert pilot og egen beslutning, til maksimalt 95/dag innenfor faktisk delt restkvote. 95 x 31 = 2945; bare 55 i reserve per full 31-dagersperiode ved kvote 3000. Ingen oppgradering er nødvendig for denne rammen alene, men annet forbruk kan kreve lavere volum/stopp. Siste forbrukskontroll i denne chatten var 0 sendt samme dag og 214/3000 i perioden; kontroller på nytt før aktivering.

## Faste begrensninger
Ingen live-send, produksjonssletting, nye kostnader, DNS/secrets- eller volumendringer uten særskilt godkjenning. Ikke send nye oppdrag eller meldinger til andre chatter/personer uten eksplisitt instruks. Historisk KeeLead-enrich/research inneholder eksempeldata og er ikke verifisert beslutningsgrunnlag; Lite bruker egne kvalifiseringskontroller.