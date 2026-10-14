# Gullkornet Lite – status

## Oppdatering 14.10.2026, kveld (pipeline og salg)

- **Pipeline:** 67 nye Lite Ready-rader (57 via Brreg + 10 via bedriftens egen nettside, `--source website`). Køen har nå **77** unike Lite Ready: 72 rene og 5 uten MX, som hoppes over. Hele markedet i de to segmentene (frisør og rørlegger, Oslo og Akershus) har 102 kvalifiserte bedrifter. 25 av dem fantes allerede i den avanserte pipelinen og ble ikke lagt inn på nytt.
- **Topp 20:** ligger lokalt i `private/TOPP-20.md` (ikke i git, fordi repoet er offentlig). Alle 20 er Lite Ready, ikke kontaktet og ikke reservert (sjekket med fingeravtrykk-oppslag i Lite Audit).
- **Tjenestepakker og plan mot 50 000 NOK:** [CIDEA-TJENESTEPAKKER-OG-SALGSPLAN.md](CIDEA-TJENESTEPAKKER-OG-SALGSPLAN.md).
- **Juridisk beslutningspakke:** [LITE-JURIDISK-BESLUTNINGSPAKKE.md](LITE-JURIDISK-BESLUTNINGSPAKKE.md).

---


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

1. **Airtable (kontrollert 14.10.2026, kveld).** Feltene `Next Step` (tekst), `Next Step Date` (dato), `Offer NOK` og `Paid NOK` (valuta) og `Paid Date` (dato) **finnes** med riktig type. Kontrollert med feltspørringer som bare leser og på Airtables API-dokumentasjonsside. `Lead Status` har valgene New, Researched, Draft Ready, Approved, Sent, Replied, Follow-up, Suppressed, Needs Review, No Public Email og Lite Ready. **`Interested`, `Offer Sent`, `Meeting`, `Won` og `Lost` mangler.** Legg dem til i Airtable (Lead Status → Edit field). Schema-API-et svarer fortsatt 403.
2. **Juridiske beslutninger B1–B7** i [LITE-JURIDISK-KONTROLL.md](LITE-JURIDISK-KONTROLL.md).
3. **Merge PR #121** (én ødelagt mottakerdomene stopper ikke lenger hele kjøringen) og PR-en for personvern og lagring. #120 er merget. (beskyttelse av Lite Ready-rader mot den avanserte synkroniseringen, og en utvidet audit).
4. Godkjenning av første utsending: se [LITE-PILOT.md](LITE-PILOT.md).

## Personvern og lagring (utkast, se PR)

- Utkast til personvernerklæring: [PERSONVERNERKLAERING-UTKAST.md](PERSONVERNERKLAERING-UTKAST.md)
- Interesseavveining: [LITE-INTERESSEAVVEINING.md](LITE-INTERESSEAVVEINING.md)
- Forslag til ny mal (brukes ikke): [LITE-EPOSTMAL-FORSLAG.md](LITE-EPOSTMAL-FORSLAG.md)
- Databehandlere og overføringer: [LITE-DATABEHANDLERE.md](LITE-DATABEHANDLERE.md)
- Lagring i 90 dager (bygget, ikke aktivert): [LITE-LAGRING-OG-SLETTING.md](LITE-LAGRING-OG-SLETTING.md). Dry-run mot produksjon: 0 tiltak.

## Annet

- Tabellen har 182 rader med status `Sent` fra den avanserte pipelinen (før Lite). De omfattes ikke av Lite Reply Sync.
- Varselsaken #51 er fortsatt åpen og gjelder gamle feil. Lite-workflowene er grønne nå.
