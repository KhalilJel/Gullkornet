# Gullkornet Lite

Fixed-template B2B outreach: Brønnøysund -> legal recipient filter -> Airtable `Lite Ready` -> one approved template via Resend. No AI, no website analysis, no personalisation. The advanced pipeline and its sender are unchanged and keep working on their own statuses.

**Scope: Cidea Marketing only.** Cidea Leads and Cidea Consulting are paused as sales lines. Lite sends from `hello@cideamarketing.com` (locked), signs as Cidea Marketing, and the template guard refuses any wording that names another Cidea line or addresses the recipient as "du" instead of "dere".

## Flow

1. **Intake** (`npm run lite:intake`, workflow *Gullkornet Lite Lead Intake*). Brreg open API, Oslo + Akershus by default, org form AS/ASA, not bankrupt or being wound up, <= 249 employees. Places can supplement (`--source places --input <discover:google output>`); a Places lead needs a unique Brreg match on its website, otherwise it is dropped.
2. **Recipient filter** (`src/lite/recipient-policy.ts`). Only role addresses from the existing allow-list (post@, info@, kontakt@, firmapost@ ...), no freemail, no cideamarketing.com, and the email domain must match the registered website when one exists. ENK and every other non-allowed form are refused; ENK cannot be configured as allowed.
3. **De-duplication** against every Airtable row (any status, including the advanced pipeline): same address, same business domain, same org number or same duplicate key. New rows get `Lead Status = Lite Ready` and `Research Notes = [GK-LITE] source=... orgnr=... orgform=... nace=... kommune=... template=...`. NACE code and municipality record the recipient's market, which the template refers to.
4. **Send** (`npm run send:lite`, workflow *Gullkornet Lite Outreach*). Per record: exactly one Airtable row for the address, `Lite Ready`, Lite marker, legal form, DNC unticked, no other row at the same business Sent/Replied/Contacted/Suppressed/DNC/Follow-up/Meeting/Won/Lost, the segment has fresh research, a fresh Brreg lookup shows the company still registered, active, AS/ASA and (Brreg leads) still registering this address, the email domain has an MX record (`stale` in the run log otherwise; a Brreg or DNS outage stops the run), reply-status service says no reply, not in the 24 h Resend ledger. Then mark the row `Sent` and send with an idempotency key; only a clear Resend 4xx rejection puts the row back to `Lite Ready`. Any outage stops the run.

5. **Replies** (`npm run lite:replies`, workflow *Gullkornet Lite Reply Sync*, hourly). Every `Sent` Lite row is looked up in the read-only reply-status service; answered rows become `Replied`. Sends nothing. Sales follow-up from there is manual: [LITE-SALGSOPPFOLGING.md](LITE-SALGSOPPFOLGING.md).
6. **Audit** (`npm run lite:audit`, workflow *Gullkornet Lite Audit*, Mondays and manual). Read-only: data quality of every `Lite Ready` row (policy, duplicates by address/domain/org number, research, Brreg + MX freshness) and the sales overview (statuses, open offers, paid NOK against the 50 000 NOK goal). Record IDs and counts only.

Pilot (5/day) checklist and stop rules: [LITE-PILOT.md](LITE-PILOT.md).

## Legal basis (summary, not legal advice)

Markedsføringsloven § 15 requires prior consent for electronic marketing to natural persons. Forbrukertilsynet's guidance: a named work address is a natural person even when it is the registered company address; a role address that belongs to no specific person may be used; if it is unclear, the sender carries the risk. E-handelsloven § 9: it must be clear who the sender is and that the message is marketing. Lite therefore uses only role addresses at legal-person companies, the template names Jelassi / Cidea Marketing, and every email carries the opt-out line. Opt-outs: tick `Do Not Contact` on the row (the whole business domain is then blocked).

### Template claims and market research (approved template 2026-10-14.2)

