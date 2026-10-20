# Lite daily slot: 11:00-12:00 Oslo — 19 October 2026

Owner instruction: send up to 95 a day from Cidea Marketing, spread evenly between 11:00 and 12:00 Europe/Oslo, every day. Sends already in the account's rolling 24 h Resend ledger are subtracted from the 95. They are not added on top. Template, sender, recipient policy, reply check, DNC/reservations, business de-duplication, freshness, pre-send claim, idempotency keys and delivery-health stop are unchanged.

## How it runs

- `lite-outreach.yml` has five UTC triggers (08:35, 08:50, 09:35, 09:50, 10:05). In summer (UTC+2) the first four fall between 10:35 and 11:50 Oslo. In winter (UTC+1) the last three fall between 10:35 and 11:05. A trigger outside 10:30-12:00 Oslo ends before any provider or CRM call. A run that starts before 11:00 waits for it. The concurrency group runs one at a time. A later trigger in the same slot continues within the same limits, and after 12:00 it does nothing. The old `*/10 6-18` cron is removed.
- At the start the run reads the Resend ledger once. It sets `target = min(95, daily limit - sent in last 24 h, Resend daily quota - sent in last 24 h)` and spreads the target evenly over the rest of the slot (95 → about every 38 s). Every gate runs before the wait, so the wait absorbs gate time. A slow queue sends fewer and never sends after 12:00. The minimum spacing is 30 s.
- Job timeout: 105 minutes (30 min lead + 60 min slot + setup).
- Hourly limit, maximum per run and spacing are fixed in the workflow. The repository variables `GULLKORNET_LITE_MAX_PER_RUN` (2) and `GULLKORNET_LITE_HOURLY_LIMIT` are no longer read. `GULLKORNET_LITE_DAILY_LIMIT`, `RESEND_DAILY_QUOTA` and `RESEND_MONTHLY_QUOTA` still are. 95 × 31 = 2945 fits the 3000/month plan.
- Manual `one_off_date` (today in Oslo) runs the owner's one-off. It sends now under the same limits, spread over 60 minutes. A different date refuses.

## Rolling 24 h conflict

Both the daily limit and the Resend quota check count the last 24 hours, not the calendar day. An afternoon one-off therefore holds back the next day's 11:00 slot. Every email sent at, say, 17:30-18:30 still counts at 11:00-12:00 the next day. If the one-off sends the day's full 95, the next day's slot sends nothing. Normal operation resumes the day after. This is deliberate: it respects the provider limit instead of treating 11:00 as a fresh day.

Stop: set `GULLKORNET_LITE_ENABLE_LIVE_SEND` to anything but `true`.

## Delivery-health stop (targeted, 19 October 2026)

The run checks the last 30 days of Resend history before it reads the queue:

- A spam complaint or a provider send failure in the last 24 h stops all sending.
- A bounce in the last 24 h that is not confirmed permanent also stops all sending. "Confirmed permanent" means Resend type `Permanent`, or an SMTP code for a non-existent mailbox (5.1.1/2/3/6/10, or Microsoft's "550 5.4.1 Recipient address rejected"). `Undetermined` and `Transient` bounces count as unconfirmed.
- More than 2 recipient-scoped failures in 24 h stop all sending (burst).
- A 30-day failure rate (bounced, suppressed or complained) above 4 % over at least 50 emails stops all sending.
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
  - 22 October onwards: 95 a day, with no message over 95 in any rolling 24 h and at least 30 s between messages (tested).

**Monitoring.**
- `Gullkornet Lite Readiness`, before the slot, never sends or writes. It runs every gate over the first 150 Lite Ready rows and fails unless at least 115 are eligible. It also prints the queue size, days of supply and the first research expiry.
- `Gullkornet Lite Daily Report`, after the slot, prints the Lite messages accepted by Resend in the slot, their latest delivery event, the capacity and what is missing. A missed start or a shortfall fails the job.
- Both open the existing pipeline alert issue on failure.
- Every live run prints wall time per dependency: delivery health, Airtable lookup and claim, reply check, Brreg, DNS and Resend send.
