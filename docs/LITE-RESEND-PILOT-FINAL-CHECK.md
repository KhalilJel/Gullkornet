# Final Resend pilot check

## Owner confirmation received 16 October 2026

The owner explicitly states the agreement is confirmed. This records their attestation; no contract contents have been independently inspected. The earlier pending-agreement entries below are historical. The implementation now permits only the fixed five reviewed record IDs, template .6, at most five/day and one/run. Increasing the environment limits does not expand the pilot; it fails before network access. No arbitrary queue recipients can enter this live pilot.

Manual workflow dispatch with preview=false and pilot_send=true enables that one bounded run without changing the persistent live secret. Scheduled runs remain no-ops while the secret is absent. Explicit preview selections cannot be passed to live workflow runs. The operator verifies the first message result before dispatching another. Existing source/recipient/status/reply/research/history/idempotency/pre-send-claim controls remain in place. The owner has already authorized the pilot; no new approval is required for its unchanged scope. No 95/day activation or new cost is included.

Resend is the owner's chosen channel. Mailreef is not connected; do not continue vendor migration or purchase work. The owner handles the requested Resend exception and privacy/marketing-information follow-up. Explicit authorization for the controlled pilot has already been given; do not request the same authorization again. The exception itself is not yet confirmed. The unconditional provider refusal in send-lite.ts and existing live switches remain unchanged in this preparation.

## Exact read-only preview

Use the existing Lite Outreach workflow with preview=true, preview_limit=5 and preview_record_ids containing 1–5 comma-separated Airtable record IDs. This reads exactly those records in selected order, including rows that are now blocked, and runs the normal fresh lookup, recipient/status/DNC, research, Brreg/MX, reply and send-history checks. Missing/unexpected/duplicate/paginated rows fail closed. It never replaces a rejected recipient with another lead. It never sends or writes, and its selection option is rejected outside preview mode. Counts only are logged.

Local equivalent: npm run send:lite -- --preview --limit 5 --preview-record-ids <comma-separated-record-IDs>. No addresses belong in the public runbook. The local candidate assessment is working evidence, not a human-verified observation or a live allowlist. A clean preview means technical eligibility, not provider acceptance or verified delivery. Existing without-selection previews still read the oldest queue rows.

Workflow inputs are passed through environment variables and quoted arguments, not interpolated into shell source. Do not add a selectable live recipient list or a provider bypass based on an unconfirmed agreement.

## Remaining activation sequence

1. Receive the actual Resend exception and confirm the applicable account, sender, recipient type and limits. Owner is handling the external agreement; do not contact Resend on their behalf.
2. Replace the unconditional provider refusal only to reflect the confirmed agreement. Keep template2026-10-15.6 and existing recipient, reply, suppression, timing, rate, pre-send claim and idempotency controls. Run tests and CI for that concrete change.
3. Run fresh exact preview of the final pilot records and verify current quota and authenticated reply monitoring. Pilot limits remain five/day, one/run; scaling to95/day is separate. A limit of95/day requires2945 sends over31days plus headroom for all other account use.
4. Activate only within approved configuration scope and sending window. Send one pilot message, verify its provider result and delivery before the next. Never automatically reset a claimed row or retry a send with unknown outcome. Preserve prior-contact and reservation evidence.
5. Verify reply/bounce handling and continued suppression, document actual pilot results, and only then assess unattended operation and scaling. The lead-buffer goal700 does not block a five-recipient pilot.

No production send, CRM mutation, secret/DNS change or deletion is performed by this document or exact preview feature.
