# Salgsoppfølging – Gullkornet Lite

Enkel arbeidsflyt for Cidea Marketing fra svar til innbetalt omsetning, i den eksisterende Airtable-tabellen `Leads`. Ingen nye tabeller, ikke noe CRM. Systemet sender **aldri** oppfølging automatisk: alt etter første e-post skrives og sendes av et menneske.

## Statusløpet

| Lead Status | Hvem setter den | Betyr | Neste handling |
|---|---|---|---|
| `Lite Ready` | Intake | Kvalifisert, ikke kontaktet | Ingen (senderen tar den) |
| `Sent` | Senderen | Første og eneste automatiske e-post er sendt | Vent på svar |
| `Replied` | Reply sync (hver time) | Bedriften har svart | Les svaret i hello@ innen én arbeidsdag og velg rad under |
| `Interested` | Du | Positivt svar | Send oppfølgingsteksten for segmentet (se under), foreslå møte |
| `Meeting` | Du | Møte avtalt | Fyll `Next Step Date` = møtedato |
| `Offer Sent` | Du | Tilbud sendt | Fyll `Offer NOK`, `Next Step Date` = purredato |
| `Won` | Du | Avtale signert | Fyll `Paid NOK` og `Paid Date` når pengene er på konto |
| `Lost` | Du | Nei etter dialog | Ingenting |
| `Do Not Contact` (avkrysning) | Du | Reservasjon («nei takk», «ikke kontakt oss») | Kryss av samme dag. Hele domenet blokkeres |

Alle statusene fra `Sent` og nedover blokkerer videre utsending til **alle** adresser på samme bedriftsdomene (Lite og den avanserte senderen).

## Felter (legg til én gang i Airtable)

| Felt | Type | Brukes til |
|---|---|---|
| `Next Step` | Single line text | Hva skal skje («ring tirsdag», «send tilbud») |
| `Next Step Date` | Date | Når. Ukesrapporten lister aktive rader uten fremtidig dato |
| `Offer NOK` | Currency (NOK) | Tilbudt beløp eks. mva. |
| `Paid NOK` | Currency (NOK) | **Faktisk innbetalt**, eks. mva. Kun når pengene er mottatt |
| `Paid Date` | Date | Innbetalingsdato |

Og legg til `Interested` og `Offer Sent` som valg i `Lead Status` (reply sync legger til `Replied` selv om den mangler).

Forslag til visninger: **Svar å behandle** (`Lead Status = Replied`), **Aktive salg** (Interested/Meeting/Offer Sent, sortert på `Next Step Date`), **Inntekt** (`Paid NOK` > 0, sum nederst).

## Svar på et positivt svar

Oppfølgingsteksten ligger i segmentets research-fil (bygget kun fra observerte funn):

    npm run lite:research -- --industry 96.210 --show

Tilpass den for hånd, si tydelig at gjennomgangen var automatisert og ikke av deres egen nettside, og send fra hello@cideamarketing.com.

## Oversikt

Workflow **Gullkornet Lite Audit** (manuelt, og hver mandag 07:00) skriver i jobbsammendraget: statusfordeling, innbetalt sum mot målet på 50 000 NOK, åpne tilbud, aktive salg uten neste steg, og datakvaliteten i køen. Kun record-ID-er og tall, ingen adresser.

## Daglig rutine (10 minutter)

1. Åpne visningen *Svar å behandle*. For hvert svar: `Interested`, `Lost` eller kryss av `Do Not Contact`.
2. Åpne *Aktive salg*. Gjør det som står i `Next Step` for rader med dagens dato, og sett ny dato.
3. Når en kunde betaler: `Won`, `Paid NOK`, `Paid Date`.
