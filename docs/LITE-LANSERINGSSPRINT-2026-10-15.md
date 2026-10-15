# Lanseringssprint 15.10.2026

Live-utsending skal forbli av. Denne sprinten godkjenner ingen utsending, juridisk grunnlag, avtalesignering, sletting, DNS/secrets-endring eller kostnad.

## Personvern og avsender

Kontrollert offentlig nettsted 15.10: `/personvern` returnerer samme HTML og JavaScript som forsiden. Publisert JavaScript har ingen personvernside eller opplysninger om CIDEA AS. Lokal nettstedskilde (`Cidea-Marketing/src/main.jsx`) sender ukjente stier til forsiden. En HTTP 200 er derfor ikke en publisert erklæring.

Brreg bekrefter CIDEA AS, org.nr. 927394391, AS, Gunnar Schjelderups vei 13A, 0485 Oslo, reklamebyråvirksomhet og ikke konkurs/under avvikling. Registrert nettsted er cidea.no; registeret beviser ikke alene forholdet til cideamarketing.com. Resend bekrefter cideamarketing.com som verified, eu-west-1, sending enabled, open/click tracking false. Eier må bekrefte at CIDEA AS er behandlingsansvarlig og avsender bak Cidea Marketing.

Mal `2026-10-14.2` beholdes byte-for-byte. Ingen overgang til forslag `.3`. Jurist må vurdere den faktiske uendrede malen, inkludert emne etter ehandelsloven § 9 og informasjon etter GDPR art. 14, i tillegg til markedsføringsloven § 15.

Publisering er blokkert av innholdskontrollen, ikke av manglende generell publiseringstillatelse. Utkastet lover automatisk sletting/minimering etter 90 dager mens dette ikke er aktivert, har uavklart lagring av innboks/svarmonitor og uverifiserte overføringsgrunnlag. Ikke publiser disse løftene som fakta. Ingen produksjonssletting er gjennomført. Se publiseringskontrollen under.

## DPA: offentlige vilkår kontrollert, kontoavtaler ikke dokumentert

- Airtable: gjeldende offentlige DPA er datert 08.09.2026, ikke datoen i tidligere kartlegging. Den blir bindende når gyldig signert av partene. Eier må fremlegge signert kopi fra riktig juridisk enhet, eller signere via leverandørens skjema.
- Resend: DPA blir bindende ved aksept av hovedavtalen eller separat signering. Signert versjon kan hentes i dashbordet. Kontoens aksept og juridiske enhet er ikke verifisert av domene-/forbruks-API-et. Eier må hente og arkivere kopi.
- Railway: standard DPA fullføres via DocuSign og blir bindende ved Railways signering. Eier må fremlegge ferdig signert kopi og avklare SCC/overføringsgrunnlag. Produksjonens openoutreach-volum er i sfo (USA); lagringstid for e-postkopier må vedtas. Ingen regionflytting utført.

Ingen avtaler er akseptert eller signert i denne sprinten. Ikke sett status til «inngått» uten kontobevis. Migadu og GitHub fra tidligere kartlegging må også følges opp før den offentlige leverandørlisten kan bekreftes.

Kilder kontrollert 15.10.2026:
- https://www.airtable.com/company/dpa (innledning og signeringskrav)
- https://resend.com/legal/dpa (innledning og § 12)
- https://railway.com/legal/dpa (Execution of this DPA)
- https://data.brreg.no/enhetsregisteret/api/enheter/927394391
- https://data.brreg.no/enhetsregisteret/api/kommuner?size=1000

## Geografi og dokumentasjon

Alle kommuner i Østfold (12), Buskerud (18) og Vestfold (6) er lagt til med registerkontrollerte koder. Hvert bransje × region-segment krever egen fersk research: minst 8 lesbare unike nettsteder og minst 30 % med et dokumentert felles gap. Oslo-research gjenbrukes ikke for nye fylker.

24 nye segmenter undersøkt med samme metode og lagret kryptert. Fem støtter malen: rørlegger og elektriker i Østfold og Buskerud, rørlegger i Vestfold. De øvrige 19 forblir sperret. Ingen ekstra utvalg er trukket for å presse et resultat over terskelen. Intake dedupliserer mot alle Airtable-rader på e-post, domene og org.nr., og skriver bare nye Lite Ready-rader.

## Kapasitet uten oppgradering

Resend API 15.10: 0/100 brukt i dag; 214/3000 brukt i perioden; 2786 igjen. Månedlig reset 23.10.2026 kl. 08:51:31 Europe/Oslo. Daglig reset 16.10 kl. 01:59:59 Europe/Oslo (UTC-basert kvote). 95 × 31 = 2945, bare 55 i reserve per full 31-dagersperiode. Kvoten deles med alle kontoens domener, også smartsvar.no. 95 er et maksimum og krever reduksjon/stopp ved annet forbruk; det er ingen garanti om 95 hver dag.

Kode- og workflowstandard er satt til 95. Eksisterende repository-variabler har forrang; pilotgrensene skal kontrolleres separat før aktivering. Eksisterende månedssjekk verifiserer planstørrelsen, men måler ikke faktisk gjenværende månedskvote. Kontroller derfor kontoforbruk før aktivering og løpende i perioden. Ingen oppgradering.

## Kontrollert aktivering: blokkert

Før et særskilt uttrykkelig klarsignal kan gjennomføres:
1. Juridisk beslutning må gjelde den faktiske malen `.2`, adressetypen og de nye regionene/bransjene.
2. Bekreft avsender/behandlingsansvarlig, konto-DPA-er, overføringer og faktiske lagringsrutiner.
3. Publiser og kontroller `/personvern` med ekte sideinnhold og en fungerende kontaktadresse.
4. Kontroller faktisk restkvote, oppdatert read-only audit/preview og batch reply-status. Avklar at andre avsendere ikke bruker reserven.
5. Start etter godkjenning med pilot 5/dag og 1/kjøring, kontroller levering/svar/reservasjon, og øk senere til maks 95 ved egen beslutning. Behold upstream `OPENOUTREACH_ALLOW_SEND=false`.

Denne sprinten setter aldri `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`.

## Publiseringskontroll for nettsiden

Når innholdet er avklart: implementer `/personvern` i nettstedets eksisterende ruter, legg til footer-lenke, korrekt tittel/canonical og oppdateringsdato. Behold en avgrensning som sier at teksten beskriver Gullkornet-kontakt med bedrifter; nettstedets skjema, cookies, analyse og andre tjenester må kartlegges før teksten brukes som full nettstedserklæring. Test direkte lasting, refresh og mobilvisning. Bekreft at siden faktisk viser erklæringen etter deploy; 200 alene er utilstrekkelig.

## Verifikasjon og leveranse

PR: https://github.com/KhalilJel/Gullkornet/pull/128

Lokal typecheck PASS. 388 tester: 386 bestått, 2 hoppet over, 0 feil. Ny regionisolasjon og 95-per-dag-simulering inkluderer unike mottakere og idempotensnøkler. Produksjonsdeploy ved start er ac57a8d, Railway SUCCESS. Sluttstatus for CI, buffer og preview føres inn etter kjøringene.