Markedsføringsloven §§ 6-7: claims must be true and documentable when sent. Lite does no per-recipient analysis, so the claims are backed per **segment = NACE code x region** (today one region, Oslo og Akershus). "Deres marked" is the recipient's trade where they compete for local customers: industry alone would mix regions, a single municipality gives too small a sample.

`npm run lite:research -- --industry 96.210 [--sample 20] --write` (or the manual workflow *Gullkornet Lite Market Research*, which proposes the file as a pull request) takes a spread sample of active AS/ASA in the segment with a registered website, fetches each front page (unreadable pages, pages without a title and repeated sites are not counted) and records in `research/segments/<nace>__<region>.json.enc`: date, every site attempted (unreadable ones marked and not counted), the observed gaps with counts, the opportunities, and the follow-up text to send when someone answers yes. Nothing is inferred beyond the fetched pages; the follow-up says the review was automated and that the recipient's own site was not assessed separately.

**Privacy:** the repository is public, so research files are AES-256-GCM encrypted (segment key authenticated). The key is the repository secret `GULLKORNET_LITE_RESEARCH_KEY` plus the owner's local `.env`; only key holders can read the companies, URLs and gaps. Git history gives the audit trail; a file older than 90 days no longer unlocks sending, and an unencrypted `.json` in the folder stops the run. Review a file before approving its PR: `npm run lite:research -- --industry 96.210 --show` (prints the record and the send-gate verdict). Without the key, intake and outreach fail (and alert) as soon as a research file exists.

| Claim | Backed by |
|---|---|
| "Vi har sett på hvordan bedrifter i deres marked presenterer seg digitalt" | The segment's research file: >= 8 examined sites, less than 90 days old. The send gate recomputes the evidence from the stored site records. |
| "mener det finnes muligheter for å forbedre ..." | At least one gap seen on >= 30 % of examined sites, otherwise the file is marked `supportsTemplate: false`. |
| "Vi har en konkret idé" | `followUp` in the same file, built only from those gaps. Send it by hand to positive replies. |

Gates: intake keeps only leads in a documented segment (and without `--industries` it queries exactly those segments); the sender skips any row whose segment has no fresh, sufficient research (`noResearch` in the run log) and writes `research=<id>` on the row when it claims it, so every email is linked to the research it relied on. Research expires after 90 days: re-run it per segment.

NACE codes follow SN2025 (Brreg changed codes in 2025: hairdressers are `96.210`, not the old `96.021`).

E-handelsloven § 9: the subject is neutral; Lite sends as `Cidea Marketing <hello@cideamarketing.com>`; sender and opt-out are in the body.

## Configuration

| Name | Kind | Default | Meaning |
|---|---|---|---|
| `GULLKORNET_LITE_ENABLE_LIVE_SEND` | secret | unset | Lite kill switch. Only `true` sends. Separate from the advanced `GULLKORNET_ENABLE_LIVE_SEND`. |
| `RESEND_DAILY_QUOTA` | variable | **required** | Daily email quota of the actual Resend plan. Sending refuses without it. |
| `RESEND_MONTHLY_QUOTA` | variable | unset | Monthly quota; daily limit x 31 must fit. |
| `GULLKORNET_LITE_DAILY_LIMIT` | variable | 100 | Daily target (rolling 24 h, account-wide). Can be raised up to the Resend quota. |
| `GULLKORNET_LITE_START_HOUR` / `_END_HOUR` | workflow | 11 / 12 | The daily Oslo slot. Fixed in `lite-outreach.yml`. |
| `GULLKORNET_LITE_HOURLY_LIMIT` | workflow | 95 | Max per rolling hour. Fixed in `lite-outreach.yml`; the repository variable is no longer read. |
| `GULLKORNET_LITE_MAX_PER_RUN` | workflow | 95 | Max per run (one run a day). Fixed in `lite-outreach.yml`; the repository variable is no longer read. |
| `GULLKORNET_LITE_MIN_SPACING_SECONDS` | workflow | 30 | Floor between two emails; the slot spreads them evenly (about 38 s for 95). |
| `GULLKORNET_LITE_ONE_OFF_DATE` | dispatch input `one_off_date` | unset | Owner one-off: today's Oslo date sends now, spread over 60 minutes, same limits. Any other date refuses. |
| `GULLKORNET_LITE_ORG_FORMS` | variable | `AS,ASA` | Allowed org forms: a subset of AS, ASA. Anything else (ENK, ANS, DA, NUF ...) stops the run. |
| `GULLKORNET_LITE_INTAKE_ENABLED` | variable | unset | Scheduled intake runs only when `true`. |
| `GULLKORNET_LITE_INTAKE_SYNC` | variable | unset | Scheduled intake writes Airtable only when `true`. |
| `GULLKORNET_LITE_INTAKE_LIMIT` | variable | 150 | New `Lite Ready` rows per scheduled intake. |

