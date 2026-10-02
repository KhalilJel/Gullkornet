# Gullkornet outbound email

The only configured sender for the pilot is `jelassi@smartsvar.no`. This feature is a single-recipient sender; it does not send a batch or run automatically.

## Dry-run (default)

```bash
npm run --silent send:email -- data/contact-research-drafts.json recipient@example.no
```

This prints the selected draft and sends nothing. The recipient must match exactly one researched record.

## One reviewed email

Live sending requires all of the following and fails closed if any are missing:

- `--send` command-line flag
- `GULLKORNET_ENABLE_LIVE_SEND=true`
- `GULLKORNET_APPROVED_RECIPIENT` set to the exact single recipient
- `GULLKORNET_RECIPIENT_REVIEWED=true`, set only after a human checks recipient suitability and applicable marketing/privacy requirements
- `RESEND_API_KEY` belonging to the intended Resend account
- `OUTREACH_FROM_EMAIL` unset or equal to `jelassi@smartsvar.no`

Example PowerShell session for a specifically reviewed recipient:

```powershell
$env:GULLKORNET_ENABLE_LIVE_SEND = "true"
$env:GULLKORNET_APPROVED_RECIPIENT = "recipient@example.no"
$env:GULLKORNET_RECIPIENT_REVIEWED = "true"
$env:RESEND_API_KEY = "YOUR_RESEND_API_KEY"
npm run --silent send:email -- data/contact-research-drafts.json recipient@example.no --send
```

Do not commit secrets or store them in source files. This workflow sends at most one email per invocation. There is no bulk-send loop, scheduler, or automatic retry. A successful response prints the Resend email ID.

## Boundaries

- Dry-run is the default.
- No DNS or MX changes are needed or made by this code.
- This code does not access SmartSvar production data or credentials.
- The intended sender is not proof that the address/domain is verified by Resend. Check the account's sender/domain authorization before any live send.
- Only contact appropriate business recipients and follow applicable Norwegian marketing/privacy rules, opt-out requests, and provider terms.
