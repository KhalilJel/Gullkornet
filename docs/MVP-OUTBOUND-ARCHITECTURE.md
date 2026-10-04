# Gullkornet — kostnadseffektiv outbound MVP

## Beslutning

Gullkornet bruker **Resend som utsendelseskanal** i MVP-en. Mailopoly er ikke nødvendig for første pilot.

Flyt:

1. Gullkornet finner og undersøker prospekter.
2. Airtable er den vedvarende leadkøen.
3. Gullkornet lager korte, personlige utkast.
4. En person gjennomgår mottaker, kilde og utkast.
5. Resend brukes til eventuell godkjent sending.
6. Svar håndteres manuelt i eksisterende innboks i første fase.

## Bevisst begrensning

Live sending skal fortsatt være av som standard. Ingen planlagt jobb eller deploy skal slå på utsending uten en eksplisitt godkjent mottaker og manuell kontroll.

Dette betyr at MVP-en ikke trenger:

- Mailbox-automatisering
- Automatisk reply detection
- Automatisk follow-up
- Ny DNS/MX-konfigurasjon
- En separat e-postplattform utover eksisterende Resend-oppsett

## Når vi automatiserer mer

Vi bygger først automatisk reply detection og oppfølging når pilotdata viser at tilbudet og outreach-mønsteret fungerer. Målet er å redusere kostnad og kompleksitet mens vi lærer hva som faktisk skaper svar og kunder.

## Teknisk status

Resend-domenet `smartsvar.no` er allerede verifisert og har sending aktivert. Ingen DNS- eller MX-endringer kreves for denne arkitekturen.

Gullkornet beholder idempotency, suppression checks og eksplisitte live-send-gates før en eventuell produksjonsutsending.
