# Phase 11 — Production

Status: COMPLETE on main (current runtime safety-flag values require direct Railway UI verification before any future live send)
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
- The previous acceptance recorded `OPENOUTREACH_ALLOW_SEND=false`; the current Railway connector redacts variable values, so its present value must be verified directly in the Railway UI before any future live send.
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

## Final Phase 11 acceptance — 2026-10-09

**Phase 11: COMPLETE on `main`.**

### Verified outcome
- Exactly one approved production pilot email was sent from `jelassi@cideamarketing.com` to M-K Renhold AS. Resend status was verified as `delivered`, and the corresponding Airtable record is `Sent`.
- No additional prospect emails were sent during Phase 11 hardening and acceptance.
- Railway `openoutreach` is deployed from the Phase 11 branch commit `30358eb488072a7893d385ac83cc78226486f768`; deployment `71dad39b-f961-4e9f-9b3b-23d0a76b9d55` completed successfully, the service is live, and the `/health` healthcheck passed.
- The read-only IMAP reply monitor reports `status=running error=none` every five minutes.
- The authenticated `POST /v1/reply-status` runtime acceptance returned HTTP 200 with `mode=read_only_reply_check` and `send_triggered=false`. The pilot address lookup returned `replied=false` at that time; this is not a guarantee about future mail.
- Synthetic acceptance was limited to an `example.invalid` lead in the ingest store. `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST` was reset to `false` and the pilot-address override was cleared, followed by successful deployment/health verification.
- The HTTP bridge exposes no send endpoint and `OPENOUTREACH_ALLOW_SEND=false` remains the production configuration. The legacy batch sender and scheduled batch workflow remain disabled.
- The guarded single-recipient CLI fails closed unless kill switch, exact Airtable approval, explicit unsuppressed state, reply-status health, duplicate-send prevention, Resend send-history completeness, idempotency and rate limits pass. Default mode is dry-run; bulk mode is hard-disabled.
- Production limits are fixed at maximum 3/hour and 10 per rolling 24 hours. The CLI currently limits a run to one recipient; no bulk ramp is enabled.
- Regression coverage includes kill switch, dry-run behavior, suppression, positive/negative/unavailable/stale reply checks, provider failure, recent duplicate recipients, strict pagination, 3/hour and 10/24-hour caps, Airtable record identity, and post-send `Sent` persistence/manual reconciliation.
- The full test suite, typecheck, Phase 11 readiness, Phase 10 E2E, KeeLead Live Acceptance and OpenOutSend reply-monitor workflow passed on the final acceptance branch before merge. CI and KeeLead Live Acceptance also passed on the merge commit `5efcb4a0c5ecde7e5815eddaec68a398c2de0976`.
- No DNS/MX changes were made and no secrets were committed.

### Operating boundary
Phase 11 completion means the controlled one-recipient production pilot and safety acceptance have passed. It does **not** authorize bulk production sending. `GULLKORNET_ENABLE_LIVE_SEND` remains false by default, and any future real send still requires the explicit guarded single-recipient path. No central alerting dashboard was built; observability is via service health/logs, Resend status/history and Airtable status.

PR #70 was squash-merged to `main`: `https://github.com/KhalilJel/Gullkornet/pull/70`.
Phase 12 may now be considered separately, but no Phase 12 implementation is included in this PR.

## Follow-up verification note — 2026-10-09

This note records the connector-based post-merge inspection performed after PR #70 was merged.

- Confirmed repository: `KhalilJel/Gullkornet`.
- PR #70 is merged to `main` with merge commit `5efcb4a0c5ecde7e5815eddaec68a398c2de0976`; branch head at merge was `30358eb488072a7893d385ac83cc78226486f768`.
- CI and KeeLead Live Acceptance passed on main commit `e080c0d1b2dd0c156162ebb15be8f574bc63d610`. The five Phase 11-related workflows (CI, Phase 11 readiness, Phase 10 E2E, KeeLead Live Acceptance and OpenOutSend read-only reply monitor) passed at branch head `30358eb488072a7893d385ac83cc78226486f768`.
- Railway project `powerful-patience`, production service `openoutreach` is configured from `KhalilJel/Gullkornet`, branch `phase11/production`, commit `30358eb488072a7893d385ac83cc78226486f768`. Deployment `71dad39b-f961-4e9f-9b3b-23d0a76b9d55` reports `SUCCESS`, the service is online with one running replica, and the configured healthcheck is `/health`.
- Railway HTTP metrics for the three-hour inspection window showed 80 successful 2xx GET requests to `/health`, with zero 3xx, 4xx or 5xx responses.
- Runtime logs repeatedly recorded `reply-monitor status=running error=none`. The metrics query recorded no `POST /v1/reply-status` requests during that window, so a fresh external endpoint acceptance was not observed in this follow-up.
- The Railway connector withheld all environment variable values. Therefore this inspection could confirm that the acceptance/send flag names exist, but could not independently re-confirm their current Boolean values, including `OPENOUTREACH_ALLOW_SEND` and `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST`. Do not treat historical reset evidence as proof of their current values; verify both directly in the Railway UI without exposing secret values before any future live send.
- The daily outreach workflow job is `skipped` on the inspected `main` commit; the workflow source retains a hard false condition on its sending job. The OpenOutSend bridge continues to expose no send endpoint by design.
- No production send, DNS/MX change, Railway configuration change, or secret disclosure was performed during this inspection.

This follow-up note is evidence about the checks above only; it does not authorize bulk sends or weaken any Phase 11 gate.
