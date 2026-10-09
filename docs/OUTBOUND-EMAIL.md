# Gullkornet outbound email

The Phase 11 production sender is `jelassi@cideamarketing.com`. The default mode is dry-run. The only live-send CLI path is one recipient per invocation, and every live attempt fails closed unless all gates pass.

## Dry-run (default)

```bash
npm run --silent send:email -- data/contact-research-drafts.json recipient@example.no
```

This prints the selected draft and sends nothing. The recipient must match exactly one researched record.

## Before any live send

Create `data/suppressed-emails.txt` locally. Put opted-out or otherwise suppressed addresses one per line; blank lines and lines starting with `#` are ignored. Live send fails closed if this file is missing.

Live sending requires all of the following:

- `--send` command-line flag.
- `GULLKORNET_ENABLE_LIVE_SEND=true`, the master kill switch.
- `GULLKORNET_APPROVED_RECIPIENT` set to the exact recipient.
- `GULLKORNET_RECIPIENT_REVIEWED=true` after human review of recipient relevance and applicable marketing/privacy requirements.
- An exact Airtable match where Lead Status is `Approved`, Review Status is `Ready for outreach`, and Do Not Contact is not enabled. Missing Airtable credentials, provider errors, duplicates, or a non-approved record block the send.
- A present suppression file and no matching suppression entry.
- `GULLKORNET_SEND_IDEMPOTENCY_KEY` set to a stable unique key for this one logical send.
- `RESEND_API_KEY` for the intended Resend account.
- The verified Cidea sender `jelassi@cideamarketing.com`.
- A complete Resend send-history query before sending. Any API error, malformed history, invalid timestamp, or incomplete 24-hour history blocks the send.

## Phase 11 limits

The shared policy is maximum 3 per run, 3 per hour, and 10 per rolling 24 hours. The live CLI sends a single recipient per run, so that path is inherently one per invocation. It queries Resend history to enforce cross-invocation hourly and daily caps. It does not use Airtable status fields as a send ledger.

The legacy batch sender is hard-disabled in source. The scheduled GitHub Actions send job is also paused. Do not reactivate batch sending until reply detection, follow-up blocking, complete suppression integration, monitoring, and final acceptance have passed.

## Safety boundaries

- Dry-run is the default.
- No secrets, API keys, or local suppression files belong in Git.
- No DNS/MX changes are made by this code.
- No automatic follow-ups are allowed until reply detection is working and proven.
- The OpenOutSend Railway HTTP bridge remains ingest-only; it has no sending endpoint.
- Phase 11 stays IN PROGRESS until reply detection, suppression, rate limits, kill switch, monitoring and final end-to-end acceptance are all proven.
