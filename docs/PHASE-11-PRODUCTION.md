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
- The single-recipient CLI checks the kill switch before any provider or CRM calls and queries Resend email history before a live send. Missing/malformed pagination state, empty pages with more history, provider errors, invalid timestamps or incomplete history fail closed.
- The live CLI requires exactly one matching Airtable record with Lead Status = Approved, Review Status = Ready for outreach and Do Not Contact not enabled; the exact approved record ID is returned, validated and used for post-send persistence. Missing credentials, CRM errors, duplicate matches, invalid IDs or status mismatch fail closed.
- Before send, the CLI checks local suppression, authenticated reply status, recent Resend history for duplicate recipient sends, and the shared per-hour/per-day limits. A reply, an unavailable/stale monitor, a malformed reply response, or an already-sent recipient blocks the send.
- After Resend accepts an email, the CLI updates that exact Airtable record to Lead Status = Sent and verifies the returned status. If persistence fails after Resend accepted, it logs the Resend email ID and demands manual reconciliation before retry.
- The older OpenOutreach client send method is hard-disabled during Phase 11 even if its legacy environment switch is set. Only the separately guarded one-recipient CLI path remains available; the HTTP bridge still has no sending endpoint.
- Regression tests cover kill-switch behavior, hourly/daily caps, invalid/incomplete Resend history and pagination, recent duplicate recipients, Airtable approval/record identity/mark-Sent persistence, local and CRM suppression, reply true/false/provider errors, stale monitor health, and the disabled batch path.
- The legacy batch sender remains disabled; its accepted production batch cap is not opened by this change.

## Additional safety findings

- The legacy `send:daily` command was found to allow batches up to 20 without the Phase 11 recipient review gate or durable hourly/daily rate-limit enforcement. Historical Resend records confirm prior batch activity, so this path must not be used.
- The legacy batch CLI is now hard-disabled in source during Phase 11, and a regression test asserts the lock. The GitHub Actions batch workflow remains disabled with `if: ${{ false }}`.
- Airtable's existing `Sent` statuses are not a reliable timestamp ledger: many records have no send timestamp and some notes still describe drafts as unsent. Resend is the better historical source, and any future limits must use a durable, reconciled send ledger rather than trusting the Airtable status alone.
- Railway `openoutreach` runs the read-only IMAP monitor with `OPENOUTREACH_REPLY_MONITOR_ENABLED=true`, a 300-second interval, and the Cidea mailbox identity configured. Runtime logs show startup `status=starting` followed by repeated `status=running error=none`; the monitor executes IMAP sync/classify/project only and never invokes `outsend send`.
- The authenticated `/v1/reply-status` endpoint is deployed on the existing Railway service. Synthetic runtime acceptance returned HTTP 200 with `mode=read_only_reply_check` and `send_triggered=false`.
- The same controlled runtime check queried the pilot recipient and logged `replied=false` without exposing the address or message contents. This means no inbound message from that sender was found in any selectable folder at the time of the check; it does not prove the absence of all future replies.
- Startup acceptance created a synthetic `example.invalid` lead in the OpenOutSend ingest store only. It did not trigger sending. `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST` was then reset to `false` and the pilot-address override reset to empty, followed by a successful restart.
- Mailopoly is not used for the reply monitor; its inactive subscription does not block the direct OpenOutSend IMAP monitor. The deployed reply-status endpoint fails closed if monitor health is stale, the mailbox is mismatched, the IMAP query fails, or the response is malformed.
- No additional prospect emails were sent while carrying out this audit and hardening.

## Remaining Phase 11 acceptance blockers

1. Finish CI on the newest branch head after the duplicate-recipient, post-send Airtable persistence and strict-pagination additions.
2. Deploy that exact tested SHA to the existing Railway `openoutreach` service, run the read-only monitor health check and the synthetic authenticated reply-status acceptance, then ensure acceptance mode is disabled and service health remains green.
3. Preserve the confirmed no-send runtime result: synthetic reply lookup returned `send_triggered=false`; the pilot sender query returned `replied=false`. Verify the simulated positive-reply, provider-failure and stale-monitor unit cases still block the guarded CLI.
4. Complete no-send validation of rate limits (3 per run, 3 per hour, 10 per rolling 24 hours), recipient duplication, suppression and master kill switch. The current live entry point is single-recipient only; batch sending remains disabled.
5. Verify Airtable post-send persistence tests and the manual-reconciliation path on CRM update failure. Never retry a provider-accepted send without reconciling the Airtable state and provider email ID.
6. Finalize monitoring documentation: Railway health and IMAP sync/classification counts, Resend send/delivery/bounce event history, Airtable `Sent`/`Replied`/`Suppressed` state, and sanitized blocked-send errors. No central alerting dashboard has been added.
7. Run final acceptance on the latest SHA, capture green CI/runtime evidence, make the final GitHub commits, and merge PR #70 only after every acceptance gate passes.

## Phase 11 status

**IN PROGRESS.** The one pilot email is delivered and Airtable is `Sent`. Railway's read-only IMAP monitor and authenticated `/v1/reply-status` endpoint passed runtime acceptance; synthetic lookup returned `send_triggered=false`, and the pilot recipient lookup returned `replied=false`. Startup acceptance flags were reset after each run. The newest source now adds stale-monitor rejection, duplicate-recipient blocking, strict Resend pagination, exact Airtable record binding and post-send `Sent` persistence; these newest changes are under CI and still require deployment/acceptance on the final SHA. Final no-send suppression/limit/kill-switch checks, monitoring documentation and final end-to-end signoff remain outstanding. Phase 12 stays locked.