Failures in the Lite intake, outreach, market research and reply sync workflows open or update the existing *[Gullkornet Pipeline Alert]* issue (`pipeline-failure-alerts.yml`).

Freshness refusals leave the queue: a definite reason (company gone, inactive, re-formed, address changed, no mail server) sets `Lite Stale`; a temporary DNS failure of the recipient's domain sets `Lite Recheck` with `recheck_after` 1, 3 and 7 days later (then `Lite Stale`). A due `Lite Recheck` row goes back to `Lite Ready` at the start of a live run and passes every gate again. MX lookups are bounded (3 s timeout, 2 tries). Both statuses are deleted after 90 days like any never-contacted row.

Window: one coordinated run every day, 11:00-12:00 Europe/Oslo ([LITE-DAILY-SLOT.md](LITE-DAILY-SLOT.md)). The run sends what the rolling 24 h limit (95) and Resend quota leave, spread evenly over the hour.

## Go-live order

1. Run *Gullkornet Lite Market Research* for the first segments, review and merge the research pull requests (see *Template claims and market research*). Approve the Resend plan; set `RESEND_DAILY_QUOTA` (and `RESEND_MONTHLY_QUOTA`).
2. Manual *Lite Lead Intake* with `sync_to_airtable=false`; read the counts. Then once with `true` and a small `limit` (10); check the rows in Airtable.
3. Manual *Lite Outreach* with `preview=true`: counts eligible rows, sends nothing.
4. Go-live: pilot first ([LITE-PILOT.md](LITE-PILOT.md)): `GULLKORNET_LITE_DAILY_LIMIT=5`, `GULLKORNET_LITE_MAX_PER_RUN=1`, then set secret `GULLKORNET_LITE_ENABLE_LIVE_SEND=true`. After the pilot, raise to 15, 30, 60, 100 (sender reputation).
5. Enable scheduled intake: `GULLKORNET_LITE_INTAKE_ENABLED=true`, then `GULLKORNET_LITE_INTAKE_SYNC=true`.

Rollback: set `GULLKORNET_LITE_ENABLE_LIVE_SEND` to anything but `true`. Each row is marked `Sent` *before* its email goes out, so a row can never be sent twice. If Resend clearly refuses (HTTP 4xx), the row is put back to `Lite Ready`. If the result is unknown (timeout, 5xx), or the reset fails, the run reports it and the row stays `Sent` (unsent) until you reset it by hand.

## Offline checks

`npm run lite:dry-run` (five synthetic `.example` leads, fake clock/Resend/Airtable, no network) and `npm test`.

## Volume (measured 14.10.2026)

Brreg, hairdressers (96.210) in Oslo og omegn, 3 pages per municipality: 544 units, 74 with a registered email, 15 qualified (role address, non-freemail, matching domain). About 3 % of fetched units become sendable leads, so 100/day x 7 needs roughly 25 000 Brreg units a week across many documented segments, or the Places supplement.
