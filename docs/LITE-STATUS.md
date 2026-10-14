# Gullkornet Lite – status

Oppdatert 14.10.2026, 17:20 UTC. Live-utsending er **AV**. Ingen e-post er sendt fra Lite.

## Verifisert

| Område | Resultat |
|---|---|
| GitHub | `main` = 196ec63 (#119). Alle CI-sjekker er grønne. Tester: 372 av 372 |
| Railway | Tjenesten `openoutreach` kjører commit 196ec63 (deploy bda739d6, SUCCESS). Commit-ID-en kommer fra Railways deploy-liste, ikke bare fra health. `/health`: ok, reply_monitor=running, ingen feil. `OPENOUTREACH_ALLOW_SEND=false` |
| Brytere | `GULLKORNET_LITE_ENABLE_LIVE_SEND` er ikke satt. Den avanserte senderen logger «kill switch is off» |
| Pilotgrenser | `GULLKORNET_LITE_DAILY_LIMIT=5` og `GULLKORNET_LITE_MAX_PER_RUN=1`. Kontrollert med koden: maks 5 per døgn. Resend 100 per dag og 3 000 per måned |
| Lite Audit | 10 Lite Ready. 9 er rene. 1 (`recCNPvnBfFuVbjoa`) har ingen MX. 0 duplikater, 0 DNC, 0 svar, research 89 av 90 dager igjen (96.210 og 43.221) |
| Outreach-preview (main) | scanned=10, eligible=9, stale=1, refused=0, replied=0, noResearch=0, recentlySent=0, sent=0 |
| Reply-Status Check | PASS (positiv kontroll replied=true, negativ kontroll replied=false) |
| Reply Sync | Grønn: checked=0 (ingen Sent-rader ennå) |
| Mal | Versjon 2026-10-14.2, uendret |

## Raden uten MX

`recCNPvnBfFuVbjoa`: e-postdomenet har ingen MX-post. Det er en leveringsfeil, ikke en reservasjon, så raden er **ikke** merket Do Not Contact. Senderen sjekker MX før hver utsending og hopper over raden (`stale=1`) så lenge domenet ikke tar imot e-post. Får domenet MX senere, blir raden sendbar. Rydd den bare hvis du selv ønsker det.

## Gjenstår (krever eieren)

1. **Airtable-felter mangler.** Kontrollert med feltspørringer som bare leser: `Next Step`, `Next Step Date`, `Offer NOK`, `Paid NOK` og `Paid Date` finnes ikke. Schema-API-et svarer 403, fordi tokenet mangler `schema.bases:read`. Valgene i Lead Status kan derfor ikke kontrolleres. Legg til feltene og valgene `Interested`, `Offer Sent` og `Replied` i Airtable selv, eller gi tokenet `schema.bases:read` + `schema.bases:write`, så kan de opprettes via API. Reply Sync setter `Replied` med typecast, men det er ikke verifisert at tokenet får lagt til nye valg.
2. **Juridiske beslutninger B1–B7** i [LITE-JURIDISK-KONTROLL.md](LITE-JURIDISK-KONTROLL.md).
3. **Merge PR #120** (beskyttelse av Lite Ready-rader mot den avanserte synkroniseringen, og en utvidet audit).
4. Godkjenning av første utsending: se [LITE-PILOT.md](LITE-PILOT.md).

## Annet

- Tabellen har 182 rader med status `Sent` fra den avanserte pipelinen (før Lite). De omfattes ikke av Lite Reply Sync.
- Varselsaken #51 er fortsatt åpen og gjelder gamle feil. Lite-workflowene er grønne nå.
