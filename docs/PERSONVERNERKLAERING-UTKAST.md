# Utkast: Personvernerklæring for Cidea Marketing

**Status: UTKAST 14.10.2026. Ikke publisert, ikke juridisk kontrollert.** Teksten bygger på den faktiske databehandlingen i Gullkornet Lite slik den er kartlagt i koden og i [LITE-DATABEHANDLERE.md](LITE-DATABEHANDLERE.md). Punkter merket **[BEKREFT]** må eieren bekrefte, og hele teksten bør kontrolleres av en jurist før den publiseres på `https://cideamarketing.com/personvern`.

---

## Personvernerklæring – Cidea Marketing

Sist oppdatert: [DATO]

### 1. Hvem er ansvarlig

Behandlingsansvarlig er CIDEA AS, org.nr. 927 394 391, Gunnar Schjelderups vei 13A, 0485 Oslo, som driver Cidea Marketing. **[BEKREFT at Cidea Marketing drives av CIDEA AS]**
Kontakt om personvern: hello@cideamarketing.com.

### 2. Hvilke opplysninger vi behandler når vi kontakter bedrifter

Vi kontakter aksjeselskaper (AS og ASA) med tilbud om markedsføringstjenester. Vi bruker bare bedriftens felles e-postadresse (for eksempel post@ eller info@), ikke adresser til navngitte ansatte, og vi kontakter ikke enkeltpersonforetak.

Om hver bedrift lagrer vi:
- firmanavn, organisasjonsnummer, organisasjonsform, næringskode og kommune
- bedriftens felles e-postadresse og nettadresse
- hvor og når vi fant opplysningene
- om og når vi har sendt én e-post, og om bedriften har svart eller reservert seg
- ved videre dialog: hva neste steg er, og eventuelle tilbud og betalinger

Selskapsopplysninger er som regel ikke personopplysninger. En felles e-postadresse kan likevel leses av én bestemt person, og svar vi mottar kan inneholde navn og kontaktopplysninger til den som skriver. Vi behandler derfor disse opplysningene i tråd med personvernregelverket.

### 3. Hvor opplysningene kommer fra

Fra Enhetsregisteret i Brønnøysundregistrene (åpne data), fra bedriftens egen nettside, og fra e-poster bedriften sender oss.

### 4. Formål og rettslig grunnlag

| Formål | Grunnlag |
|---|---|
| Sende én henvendelse om våre tjenester til bedrifter vi mener kan ha nytte av dem | Berettiget interesse (GDPR art. 6 nr. 1 bokstav f): å markedsføre egne tjenester overfor næringsdrivende. Se interesseavveiningen [LENKE/på forespørsel] |
| Registrere svar og reservasjoner, og sørge for at vi ikke tar kontakt igjen | Berettiget interesse og rettslig forpliktelse til å respektere reservasjoner (GDPR art. 21, markedsføringsloven) |
| Følge opp bedrifter som ønsker dialog, tilbud og avtale | Tiltak før avtaleinngåelse og avtaleoppfyllelse (GDPR art. 6 nr. 1 bokstav b) |
| Regnskap ved kundeforhold | Rettslig forpliktelse (bokføringsloven) |

Vi bruker ikke opplysningene til profilering eller automatiserte avgjørelser. Henvendelsen er den samme for alle mottakere.

### 5. Hvor lenge vi lagrer opplysningene

- Bedrifter vi ikke har kontaktet: slettes 90 dager etter at de ble registrert.
- Bedrifter vi har kontaktet uten å få svar: etter 90 dager beholder vi bare e-postadressen, organisasjonsnummeret og at vi har sendt én e-post, slik at vi ikke kontakter dere på nytt.
- Reservasjoner: vi beholder bare det som trengs for å respektere reservasjonen, så lenge det er nødvendig. Vi vurderer dette årlig.
- Pågående dialog og kunder: så lenge dialogen eller kundeforholdet varer, og deretter så lenge loven krever (regnskap).
- Mottatte e-poster: **[BEKREFT lagringstid for innboksen og for kopien i svarmonitoren]**

### 6. Hvem som behandler opplysningene for oss

Vi bruker disse leverandørene som databehandlere:
- Airtable (kundeoversikt, USA)
- Resend (utsending av e-post, USA)
- Migadu (e-postinnboks, Sveits)
- Railway (svarmonitor, USA)
- GitHub (drift og kjøring av systemet, USA; inneholder ikke e-postadresser i klartekst)

Overføring til USA skjer med grunnlag i EUs standardavtaler (SCC) og/eller EU–US Data Privacy Framework, se [LITE-DATABEHANDLERE.md](LITE-DATABEHANDLERE.md). **[BEKREFT for hver leverandør]** Vi selger ikke opplysninger og gir dem ikke videre til andre.

### 7. Dine rettigheter

Du kan be om innsyn, retting, sletting og begrensning, og du kan protestere mot behandlingen. **Du kan når som helst reservere deg mot markedsføring.** Svar på e-posten eller skriv til hello@cideamarketing.com, så registrerer vi reservasjonen samme virkedag og kontakter dere ikke igjen. Du kan klage til Datatilsynet (datatilsynet.no).

### 8. Endringer

Vi oppdaterer erklæringen når behandlingen endres. Datoen øverst viser siste endring.

---

## Grunnlag for utkastet (fra koden)

| Påstand i erklæringen | Hvor det gjelder i systemet |
|---|---|
| Bare AS/ASA og felles adresser | `src/lite/recipient-policy.ts` |
| Én e-post per bedrift, aldri to | Raden settes `Sent` før sending, og hele domenet blokkeres (`src/lite/send.ts`) |
| Ingen profilering og samme tekst til alle | Fast mal (`src/lite/template.ts`) |
| Svar og reservasjoner registreres | Reply Sync (`src/lite/replies.ts`) og `Do Not Contact` |
| 90 dager / minimering | `src/lite/retention.ts`. **Ikke aktivert i produksjon ennå** |
