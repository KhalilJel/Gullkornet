# Pilot – Gullkornet Lite (maks 5 e-poster per dag)

Forberedt 14.10.2026. **Utsendingen er ikke startet.** Den starter først når eier setter secret `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`.

## Innstillinger for piloten

| Navn | Verdi | Hvorfor |
|---|---|---|
| `GULLKORNET_LITE_DAILY_LIMIT` (variabel) | `5` | Pilotens tak, rullerende 24 t, hele Resend-kontoen |
| `GULLKORNET_LITE_MAX_PER_RUN` (variabel) | `1` | Én e-post per 10-minutterskjøring, så de fem spres |
| `RESEND_DAILY_QUOTA` / `RESEND_MONTHLY_QUOTA` | `100` / `3000` | Resend-planen |
| `GULLKORNET_LITE_ENABLE_LIVE_SEND` (secret) | ikke satt | Bryteren. Settes kun av eier |

## Kontrollert før start

| Punkt | Status |
|---|---|
| Mal | Versjon `2026-10-14.2`, fast tekst, avsender og reservasjonslinje håndheves i kode (`src/lite/template.ts`) |
| Avsender | `Cidea Marketing <hello@cideamarketing.com>`, låst i kode |
| Avsenderdomene (DNS 14.10.2026) | DKIM `resend._domainkey` på cideamarketing.com, SPF på `send.cideamarketing.com` (return-path), DMARC `p=quarantine`. Svar går til Migadu (MX) |
| Mottakere | Kun AS/ASA, rolleadresser (post@, info@ …), domenet matcher registrert nettside, ingen frimail |
| Ferskhet | Rett før hver e-post: Brreg på nytt (slettet, konkurs, avvikling, ny org.form, ny e-post) og MX-oppslag. Feil hos Brreg/DNS stopper kjøringen |
| Research | Segmentfil under 90 dager med ≥ 8 undersøkte nettsider per segment (96.210 og 43.221) |
| Svar | Reply-monitor svarer «ikke svart» før sending; reply sync flytter `Sent` → `Replied` hver time |
| Kvoter | Daglig, time, mellomrom og Resend-kvote telles fra Resends egen logg, ikke fra en lokal teller |
| Duplikater | Raden settes `Sent` før sending (aldri to ganger), idempotensnøkkel hos Resend, domeneblokkering |

## Før bryteren slås på

1. Kjør **Gullkornet Lite Audit**. Alle rader i køen skal være «clean», eller du godtar at de som ikke er det hoppes over.
2. Kjør **Gullkornet Lite Outreach** med `preview=true`. `eligible` ≥ 5 og `stale=0`.
3. Kjør **Gullkornet Reply-Status Check**: PASS.
4. Legg til feltene og visningene i [LITE-SALGSOPPFOLGING.md](LITE-SALGSOPPFOLGING.md). Per 14.10.2026 mangler alle fem feltene (se [LITE-STATUS.md](LITE-STATUS.md)).
5. Ta stilling til de juridiske beslutningene B1–B7 i [LITE-JURIDISK-KONTROLL.md](LITE-JURIDISK-KONTROLL.md). Malen endres bare gjennom en ny malversjon med ny godkjenning.

Siste kontroll 14.10.2026: audit 9 av 10 rene (1 uten MX hoppes over automatisk), preview eligible=9 og sent=0, reply-status PASS.

## Under piloten (anbefalt 5 virkedager)

- Daglig: Resend-dashbordet (levert, bounce, klage) og hello@-innboksen.
- **Stopp straks** (sett secret til noe annet enn `true`) ved en klage, mer enn 1 bounce, eller et svar som tyder på at mottakeren er en privatperson.
- Etter 5 dager: rapporter sendt / svar / positive / reservasjoner. Først da økes `GULLKORNET_LITE_DAILY_LIMIT` (f.eks. 15, så 30).

## Tilbakerulling

Sett `GULLKORNET_LITE_ENABLE_LIVE_SEND` til noe annet enn `true`. Ingen data slettes; rader som er `Sent` forblir det.
