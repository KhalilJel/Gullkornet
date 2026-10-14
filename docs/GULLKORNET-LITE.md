# Gullkornet Lite

Fixed-template B2B outreach: Brønnøysund -> legal recipient filter -> Airtable `Lite Ready` -> one approved template via Resend. No AI, no website analysis, no personalisation. The advanced pipeline and its sender are unchanged and keep working on their own statuses.

**Scope: Cidea Marketing only.** Cidea Leads and Cidea Consulting are paused as sales lines. Lite sends from `hello@cideamarketing.com` (locked), signs as Cidea Marketing, and the template guard refuses any wording that names another Cidea line or addresses the recipient as "du" instead of "dere".

## Flow

1. **Intake** (`npm run lite:intake`, workflow *Gullkornet Lite Lead Intake*). Brreg open API, Oslo + Akershus by default, org form AS/ASA, not bankrupt or being wound up, <= 249 employees. Places can supplement (`--source places --input <discover:google output>`); a Places lead needs a unique Brreg match on its website, otherwise it is dropped.
2. **Recipient filter** (`src/lite/recipient-policy.ts`). Only role addresses from the existing allow-list (post@, info@, kontakt@, firmapost@ ...), no freemail, no cideamarketing.com, and the email domain must match the registered website when one exists. ENK and every other non-allowed form are refused; ENK cannot be configured as allowed.
3. **De-duplication** against every Airtable row (any status, including the advanced pipeline): same address, same business domain, same org number or same duplicate key. New rows get `Lead Status = Lite Ready` and `Research Notes = [GK-LITE] source=... orgnr=... orgform=... nace=... kommune=... template=...`. NACE code and municipality record the recipient's market, which the template refers to.
4. **Send** (`npm run send:lite`, workflow *Gullkornet Lite Outreach*). Per record: exactly one Airtable row for the address, `Lite Ready`, Lite marker, legal form, DNC unticked, no other row at the same business Sent/Replied/Contacted/Suppressed/DNC/Follow-up/Meeting/Won/Lost, reply-status service says no reply, not in the 24 h Resend ledger. Then mark the row `Sent` and send with an idempotency key; only a clear Resend 4xx rejection puts the row back to `Lite Ready`. Any outage stops the run.

## Legal basis (summary, not legal advice)

Markedsføringsloven § 15 requires prior consent for electronic marketing to natural persons. Forbrukertilsynet's guidance: a named work address is a natural person even when it is the registered company address; a role address that belongs to no specific person may be used; if it is unclear, the sender carries the risk. E-handelsloven § 9: it must be clear who the sender is and that the message is marketing. Lite therefore uses only role addresses at legal-person companies, the template names Jelassi / Cidea Marketing, and every email carries the opt-out line. Opt-outs: tick `Do Not Contact` on the row (the whole business domain is then blocked).

### Template claims (approved template 2026-10-14.2)

Markedsføringsloven §§ 6-7: claims must be true and documentable when sent. Lite does no per-recipient analysis, so each claim must be backed at segment level (NACE x municipality), before that segment is sent to:

| Claim | What must exist before sending |
|---|---|
| "Vi har sett på hvordan bedrifter i deres marked presenterer seg digitalt" | A dated, stored review of a sample of businesses' websites/profiles in that segment. Intake should be limited (`--industries`, `--municipalities`) to segments with such a review. |
| "mener det finnes muligheter for å forbedre hvordan dere tiltrekker dere nye kunder" | An opinion, but phrased about the recipient; keep the segment review showing typical gaps. |
| "Vi har en konkret idé" | A ready-to-send follow-up explanation per segment, sent to everyone who says yes. |

E-handelsloven § 9: the subject "En idé til forbedring hos dere" is neutral and the sender (Cidea Marketing) and opt-out are in the body. The From header is the bare address `hello@cideamarketing.com` without a display name; consider a display name "Cidea Marketing" (shared sender code, separate change).

## Configuration

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `GULLKORNET_LITE_ENABLE_LIVE_SEND` | secret | unset | Lite kill switch. Only `true` sends. Separate from the advanced `GULLKORNET_ENABLE_LIVE_SEND`. |
| `RESEND_DAILY_QUOTA` | variable | **required** | Daily email quota of the actual Resend plan. Sending refuses without it. |
| `RESEND_MONTHLY_QUOTA` | variable | unset | Monthly quota; daily limit x 31 must fit. |
| `GULLKORNET_LITE_DAILY_LIMIT` | variable | 100 | Daily target (rolling 24 h, account-wide). Can be raised up to the Resend quota. |
| `GULLKORNET_LITE_HOURLY_LIMIT` | variable | 15 | Max per rolling hour. |
| `GULLKORNET_LITE_MAX_PER_RUN` | variable | 5 | Max per 10-minute run (lets a run catch up after skipped crons). |
| `GULLKORNET_LITE_MIN_SPACING_SECONDS` | variable | 60 | Minimum gap between two emails. |
| `GULLKORNET_LITE_ORG_FORMS` | variable | `AS,ASA` | Allowed org forms: a subset of AS, ASA. Anything else (ENK, ANS, DA, NUF ...) stops the run. |
| `GULLKORNET_LITE_INTAKE_ENABLED` | variable | unset | Scheduled intake runs only when `true`. |
| `GULLKORNET_LITE_INTAKE_SYNC` | variable | unset | Scheduled intake writes Airtable only when `true`. |
| `GULLKORNET_LITE_INTAKE_LIMIT` | variable | 150 | New `Lite Ready` rows per scheduled intake. |

Window: every day 08:00-20:00 Europe/Oslo (code; the cron is a superset). Defaults allow 100/day: 12 h x 15/h = 180, spacing allows 720.

## Go-live order

1. Owner documents the template claims for the first segments (see *Template claims*) and approves the Resend plan; set `RESEND_DAILY_QUOTA` (and `RESEND_MONTHLY_QUOTA`).
2. Manual *Lite Lead Intake* with `sync_to_airtable=false`; read the counts. Then once with `true` and a small `limit` (10); check the rows in Airtable.
3. Manual *Lite Outreach* with `preview=true`: counts eligible rows, sends nothing.
4. Go-live: set secret `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`. Start with `GULLKORNET_LITE_DAILY_LIMIT` 30, then 60, then 100 over the first week (sender reputation).
5. Enable scheduled intake: `GULLKORNET_LITE_INTAKE_ENABLED=true`, then `GULLKORNET_LITE_INTAKE_SYNC=true`.

Rollback: set `GULLKORNET_LITE_ENABLE_LIVE_SEND` to anything but `true`. Each row is marked `Sent` *before* its email goes out, so a row can never be sent twice. If Resend clearly refuses (HTTP 4xx), the row is put back to `Lite Ready`. If the result is unknown (timeout, 5xx), or the reset fails, the run reports it and the row stays `Sent` (unsent) until you reset it by hand.

## Offline checks

`npm run lite:dry-run` (five synthetic `.example` leads, fake clock/Resend/Airtable, no network) and `npm test`.
