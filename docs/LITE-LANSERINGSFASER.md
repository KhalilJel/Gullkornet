# Gullkornet — gjeldende lanseringsfaser

Oppdatert 16.10.2026, Europe/Oslo. Dette er gjeldende oversikt; eldre sprintnotater er historikk.

## Fase 1 — stabil drift (verifisert)
KeeLead-reparasjonen og Gullkornet er deployet. PR #135/main 617cd39 og Railway 57f49b31-864b-492c-b598-d91a61006f54 var grønne ved siste sluttkontroll. Svarmonitoren kjørte uten feil. Nye kodeendringer teller ikke som deployet før egne tester, CI og utrulling er bekreftet.

## Fase 2 — mottakere og godkjent kommunikasjon
Godkjent mal er 2026-10-15.6, emne «Dette la vi merke til hos dere». Alltid vi/dere, aldri jeg/du. Siste setning er fjernet etter uttrykkelig instruks. Full tekst i LITE-GJELDENDE-EPOSTMAL.md. Ingen nye tekstendringer.

Sist fullførte fullaudit 38764033223: 530 Lite Ready, 505 teknisk klare, 25 uten MX, ingen andre køfeil/duplikater. Ny fullaudit 38815220436 er startet 16.10 norsk tid; utfallet må kontrolleres før tallene oppdateres. Teknisk femmottaker-preview 38815216613 besto: scanned=5, eligible=5, sent=0, ingen avviste/svar/tidligere utsendinger/utdaterte kandidater i dette utvalget. Dette dokumenterer ikke påmelding, leverandørtillatelse eller samlet lovlig grunnlag.

Full dokumentert pool er gjennomgått: 8 898 registerenheter, 316 nettsidekandidater, 0 ytterligere nye. Målet 700 er ikke nådd og er ikke et pilotkrav. Flere leads krever nye dokumenterbare kandidater, ikke svakere filtre eller samme pool på nytt. Første planlagte påfyll 16.10 er kl. 06:40 Europe/Oslo (04:40 UTC) og var ennå ikke forfalt ved kontroll rundt 00:10. Ingen automatisk oppfølging er opprettet i denne leveransen.

## Fase 3 — personvern og informasjon (pågår)
CIDEA AS og avtalene er eierbekreftet; avtalekopier er ikke uavhengig inspisert her. Ekstern jurist er ikke et arbeidskrav. Vi bruker dokumentert egenvurdering. Intern lagringspolicy: 90 dager ukontaktet/ubesvart, behovsstyrt dialog med periodisk gjennomgang, 30 dager for ferdigbehandlede meldingskopier når originaldialog og nødvendige bevis er sikret. Dette er ikke generelle lovfrister eller aktivert automatisk sletting.

Køens produksjonssimulering 38775945217 viste delete=0, minimize=0, reviewRequired=0. PR #134 innførte autentisert skrivebeskyttet oversikt over svarmonitorens database. Produksjonskontroll: 0 innkommende meldingskopier, alle øvrige tellinger 0, ttl_enabled=false, data_changed=false, send_triggered=false. Dette omfatter ikke originalinnboksen eller sikkerhetskopier.

/personvern er implementert som separat utkast i Cidea-Marketing PR #14, med grønn bygging, nettlesertest og Netlify-forhåndsvisning. Hovednettstedet er ikke endret. Faktisk innboks-/historikk-/backupbevaring, trygg praktisk oppfølging og konkret informasjonsvurdering gjenstår før offentlig publisering. Eksisterende overvåket personvernkontakt er jelassi@cideamarketing.com.

## Leverandørgrunnlag — bekreftet blokkering
Resends AUP, oppdatert 13.10.2026, forbyr det beskrevne uoppfordrede løpet og krever uttrykkelig påmelding. Se LITE-LEVERANDORKONTROLL-2026-10-15.md. Kvote, malgodkjenning, lavt volum eller et generelt live-klarsignal løser ikke dette.

Denne kodeleveransen avviser derfor Lite-live før konfigurasjon, nøkler, nettverk eller CRM-skriving, selv om live-flagget settes. Avslått flagg er fortsatt en ufarlig no-op. Skrivebeskyttet preview er fortsatt tilgjengelig og merkes som teknisk kontroll. Det finnes ingen ny miljøvariabel som omgår leverandørsperren. Ingen tredjepartsleverandør er valgt, kjøpt eller tilkoblet.

## Fase 4 — kontrollert pilot (blokkert, ikke startet)
Avklar faktisk påmelding eller en lovlig kanal med passende leverandørvilkår. Ferdigstill fase 3. Kontroller deretter fem konkrete, ferske mottakere: selskap, reell fellesadresse, relevans, kilde, MX, reservasjon, tidligere kontakt, informasjon, kvote og nøyaktig mal. Fersk preview og batch-svarsjekk kreves. Maks 5/dag og 1/kjøring. Særskilt uttrykkelig live-klarsignal kreves også; «fortsett» er ikke et slikt signal. Kontroller første levering før flere; stopp ved avvik.

## Fase 5 — opptrapping og salg (ikke startet)
Vurder levering, svar, reservasjoner, klager og reell interesse etter pilot. Økning krever egen beslutning og passende kanalgrunnlag. Senere tak er maksimalt 95/dag innenfor faktisk restkvote. 95 x 31 = 2945, bare 55 i reserve ved 3000 månedlig; annet forbruk kan kreve lavere volum. Dette er en kapasitetsramme, ikke en utsendingstillatelse.

## Faste begrensninger
Ingen live-send, produksjonssletting, nye kostnader, DNS/secrets- eller volumendringer uten særskilt godkjenning. Ingen meldinger til andre chatter/personer uten uttrykkelig instruks. Historisk KeeLead-enrich/research inneholder eksempeldata og er ikke verifisert beslutningsgrunnlag. Lite bruker egne kvalifiseringskontroller.
