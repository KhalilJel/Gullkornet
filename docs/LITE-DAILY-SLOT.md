# Lite daily slot: 11:00-12:00 Oslo — 19 October 2026

Owner instruction: send up to 95 a day from Cidea Marketing, spread evenly between 11:00 and 12:00 Europe/Oslo, every day. Sends already in the account's rolling 24 h Resend ledger are subtracted from the 95. They are not added on top. Template, sender, recipient policy, reply check, DNC/reservations, business de-duplication, freshness, pre-send claim, idempotency keys and delivery-health stop are unchanged.

## How it runs

- `lite-outreach.yml` has five UTC triggers (08:35, 08:50, 09:35, 09:50, 10:05). In summer (UTC+2) the first four fall between 10:35 and 11:50 Oslo. In winter (UTC+1) the last three fall between 10:35 and 11:05. A trigger outside 10:30-12:00 Oslo ends before any provider or CRM call. A run that starts before 11:00 waits for it. The concurrency group runs one at a time. A later trigger in the same slot continues within the same limits, and after 12:00 it does nothing. The old `*/10 6-18` cron is removed.
- At the start the run reads the Resend ledger. It sets `target = min(95, daily limit - sent in last 24 h, Resend daily quota - sent in last 24 h)` and sends as fast as Resend's API accepts (no fixed spacing since 21.10.2026; an HTTP 429 is waited out and repeated with the same idempotency key). When a limit is reached it waits for older sends to leave the rolling window if that happens before 12:00. Every check runs before that wait, so check time never carries into the next day. It never sends after 12:00.
- Job timeout: 105 minutes (30 min lead + 60 min slot + setup).
- Hourly limit, maximum per run and spacing are fixed in the workflow. The repository variables `GULLKORNET_LITE_MAX_PER_RUN` (2) and `GULLKORNET_LITE_HOURLY_LIMIT` are no longer read. `GULLKORNET_LITE_DAILY_LIMIT`, `RESEND_DAILY_QUOTA` and `RESEND_MONTHLY_QUOTA` still are. 95 × 31 = 2945 fits the 3000/month plan.
- Manual `one_off_date` (today in Oslo) runs the owner's one-off. It sends now under the same limits, spread over 60 minutes. A different date refuses.

## Rolling 24 h conflict

Both the daily limit and the Resend quota check count the last 24 hours, not the calendar day. An afternoon one-off therefore holds back the next day's 11:00 slot. Every email sent at, say, 17:30-18:30 still counts at 11:00-12:00 the next day. If the one-off sends the day's full 95, the next day's slot sends nothing. Normal operation resumes the day after. This is deliberate: it respects the provider limit instead of treating 11:00 as a fresh day.

Stop: disable the *Gullkornet Lite Outreach* workflow (and *Gullkornet Lite Clock*) in GitHub Actions. The `GULLKORNET_LITE_ENABLE_LIVE_SEND` switch was removed on 21.10.2026.

## Delivery-health stop (targeted, 19 October 2026)

The run checks the last 30 days of Resend history before it reads the queue:

