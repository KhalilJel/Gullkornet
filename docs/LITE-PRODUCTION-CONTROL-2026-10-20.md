# Lite production control — 20 October 2026

All times below are Europe/Oslo unless explicitly UTC.

## Verified production outcome

- Authorized one-off [run 39417200564](https://github.com/KhalilJel/Gullkornet/actions/runs/39417200564) started at 13:45:13 and was cancelled at about 14:11:31 after 42 accepted messages. No replacement live run was started.
- Cancellation enforced the existing unknown-bounce stop while the provider classifications were unavailable through the connector. The provider details were subsequently obtained through the existing non-sending Delivery Check workflow.
- [Delivery Check with suppression](https://github.com/KhalilJel/Gullkornet/actions/runs/39420494546) verified Do Not Contact on both affected exact-address rows. The same-business gate blocks other addresses at those business domains.
- `01a15934-7da1-7efc-aa5a-c7e1f780a870`: Permanent / General; SMTP `553 5.3.0 … No such user here`; row `rechtFudvZ6SBbrMC` reserved and verified.
- `01a15922-92f0-785d-b678-a2c4347d3bf4`: Permanent / General; SMTP `550 5.4.1 Recipient address rejected: Access denied`; row `recSWVbng3UmtXxm2` reserved and verified.
- [Full 30-day check](https://github.com/KhalilJel/Gullkornet/actions/runs/39420895804) at 14:15:42 found no active targeted global stop: two recipient-scoped failures in 24 hours, and 9 failures / 275 counted messages = 3.27%, below 4%. Its 277 list entries include two cancelled messages excluded from that denominator. Older Undetermined bounces remain Undetermined.
- The initial seven-day diagnostic incorrectly labelled 4/61 as the 30-day failure rate. The CLI now always fetches the full 30-day history for policy assessment, regardless of the requested display range. This fixes reporting; thresholds are unchanged.

## Runtime correction

Before each live claim/send, after pacing, the runner refreshes provider history and delivery health, account-wide capacity, recipient/business reservation state and the recipient's reply status. Unavailable checks stop the run. Accepted local messages survive a lagging provider list so quota and duplicate protection cannot disappear. Provider health reads are sequential and spaced by at least 200 ms, below the verified 10 requests/second account limit. Missing reservation records now fail closed.

The approved sender, template with “dere”, company policy, idempotency keys, claim-before-send behavior and conservative handling of ambiguous send results are retained. There are no DNS/MX changes or changes to advanced outreach features.

## Measured reply-check improvement

Read-only previews now use the existing authenticated batch endpoint. Live sending never uses a preview snapshot and still makes a fresh per-recipient request after pacing.

- Before: [five-row preview on main](https://github.com/KhalilJel/Gullkornet/actions/runs/39421076338), 14:17:07–14:17:48. Five reply requests, 34.2 seconds total, mean 6.84 seconds; complete preview about 40.4 seconds.
- After: [five-row preview on the fix](https://github.com/KhalilJel/Gullkornet/actions/runs/39421410245), 14:19:52–14:20:02. One batch request, 5.01 seconds total; complete preview about 10.7 seconds. Both checked five rows, found five eligible, and sent/wrote nothing. This is one paired sample, not a load test or a measured improvement to live single-recipient latency.
- Railway HTTP logs independently show five before requests (6.58–7.01 seconds), versus one after request (4.868 seconds).
- IMAP egress flows to port 993 were grouped by distinct source connection port, combining partial and complete flow records. Before: five connections during 12:17:09–12:17:48 UTC (35770, 34708, 33490, 36432, 38600). After: one connection during 12:19:53–12:19:58 UTC (36766). Background monitor connections at 12:19:09–12:19:12 UTC were excluded. No credentials, message content, network addresses or recipient addresses are recorded here.
- Reply time for this preview fell about 85%; IMAP connections fell 80%. Fresh live reply checks remain one per prospective send and fail closed on service errors.

## Next scheduled window and capacity

The workflow is enabled (GitHub offers “Disable workflow”), has recent schedule-triggered runs, and main contains the five UTC cron triggers `08:35`, `08:50`, `09:35`, `09:50`, `10:05`. The code selects the 11:00–12:00 Oslo window, with a 30-minute early-start allowance. On 21 October, Oslo is UTC+2, so the first two triggers can start early and wait. GitHub scheduling is best effort; an exact start time is not guaranteed. The same concurrency group serializes previews, scheduled sends and manual sends.

Verified provider usage after the one-off: 42/100 daily and 275/3000 monthly; API limit 10 requests/second. Provider daily quota resets at 2026-10-20 23:59:59.999 UTC (21 October about 02:00 Oslo); monthly reset is 23 October 08:51:31 Oslo. Monthly headroom is 2725 messages.

Assuming no further account sends, all 42 accepted messages remain inside the rolling 24-hour window throughout 21 October 11:00–12:00. Thus the application limit allows at most `95 - 42 = 53` messages, despite the provider's new calendar-day allowance of 100. Actual capacity is recalculated from fresh account history; recipient gates, outages, new delivery events and queue availability can reduce it. No extra one-off was scheduled to fill the unused capacity today.

## Validation

- TypeScript typecheck passed.
- Local full TypeScript suite: 432 passed, two Windows/bash platform skips, zero failed.
- Local Python suite: 50 passed. The initial sandbox attempt was blocked by local socket/file restrictions; the same suites passed outside that restriction.
- Five new behavioral tests cover a mid-run delivery-health stop, reply outage after pacing, reservation during pacing, external account quota usage and provider-list lag.
- PR checks for commit `8d8b279`: CI, Phase 10, Phase 11 readiness, synthetic non-sending acceptance and KeeLead acceptance all passed.

Final delivery statuses are asynchronous and should be read from Resend separately from the fixed accepted count of 42. No claim of 42 delivered is made.
