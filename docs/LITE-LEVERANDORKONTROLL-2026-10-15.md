# Leverandørkontroll — 15.10.2026

## Resend: bekreftet lanseringsblokkering
Den offentlige Acceptable Use Policy, sist oppdatert 13.10.2026 og lest 15.10.2026, forbyr uoppfordrede meldinger, uttrykkelig også cold outreach og innsamlede kontaktdata. Den krever at mottakerne uttrykkelig har meldt seg på kommunikasjon fra avsenderen. Dette er en leverandørbetingelse, separat fra norsk markedsføringsrett og GDPR.

Den beskrevne Gullkornet-piloten bruker offentlig innsamlede fellesadresser uten dokumentert påmelding. Den kan derfor ikke lanseres via Resend på det foreliggende grunnlaget. 95/dag er bare en kapasitetsberegning, ikke tillatelse. Oppgradering, lavere volum eller et generelt klarsignal løser ikke vilkårskonflikten.

Mulige videre veier: dokumenter faktisk uttrykkelig påmelding for mottakerne, eller vurder en annen lovlig kanal/leverandør med vilkår som tillater det konkrete bruksområdet. Ingen leverandør er valgt eller kjøpt. Ingen melding til support er sendt, ingen konto opprettet og ingen nøkler/DNS er endret. Migadu skal ikke brukes som automatisk omvei; også denne leverandørens bruksvilkår må passe faktisk bruk.

Kilde: https://resend.com/legal/acceptable-use

## Verifiserte offentlige leverandøropplysninger
Resend opplyser at DPA gjelder alle kontoer ved opprettelse og inkluderer EU SCC. Kundedata lagres i USA; en valgt EU-avsenderregion endrer ikke dette. Standardplanenes e-post-/loggdata beholdes i 30 dager; backup i 7 dager. Dette er leverandørens offentlig dokumenterte standardvilkår, ikke en inspeksjon av kundens arkiverte avtale eller faktiske individuelle data. Kilder: https://resend.com/security/gdpr og https://resend.com/legal/dpa

Airtables offentlige DPA inkluderer EU SCC/UK-tillegg. Eier har bekreftet avtalene i orden, men avtalekopien er ikke uavhengig kontrollert her. Faktisk planbestemt historikk og trash-/backupoppsett må kontrolleres i kontoen før en konkret kundespesifikk frist påstås. Kilder: https://www.airtable.com/company/dpa og https://support.airtable.com/articles/3516802427-record-level-revision-history-in-airtable

Railways offentlige DPA beskriver SCC for internasjonale overføringer. Loggtilgang er planavhengig: Free 3 dager, Trial/Hobby 7, Pro 30 og Enterprise opptil 90. Dokumentasjonen sier at oppgradering kan gjøre tidligere utilgjengelige logger synlige igjen; synlighetsvinduet må derfor ikke uten videre kalles faktisk sletting. Kilder: https://railway.com/legal/dpa og https://docs.railway.com/observability/logs

Migadus personvernside fungerer også som DPA. Den beskriver sletting etter avslutning normalt innen 30 dager med unntak, og mulighet for brukerstyrt sletting av innhold. Dette er ikke dokumentasjon på automatisk 30-dagerssletting av en aktiv innboks eller en konkret backupfrist. Kilde: https://www.migadu.com/privacy/

## Faktiske produksjonstall og begrensning
Gullkornet PR 134 / main 5977039 er deployet og grønn. Skrivebeskyttet autentisert kontroll viste 0 innkommende meldingskopier i svarmonitorens database; data_changed=false, send_triggered=false, ttl_enabled=false. Originalinnboksen og sikkerhetskopier er ikke omfattet av denne tellingen.

Ingen e-poster, produksjonssletting, leverandørbytte, nye kostnader eller secrets-/DNS-endringer er gjennomført.
