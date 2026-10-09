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
- The single-recipient CLI checks the shared kill switch and queries Resend email history before a live send. If Resend is unavailable, history is malformed, the cursor is missing, or a complete 24-hour window cannot be established within the bounded page count, the CLI refuses the send.
- The live CLI now requires one exact Airtable record for the recipient with Lead Status = Approved, Review Status = Ready for outreach, and Do Not Contact not enabled. Missing credentials, an Airtable error, duplicate matches, or a status mismatch fail closed.
- The older OpenOutreach client send method is hard-disabled during Phase 11 even if its legacy environment switch is set. Only the separately guarded one-recipient CLI path remains available.
- Added regression tests for kill-switch behavior, hourly/daily caps, invalid timestamps, incomplete send history, provider failures, Airtable recipient approval, suppression, and the single-recipient per-run configuration.
- The legacy batch sender remains disabled; its accepted production batch cap is not opened by this change.

## Additional safety findings

- The legacy `send:daily` command was found to allow batches up to 20 without the Phase 11 recipient review gate or durable hourly/daily rate-limit enforcement. Historical Resend records confirm prior batch activity, so this path must not be used.
- The legacy batch CLI is now hard-disabled in source during Phase 11, and a regression test asserts the lock. The GitHub Actions batch workflow remains disabled with `if: ${{ false }}`.
- Airtable's existing `Sent` statuses are not a reliable timestamp ledger: many records have no send timestamp and some notes still describe drafts as unsent. Resend is the better historical source, and any future limits must use a durable, reconciled send ledger rather than trusting the Airtable status alone.
- Railway `openoutreach` runs the read-only IMAP monitor with `OPENOUTREACH_REPLY_MONITOR_ENABLED=true`, a 300-second interval, and the Cidea mailbox identity configured. Runtime logs show startup `status=starting` followed by repeated `status=running error=none`; the monitor executes IMAP sync/classify/project only and never invokes `outsend send`.
- The deployed service still needs the latest branch build before the new authenticated `/v1/reply-status` endpoint is live. The branch endpoint searches the monitored INBOX read-only for mail from a recipient and fails closed if the monitor or IMAP lookup is unhealthy.
- Mailopoly is not used for the reply monitor; its inactive subscription no longer blocks the direct OpenOutSend IMAP monitor. The separate live reply-status check still needs deployed-runtime acceptance.
- No additional prospect emails were sent while carrying out this audit and hardening.

## Remaining Phase 11 acceptance blockers

1. Deploy the latest Phase 11 branch to the existing Railway `openoutreach` service so the authenticated `/v1/reply-status` endpoint is actually live; confirm health status and IMAP lookup success after rollout.
2. Verify the reply-status endpoint against a controlled synthetic lookup and the pilot recipient without sending mail. Confirm `replied=true` blocks the guarded CLI, `replied=false` proceeds only to the remaining gates, and timeout/provider/monitor failures all block sending.
3. Complete runtime acceptance of Resend-history-backed caps: maximum 3 per run, 3 per hour, and 10 per rolling 24 hours. No send is needed to test the boundaries; reconcile historical send activity before relaxing the batch lock.
4. Run end-to-end suppression acceptance across the local suppression list, Airtable Do Not Contact and approval state, including provider/CRM failures.
5. Verify the master kill switch and confirm scheduled/batch and OpenOutSend send paths remain disabled.
6. Confirm production monitoring exposes accepted, delivered, replied, suppressed, and blocked health signals without logging secrets or message content.
7. Run final end-to-end acceptance, record CI/runtime evidence, commit the signoff, and merge this PR only after all gates pass.

## Phase 11 status

**IN PROGRESS.** The first controlled email is delivered; legacy batch/OpenOutreach send paths are hard-disabled; the guarded CLI requires Airtable approval, suppression, Resend-history rate limits, and the kill switch. The read-only IMAP monitor is active in Railway and runtime logs show successful sync/classify/project cycles. The branch now includes an authenticated read-only reply-status endpoint and a fail-closed pre-send gate, but that updated endpoint has not yet been deployed and accepted in production. Complete suppression and monitoring acceptance plus final end-to-end acceptance remain outstanding. Phase 12 remains locked.
