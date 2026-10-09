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

1. ✅ CI on current code: typecheck, full test suite, Phase 11 readiness, Phase 10 E2E and KeeLead Live Acceptance all pass at `b687c81d1f7d94f1dcd4abc6de20b89cc69d5a97`.
2. ✅ The same tested branch head is pinned and deployed to the existing Railway `openoutreach` service; deployment `a3353fa7-bf4a-4af4-b5a5-dd98e0adf7d9` succeeded and `/health` returned 200.
3. ✅ Read-only monitor remains healthy. Prior controlled runtime acceptance confirmed `mode=read_only_reply_check`, `send_triggered=false`; the pilot recipient lookup found no inbound message at that check time. Positive reply, provider failure and stale-monitor cases are covered by tests and block the guarded CLI.
4. ✅ No-send acceptance tests cover caps (3 per run maximum configured; 3/hour; 10/24h), recent recipient duplicate blocking, suppression, missing/stale reply monitor and the master kill switch. Batch sender remains hard-disabled.
5. ✅ Tests cover exact Airtable approved-record identity and setting that exact record to `Sent` after Resend accepts. CRM failure is handled as manual reconciliation, and its regression test passes.
6. ✅ Monitoring documentation now accurately describes Railway health/IMAP scan logs, Resend event history and Airtable status fields. No central alerting dashboard has been added.
7. Remaining: final documentation commit and final re-run of CI/runtime health on the doc-updated head. PR #70 must not merge until that final set passes.

## Phase 11 status

**IN PROGRESS.** One pilot email was delivered and its Airtable record is `Sent`. The read-only IMAP monitor and authenticated reply-status endpoint passed runtime acceptance. The latest source is deployed to Railway and the latest CI suite is green at `b687c81d1f7d94f1dcd4abc6de20b89cc69d5a97`. The kill switch, no-send default, suppression, rate limits, duplicate blocking, reply blocking and exact CRM post-send persistence have regression coverage. Final doc-head CI/runtime verification and PR #70 signoff remain. No extra prospect email was sent during testing, no DNS/MX change occurred, no secrets were committed. Phase 12 stays locked.
