# Gullkornet fra mobil

Alt som trengs ligger på GitHub, Railway, Airtable og Resend. PC-en trengs ikke.

## Claude fra mobil

- **Claude-appen** (iOS/Android), fanen **Code**, eller **claude.ai/code** i mobilnettleseren.
- Første gang: koble til GitHub og gi Claude GitHub-appen tilgang til `KhalilJel/Gullkornet`.
- Start en økt på repoet. Claude jobber i en skybasert sandkasse: leser kode, kjører `npm ci`, `npm run typecheck`, `npm test`, `npm run lite:dry-run`, lager branch og PR. Ingen secrets trengs til dette.
- Nettilgang i miljøet: standard holder for tester. `lite:research` (henter Brreg og nettsider) krever full nettilgang og research-nøkkelen; kjør heller workflowen under.
- Merge gjør du selv i GitHub-appen etter at CI er grønn.

## GitHub

- PR-er: https://github.com/KhalilJel/Gullkornet/pulls
- Varsler om feilede workflows: https://github.com/KhalilJel/Gullkornet/issues?q=is%3Aopen+%22Gullkornet+Pipeline+Alert%22
- Manuelle workflows (åpne i nettleser; trykk **Run workflow**, bruk "Desktop site" hvis knappen mangler):
  - Lite Outreach (preview=true sender aldri): https://github.com/KhalilJel/Gullkornet/actions/workflows/lite-outreach.yml
  - Lite Lead Intake (sync=false skriver ingenting): https://github.com/KhalilJel/Gullkornet/actions/workflows/lite-lead-intake.yml
  - Lite Market Research (nytt segment, lager PR): https://github.com/KhalilJel/Gullkornet/actions/workflows/lite-market-research.yml
  - CI: https://github.com/KhalilJel/Gullkornet/actions/workflows/ci.yml

## Status

- Svarmonitor: https://openoutreach-production-ab8b.up.railway.app/health (`status: running`, ingen `last_error_code`)
- Railway: https://railway.com/dashboard (prosjekt powerful-patience, tjeneste openoutreach)
- Resend: https://resend.com/emails (forbruk mot 100/dag, 3 000/mnd)
- Airtable: tabellen Leads, filter `Lead Status = Lite Ready` / `Sent`

## Brytere (Settings → Secrets and variables → Actions)

| Navn | Type | Nå | Virkning |
|---|---|---|---|
| `GULLKORNET_LITE_ENABLE_LIVE_SEND` | secret | ikke satt | Bare `true` sender. Slett den for å stoppe umiddelbart. |
| `GULLKORNET_LITE_DAILY_LIMIT` | variabel | 30 | Maks e-poster siste 24 t for hele Resend-kontoen før Lite stopper. |
| `RESEND_DAILY_QUOTA` / `RESEND_MONTHLY_QUOTA` | variabel | 100 / 3000 | Resend-planen. |
| `GULLKORNET_LITE_INTAKE_ENABLED` / `_SYNC` | variabel | ikke satt | Planlagt daglig intake / skriving til Airtable. |

Secrets som workflows bruker (verdier vises aldri): `AIRTABLE_API_TOKEN`, `RESEND_API_KEY`, `OPENOUTREACH_REPLY_STATUS_TOKEN`, `GULLKORNET_LITE_RESEARCH_KEY`.

## Ikke mulig fra mobil uten PC

- Lese kryptert research i klartekst (`npm run lite:research -- --show`) krever research-nøkkelen. Ha en kopi i passordbehandleren; i en Claude-skyøkt kan den legges inn som miljøvariabel `GULLKORNET_LITE_RESEARCH_KEY` ved behov.
- Railway-CLI og direkte IMAP-sjekker: bruk Railway-dashbordet og webmail i stedet.

## Før første ekte utsending

1. Migadu: `hello@` må leveres til `jelassi@`-postkassen; test med en e-post fra egen adresse (docs/LAUNCH-READINESS.md).
2. Juridiske punkter i docs/GULLKORNET-LITE.md avklart.
3. Lite Outreach med preview=true er grønn.
4. Sett `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`. Stopp: slett den.
