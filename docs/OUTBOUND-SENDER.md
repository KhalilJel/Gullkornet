# Outbound sender configuration

## Selected production sender

Gullkornet's Phase 11 sender is `jelassi@cideamarketing.com`, verified in Resend. The sender is selected by the production outbound guard and may not be overridden for a live send.

## Current safety boundaries

- A one-recipient send is available only through the guarded `send:email` CLI, with dry-run as the default.
- The master live-send switch, exact approved recipient, explicit recipient review, one matching Airtable record marked `Approved` and `Ready for outreach`, suppression check, idempotency key, and Resend history-based rate limit checks are mandatory.
- The legacy daily/batch sender and OpenOutreach's older `send` method are hard-disabled during Phase 11.
- The Railway OpenOutSend bridge remains ingest-only and exposes no email-send endpoint.
- The sender address alone does not verify reply routing or prove that a mailbox is actively being monitored. Replies to this Cidea address must be confirmed to arrive in a mailbox accessible to the reply detector before follow-ups can ever be considered.
- No DNS or MX changes are part of this phase.

Phase 11 remains IN PROGRESS until mailbox reply detection, reply-driven follow-up blocking, suppression behavior, monitoring, and final acceptance are verified.
