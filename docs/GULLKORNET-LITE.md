# Gullkornet Lite

Fixed-template B2B outreach: Brønnøysund -> legal recipient filter -> Airtable `Lite Ready` -> one approved template via Resend. No AI, no website analysis, no personalisation. The advanced pipeline and its sender are unchanged and keep working on their own statuses.

## Flow

1. **Intake** (`npm run lite:intake`, workflow *Gullkornet Lite Lead Intake*). Brreg open API, Oslo + Akershus by default, org form AS/ASA, not bankrupt or being wound up, <= 249 employees. Places can supplement (`--source places --input <discover:google output>`); a Places lead needs a unique Brreg match on its website, otherwise it is dropped.
2. **Recipient filter** (`src/lite/recipient-policy.ts`). Only role addresses from the existing allow-list (post@, info@, kontakt@, firmapost@ ...), no freemail, no cideamarketing.com, and the email domain must match the registered website when one exists. ENK and every other non-allowed form are refused; ENK cannot be configured as allowed.
3. **De-duplication** against every Airtable row (any status, including the advanced pipeline): same address, same business domain, same org number or same duplicate key. New rows get `Lead Status = Lite Ready` and `Research Notes = [GK-LITE] source=... orgnr=... orgform=... template=...`.
4. **Send** (`npm run send:lite`, workflow *Gullkornet Lite Outreach*). Per record: exactly one Airtable row for the address, `Lite Ready`, Lite marker, legal form, DNC unticked, no other row at the same business Sent/Replied/Contacted/Suppressed/DNC/Follow-up/Meeting/Won/Lost, reply-status service says no reply, not in the 24 h Resend ledger. Then send with an idempotency key and mark the row `Sent`. Any outage stops the run.

## Legal basis (summary, not legal advice)

Markedsføringsloven § 15 requires prior consent for electronic marketing to natural persons. Forbrukertilsynet's guidance: a named work address is a natural person even when it is the registered company address; a role address that belongs to no specific person may be used; if it is unclear, the sender carries the risk. E-handelsloven § 9: it must be clear who the sender is and that the message is marketing. Lite therefore uses only role addresses at legal-person companies, the template names Jelassi / Cidea Marketing, and every email carries the opt-out line. Opt-outs: tick `Do Not Contact` on the row (the whole business domain is then blocked).

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
| `GULLKORNET_LITE_ORG_FORMS` | variable | `AS,ASA` | Allowed org forms. ENK is rejected. |
| `GULLKORNET_LITE_INTAKE_ENABLED` | variable | unset | Scheduled intake runs only when `true`. |
| `GULLKORNET_LITE_INTAKE_SYNC` | variable | unset | Scheduled intake writes Airtable only when `true`. |
| `GULLKORNET_LITE_INTAKE_LIMIT` | variable | 150 | New `Lite Ready` rows per scheduled intake. |

Window: every day 08:00-20:00 Europe/Oslo (code; the cron is a superset). Defaults allow 100/day: 12 h x 15/h = 180, spacing allows 720.

## Go-live order

1. Owner approves the template text (see open point in the PR) and the Resend plan; set `RESEND_DAILY_QUOTA` (and `RESEND_MONTHLY_QUOTA`).
2. Manual *Lite Lead Intake* with `sync_to_airtable=false`; read the counts. Then once with `true` and a small `limit` (10); check the rows in Airtable.
3. Manual *Lite Outreach* with `preview=true`: counts eligible rows, sends nothing.
4. Go-live: set secret `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`. Start with `GULLKORNET_LITE_DAILY_LIMIT` 30, then 60, then 100 over the first week (sender reputation).
5. Enable scheduled intake: `GULLKORNET_LITE_INTAKE_ENABLED=true`, then `GULLKORNET_LITE_INTAKE_SYNC=true`.

Rollback: set `GULLKORNET_LITE_ENABLE_LIVE_SEND` to anything but `true`. If a run reports that Resend accepted but Airtable was not marked Sent, set that row to `Sent` by hand before the next run.

## Offline checks

`npm run lite:dry-run` (five synthetic `.example` leads, fake clock/Resend/Airtable, no network) and `npm test`.
