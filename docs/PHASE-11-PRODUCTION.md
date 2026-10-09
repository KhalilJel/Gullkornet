# Phase 11 — Production

Status: IN PROGRESS
Started: 2026-10-09

## Objective

Move Gullkornet from verified dry-run behavior to a tightly controlled production pilot with real sending, while keeping explicit human approval, suppression, idempotency, rate limits and an immediate kill switch.

## Locked safety boundaries

- No bulk production sending.
- First live send is limited to an explicitly approved recipient.
- No automatic 50–100/day ramp during the first acceptance.
- No DNS/MX changes.
- No secrets committed to GitHub.
- Production sender must be the verified Cidea domain.
- Every live send requires explicit runtime enablement, exact recipient approval, recipient review, suppression clearance and an idempotency key.
- Phase 12 remains locked.

## Step 1 — Production readiness audit

Verified from `main`:

- Phase 10 completed and merged.
- CI and KeeLead acceptance green on the Phase 10 merge.
- OpenOutSend Railway runtime healthy.
- `OPENOUTREACH_ALLOW_SEND=false` remains configured in the existing runtime.
- OpenOutSend bridge is still ingest-only.
- Resend reports `cideamarketing.com` as verified and sending-enabled.
- No DNS/MX changes were made.

Important architecture finding:

The current OpenOutSend HTTP bridge intentionally exposes only ingest and explicitly returns `send_triggered=false`. Therefore Phase 11 cannot safely claim production sending through that bridge until a separate production send boundary is implemented and tested.

## Step 2 — Production send configuration

Implemented on the Phase 11 branch:

- Default sender changed from the legacy SmartSvar address to `jelassi@cideamarketing.com`.
- The verified Cidea domain is confirmed active in Resend.
- Existing outbound gate remains explicit and fail-closed.

## Step 3 — Production send guard

The existing live-send guard requires:

- `GULLKORNET_ENABLE_LIVE_SEND=true`
- exact `GULLKORNET_APPROVED_RECIPIENT`
- `GULLKORNET_RECIPIENT_REVIEWED=true`
- verified `RESEND_API_KEY`
- Cidea sender
- suppression clearance
- `GULLKORNET_SEND_IDEMPOTENCY_KEY`

Phase 11 tests add regression coverage for every gate.

## First controlled production send

Pilot recipient: M-K Renhold AS

The record was explicitly approved in Airtable before sending. The single pilot was sent from the verified Cidea sender using Resend with an idempotency key.

Result:

- Resend accepted the message.
- Resend status verified as delivered.
- Airtable lead state changed to Sent.
- No follow-up was authorized automatically.
- No second recipient was contacted.
- No DNS/MX changes.

The OpenOutSend bridge remains ingest-only. The pilot was deliberately sent through the separately guarded Resend production boundary rather than bypassing the ingest-only bridge.

## Rate limit and kill-switch implementation

- Added a shared Phase 11 policy with hard maximums of 3 per run, 3 per hour and 10 per 24 hours.
- The single-recipient CLI now checks the live-send kill switch and queries Resend email history before a live send. If Resend is unavailable, history is malformed, the cursor is missing, or a complete 24-hour window cannot be established within the bounded page count, the CLI refuses the send.
- Added regression tests for kill-switch behavior, hourly/daily caps, invalid timestamps and the single-recipient per-run configuration.
- The legacy batch sender remains disabled; its accepted production batch cap is not opened by this change.

## Additional safety findings

- The legacy `send:daily` command was found to allow batches up to 20 without the Phase 11 recipient review gate or durable hourly/daily rate-limit enforcement. Historical Resend records confirm prior batch activity, so this path must not be used.
- The legacy batch CLI is now hard-disabled in source during Phase 11, and a regression test asserts the lock. The GitHub Actions batch workflow remains disabled with `if: ${{ false }}`.
- Airtable's existing `Sent` statuses are not a reliable timestamp ledger: many records have no send timestamp and some notes still describe drafts as unsent. Resend is the better historical source, and any future limits must use a durable, reconciled send ledger rather than trusting the Airtable status alone.
- The currently deployed Railway `openoutreach` service starts only `python /app/openoutsend_ingest_api.py`. It is an ingest-only HTTP service, not an active mailbox polling worker. Therefore reply detection is not currently running in this runtime.
- Mailopoly inbox access currently returns `subscription_inactive`, so it cannot be used to verify the pilot's mailbox replies right now.
- No additional prospect emails were sent while carrying out this audit and hardening.

## Remaining Phase 11 acceptance blockers

1. Implement a real mailbox reply detector using an available, authenticated mailbox interface.
2. Store and process reply events so a reply blocks all follow-ups, and test that behavior end to end.
3. Implement a durable send ledger and enforce the agreed limits: maximum 3 per run, 3 per hour, 10 per day. Reconcile historical activity before calculating current limits.
4. Verify suppression is fail-closed across persistent Do Not Contact flags and the suppression list, including provider or Airtable failures.
5. Prove the kill switch blocks all send paths, not only the paused workflow.
6. Add production monitoring for accepted, delivered, bounced, replied, suppressed, and blocked events.
7. Run final end-to-end acceptance, record CI/runtime evidence, commit the signoff and only then merge this PR.

## Phase 11 status

**IN PROGRESS.** The first controlled email is delivered and the legacy batch sender is now hard-disabled. Reply detection, durable global rate limits, complete suppression integration, kill-switch acceptance, and production monitoring are not yet proven. Phase 12 remains locked.
