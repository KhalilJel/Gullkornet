# Gullkornet — gjeldende lanseringsfaser

Oppdatert 16.10.2026, Europe/Oslo. Dette er gjeldende oversikt; eldre sprintnotater er historikk.

## Fase 1 — stabil drift (verifisert)
KeeLead-reparasjonen og Gullkornet er deployet. PR #136/main 3750c08 og Railway 652a7cac-d771-449b-b151-5da9f61979c2 var grønne ved siste sluttkontroll. Svarmonitoren kjørte uten feil. Typekontroll og 394 TypeScript-tester var kjørt, 392 besto og 2 ble hoppet over. Nye kodeendringer teller ikke som deployet før egne tester, CI og utrulling er bekreftet.

## Fase 2 — mottakere og godkjent kommunikasjon
Godkjent mal er 2026-10-15.6, emne «Dette la vi merke til hos dere». Alltid vi/dere, aldri jeg/du. Siste setning er fjernet etter uttrykkelig instruks. Full tekst i LITE-GJELDENDE-EPOSTMAL.md. Ingen nye tekstendringer.

Fullaudit 38815220436 er fullført 16.10 kl. 00:15:56 Europe/Oslo: 530 Lite Ready, 505 teknisk klare, 25 uten MX, ingen andre køfeil. Lagringssimulering delete=0, minimize=0, reviewRequired=0, undated=0. Teknisk femmottaker-preview 38815216613 besto: scanned=5, eligible=5, sent=0, ingen avviste/svar/tidligere utsendinger/utdaterte kandidater i dette utvalget. Dette dokumenterer ikke påmelding, leverandørtillatelse eller samlet lovlig grunnlag.

Full dokumentert pool er gjennomgått: 8 898 registerenheter, 316 nettsidekandidater, 0 ytterligere nye. Målet 700 er ikke nådd og er ikke et pilotkrav. Flere leads krever nye dokumenterbare kandidater, ikke svakere filtre eller samme pool på nytt. Første planlagte påfyll 16.10 er kl. 06:40 Europe/Oslo (04:40 UTC) og var ennå ikke forfalt ved kontroll rundt 00:10. Ingen automatisk oppfølging er opprettet i denne leveransen.

## Fase 3 — personvern og informasjon (pågår)
CIDEA AS og avtalene er eierbekreftet; avtalekopier er ikke uavhengig inspisert her. Ekstern jurist er ikke et arbeidskrav. Vi bruker dokumentert egenvurdering. Intern lagringspolicy: 90 dager ukontaktet/ubesvart, behovsstyrt dialog med periodisk gjennomgang, 30 dager for ferdigbehandlede meldingskopier når originaldialog og nødvendige bevis er sikret. Dette er ikke generelle lovfrister eller aktivert automatisk sletting.

Køens produksjonssimulering 38775945217 viste delete=0, minimize=0, reviewRequired=0. PR #134 innførte autentisert skrivebeskyttet oversikt over svarmonitorens database. Produksjonskontroll: 0 innkommende meldingskopier, alle øvrige tellinger 0, ttl_enabled=false, data_changed=false, send_triggered=false. Dette omfatter ikke originalinnboksen eller sikkerhetskopier.

/personvern er publisert og offentlig verifisert: https://cideamarketing.com/personvern. Cidea-Marketing PR #14 er merget som 46433a830d713526986ed576635092fe97b5c885 etter grønn bygging, desktop-/mobiltest og forhåndsvisning. Hovedgrenens bygg besto. Riktig side og kontakt vises offentlig, ikke lenger forsidefallback. Publisering lå innenfor opprinnelig godkjenning etter faktakontroll. Den andre cinematic-designgrenen er bevart.

Original INBOX ble kontrollert med IMAP EXAMINE: 2 meldinger, ingen før kalendergrensen beregnet fra 90 dager UTC. Ingen hoder/innhold hentet, ingen endring. Railway-API bekrefter HOBBY-plan og ingen brukeropprettede backuper/backupplaner for svarmonitorens volum. Dette dokumenterer ikke fravær av leverandørinterne kopier. Offentlig tekst skiller derfor prospektpolicy, loggtilgang og kriterier for historikk/backup, uten oppdiktet felles slettefrist. Se LITE-PERSONVERN-PUBLISERT-2026-10-16.md.

Personvernpublisering er ferdig. Praktisk løpende behovsgjennomgang og den konkrete informasjons-/mottakervurderingen før pilot gjenstår; en nettside alene beviser ikke at alle mottakere har fått nødvendig informasjon. Kontakt er eksisterende overvåket jelassi@cideamarketing.com. Ingen automatisk sletting eller opprydding er aktivert.

## Leverandørgrunnlag — bekreftet blokkering
Resends AUP, oppdatert 13.10.2026, forbyr det beskrevne uoppfordrede løpet og krever uttrykkelig påmelding. Se LITE-LEVERANDORKONTROLL-2026-10-15.md. Kvote, malgodkjenning, lavt volum eller et generelt live-klarsignal løser ikke dette.

Denne kodeleveransen avviser derfor Lite-live før konfigurasjon, nøkler, nettverk eller CRM-skriving, selv om live-flagget settes. Avslått flagg er fortsatt en ufarlig no-op. Skrivebeskyttet preview er fortsatt tilgjengelig og merkes som teknisk kontroll. Det finnes ingen ny miljøvariabel som omgår leverandørsperren. Ingen tredjepartsleverandør er valgt, kjøpt eller tilkoblet.

## Fase 4 — kontrollert pilot (blokkert, ikke startet)
Avklar faktisk påmelding eller en lovlig kanal med passende leverandørvilkår. Ferdigstill fase 3. Kontroller deretter fem konkrete, ferske mottakere: selskap, reell fellesadresse, relevans, kilde, MX, reservasjon, tidligere kontakt, informasjon, kvote og nøyaktig mal. Fersk preview og batch-svarsjekk kreves. Maks 5/dag og 1/kjøring. Særskilt uttrykkelig live-klarsignal kreves også; «fortsett» er ikke et slikt signal. Kontroller første levering før flere; stopp ved avvik.

## Fase 5 — opptrapping og salg (ikke startet)
Vurder levering, svar, reservasjoner, klager og reell interesse etter pilot. Økning krever egen beslutning og passende kanalgrunnlag. Senere tak er maksimalt 95/dag innenfor faktisk restkvote. 95 x 31 = 2945, bare 55 i reserve ved 3000 månedlig; annet forbruk kan kreve lavere volum. Dette er en kapasitetsramme, ikke en utsendingstillatelse.

## Faste begrensninger
Ingen live-send, produksjonssletting, nye kostnader, DNS/secrets- eller volumendringer uten særskilt godkjenning. Ingen meldinger til andre chatter/personer uten uttrykkelig instruks. Historisk KeeLead-enrich/research inneholder eksempeldata og er ikke verifisert beslutningsgrunnlag. Lite bruker egne kvalifiseringskontroller.
