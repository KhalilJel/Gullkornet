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
