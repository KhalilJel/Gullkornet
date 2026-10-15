> Oppdatert eierbeslutning 15.10.2026: Avtalene er bekreftet i orden av eier, valg av lagringstid er delegert og ekstern jurist skal ikke brukes. Eldre krav om juristgodkjenning nedenfor er historikk, ikke gjeldende arbeidskrav. Les LITE-READINESS-2026-10-15.md og LITE-LAGRINGSPOLICY-2026-10-15.md for gjeldende vurdering og konkrete gjenstående kontroller. Dette er ikke live-klarsignal. Mal .2 er uendret, sletting er av.
# Lagring og sletting – Gullkornet Lite (90 dager)

**Status: BYGGET OG TESTET, IKKE AKTIVERT.** Dette gjennomfører de interne standardene i [PROSPECT-DATA-RETENTION-POLICY.md](PROSPECT-DATA-RETENTION-POLICY.md) for Lite-rader (`[GK-LITE]`). Rader fra den avanserte pipelinen omfattes ikke.

## Regler (`src/lite/retention.ts`)

| Rad | Når | Tiltak | Hvorfor |
|---|---|---|---|
| `Lite Ready` (aldri kontaktet) | `First Seen` er eldre enn 90 dager | **Slettes** | Ikke lenger behov. Bedriften kan bli lagt inn på nytt med ferske data |
| `Sent` uten svar | `sent=<dato>` er eldre enn 90 dager | **Minimeres** | Raden må finnes for at bedriften aldri skal få en ny e-post |
| `Do Not Contact` / `Suppressed` | Straks | **Minimeres**, slettes aldri | Reservasjonen må beholdes |
| `Replied`, `Interested`, `Meeting`, `Offer Sent`, `Won`, `Lost` | – | Beholdes og listes for manuell vurdering | Pågående salg eller kundeforhold (regnskap) |
| Uten dato | – | Røres ikke, rapporteres som `undated` | Ingen sikker frist |

**Minimering** beholder `Email`, `Lead Status`, `Do Not Contact` og `Duplicate Key`, setter `Company` til «(minimert)», tømmer `Website`, `City`, `Industry`, kildelenkene, `Next Step` og `Next Step Date`, og setter `Research Notes` til `[GK-LITE] orgnr=… retention=… minimized=<dato>`. E-postadressen, domenet og org.nr. hindrer fortsatt nye henvendelser, både i senderen og i intake.

Senderen skriver nå `sent=<dato>` i `Research Notes` når raden settes `Sent`. Det er datoen fristen regnes fra.

## Slik kjøres det

- **Dry-run** (standard): *Gullkornet Lite Retention* med `execute=false`, eller `npm run lite:retention`. Den skriver bare record-ID-er og tiltak. Lite Audit viser også en linje med dry-run-tallene hver mandag.
- **Utføre** krever begge disse:
  1. input `execute=true`
  2. repo-variabelen `GULLKORNET_LITE_RETENTION_ENABLED=true` (eierens godkjenning, er **ikke satt**)

  I tillegg nekter koden uten `GULLKORNET_LITE_RETENTION_EXECUTE=true` og i pull_request-kjøringer. Minimering kjøres før sletting, så en reservasjon går aldri tapt hvis en sletting feiler.

## Testet

- `tests/lite-privacy.test.ts`: frister, minimering, reservasjoner, at det er idempotent, at ingenting skjer uten bryter, at minimering skjer før sletting, hvilke felter Airtable-skriveren sender, og at senderen skriver datoen.
- Dry-run mot produksjon 14.10.2026 (Lite Audit på branchen): se rapporten i PR-en.

## Gjenstår (ikke bygget)

- Kopier av e-post på Railway (svarmonitoren) og i Migadu-innboksen har ingen lagringstid. Det må avklares, se [LITE-DATABEHANDLERE.md](LITE-DATABEHANDLERE.md).
- Rader fra den avanserte pipelinen.
- Leverandørenes sikkerhetskopier, for eksempel Airtables «trash» og revisjonshistorikk. Slettede rader kan ligge der en periode.
