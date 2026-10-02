# Gullkornet outbound email

The only configured sender for the pilot is `jelassi@smartsvar.no`. This feature sends one recipient per invocation and does not run automatically.

## Dry-run (default)

```bash
npm run --silent send:email -- data/contact-research-drafts.json recipient@example.no
```

This prints the selected draft and sends nothing. The recipient must match exactly one researched record.

## Before any live send

Create `data/suppressed-emails.txt` locally. Put opted-out or otherwise suppressed email addresses one per line; blank lines and lines starting with `#` are ignored. The file is gitignored with the rest of `data/`. Live send fails closed if this file is missing.

Live sending requires all of the following:

- `--send` command-line flag
- `GULLKORNET_ENABLE_LIVE_SEND=true`
- `GULLKORNET_APPROVED_RECIPIENT` set to the exact single recipient
- `GULLKORNET_RECIPIENT_REVIEWED=true`, only after a human checks recipient suitability and applicable marketing/privacy requirements
- `GULLKORNET_SEND_IDEMPOTENCY_KEY` set to a stable unique key for this one logical send; reuse the same key only when retrying that same send
- `RESEND_API_KEY` for the intended Resend account
- `OUTREACH_FROM_EMAIL` unset or equal to `jelassi@smartsvar.no`

Example PowerShell session for a specifically reviewed recipient:

```powershell
$env:GULLKORNET_ENABLE_LIVE_SEND = "true"
$env:GULLKORNET_APPROVED_RECIPIENT = "recipient@example.no"
$env:GULLKORNET_RECIPIENT_REVIEWED = "true"
$env:GULLKORNET_SEND_IDEMPOTENCY_KEY = "cidea-outreach-unique-001"
$env:RESEND_API_KEY = "YOUR_RESEND_API_KEY"
npm run --silent send:email -- data/contact-research-drafts.json recipient@example.no --send
```

Do not commit secrets or the suppression list. This sends at most one email per invocation. There is no bulk-send loop, scheduler, or automatic retry. The idempotency key is passed to Resend to protect retries of the same logical send.

## Boundaries

- Dry-run is the default.
- No DNS or MX changes are made by this code.
- No SmartSvar production data or credentials are used.
- Sender/domain verification in the provider account must be checked before live send.
- Only contact appropriate business recipients and follow applicable Norwegian marketing/privacy rules, opt-out requests, and provider terms.