- A spam complaint or a provider send failure in the last 24 h stops all sending.
- A bounce in the last 24 h that is not confirmed permanent also stops all sending. "Confirmed permanent" means Resend type `Permanent`, or an SMTP code for a non-existent mailbox (5.1.1/2/3/6/10, or Microsoft's "550 5.4.1 Recipient address rejected"). `Undetermined` and `Transient` bounces count as unconfirmed.
- More than 2 recipient-scoped failures in 24 h stop all sending (burst).
- (Removed 21.10.2026) There is no failure-rate stop; every bounce is registered and its recipient reserved.
- A confirmed-permanent bounce or a Resend `suppressed` event is recipient-scoped. Do Not Contact is ticked and verified on the exact-address rows, which also blocks the business domain, and sending continues.

`Gullkornet Lite Delivery Check` prints the verdict ("targeted policy") and each event's bounce type and SMTP code, without addresses.

## Reliable daily start and steady 95 (20 October 2026)

**Why scheduled runs did not start.** GitHub delivers this repository's scheduled events hours late and drops most of them. Measured 14–20 October: `lite-reply-sync` (cron hourly 07–21 UTC) actually started 3–4 times a day, at times such as 00:18, 12:42, 14:39 and 20:34 UTC, some outside its cron hours. The five 08:35–10:05 UTC Lite triggers produced no run at all on 20 October. A run that arrived after 12:00 Oslo simply no-oped.

**Fix.**
- Triggers run every 30 minutes from 00:07 to 10:37 UTC.
- A scheduled run may start up to 285 minutes before 11:00 Oslo and wait. The job limit is 355 minutes, inside GitHub's 6 h limit. The repository is public, so waiting costs no Actions minutes.
- The concurrency group keeps exactly one live run. A later arrival, or the owner's reserve dispatch, either continues the same slot with the capacity left or no-ops.
- Manual runs keep the 30-minute lead.

**Capacity across days.**
- The target is the daily limit minus the account messages that will still count when the slot ends.
- Each send checks the rolling limits at its own moment. When yesterday's slot messages are still inside 24 h, the run waits for the next one to roll out, but only if that happens inside the slot.
- A delivery-health stop that lifts inside the slot (24 h after the failed email) is waited out. A stop that outlasts the slot, or any new event, still stops the run.
- Result:
  - 21 October: target 53, because the 42 one-off messages from 20 October still count.
  - 22 October onwards: 95 a day, with no message over 95 in any rolling 24 h (tested; no fixed spacing since 21.10.2026).

**Monitoring.**
- `Gullkornet Lite Readiness`, before the slot, never sends or writes. It runs every gate over the first 150 Lite Ready rows and fails unless at least 115 are eligible. It also prints the queue size, days of supply and the first research expiry.
- `Gullkornet Lite Daily Report`, after the slot, prints the Lite messages accepted by Resend in the slot, their latest delivery event, the capacity and what is missing. A missed start or a shortfall fails the job.
- Both open the existing pipeline alert issue on failure.
- Every live run prints wall time per dependency: delivery health, Airtable lookup and claim, reply check, Brreg, DNS and Resend send.

## Owner decision 21.10.2026: retained rules only

Removed (self-imposed send stops):
- The fixed stop at more than 2 recipient failures in 24 h.
- The automatic global stop after one isolated bounce (any type). Every bounce and every Resend suppression now reserves the recipient: Do Not Contact on the exact-address row, verified from Airtable before the run continues; the send-time lookup then blocks every row on the same business domain. The bounce is not reclassified (Undetermined stays Undetermined).
- Market research as a condition for sending (research files and the research workflow remain as documentation).
- The 30-second minimum spacing. Resend's real API limit applies: a 429 is waited out and repeated with the same idempotency key.
- The live switch `GULLKORNET_LITE_ENABLE_LIVE_SEND`, and the 60-minute limit on manual one-offs. A one-off (`one_off_date` = `now` or today's Oslo date) starts at once at any time of day and sends until its capacity is used (bounded only by the 105-minute manual job timeout).

Retained:
- 95 per rolling 24 h, 95 per hour, 95 per run; Resend's real daily/monthly quota and API limit.
- Stop when the queue is empty or no remaining recipient passes the retained checks.
- Do Not Contact, earlier contact and replies block the recipient; duplicates by address, business and earlier send.
- Lite Ready status, Lite marker and exactly one row per address.
- The recipient filter (AS/ASA, role address, no free mail, domain matches the website, company still active with a mail server) — markedsføringsloven § 15.
- Global stop on a spam complaint or a provider send failure in the last 24 h. The 30-day failure-rate stop (4 %) was also removed later on 21.10.2026 by the owner, with no replacement threshold.
- Idempotency (claim before send, idempotency key), outage = fail closed, secrets only in GitHub secrets.
