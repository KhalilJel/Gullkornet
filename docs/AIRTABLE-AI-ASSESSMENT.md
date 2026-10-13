# Airtable AI Outreach Assessment: trigger recommendation and safe first test

Status (2026-10-13): recommendation only. The automation "Gullkornet AI Outreach Assessment" is unpublished and has not been edited, published or run by Claude. Its live configuration uses a `recordUpdated`-style trigger, which does **not** fire for a row that is created already complete, and the research sync creates rows programmatically. All 10 rows from run `38383510756` therefore sit at `AI Decision=NEEDS_REVIEW`, `AI Confidence=0`.

## What protects sending regardless of the AI

The assessment is advisory. The sender decides deterministically in code (`tests/send-gates.test.ts`, one test per case) and refuses on: Do Not Contact; any status other than `Draft Ready`; `AI Decision` other than `APPROVE`; confidence below 0.90 or non-numeric; missing or mismatching AI evidence; missing evidence URL or one on another site; contact source or e-mail domain not matching the official website; personal (freemail) or named-person addresses; draft without opt-out; `STRATEGIC_ACCOUNT`; another contacted/replied/suppressed record at the same business domain; an earlier reply (reply-status service); a send in the last 24 h to the same address; the 09:00-15:00 Europe/Oslo weekday window; five-minute spacing; 12/hour; 100/day; one per run. A record that fails a per-record rule is skipped and the next one is tried; an Airtable or reply-service outage stops the run (never read as "allowed"). Preview without any send path: `npm run send:preview` (read-only counts).

## Recommended trigger

Use **"When a record matches conditions"** instead of "When record updated", with conditions:

- `Lead Status` is `Draft Ready`
- `AI Decision` is `NEEDS_REVIEW`
- `Email` is not empty
- `AI Draft Body` is empty

Per Airtable's documentation this fires when a record *enters* the matching state, including a record that is **created** matching (the research sync does exactly that); confirm it once with a single new test row before relying on it, and again when a later research refresh resets the AI fields. It does not fire for `Needs Review` or `No Public Email` rows, so the personal Gmail address and the domain-mismatch address (both `Needs Review`) are never assessed or drafted. Actions stay as today: write only the `AI *` fields; never write `Lead Status`, `Verified Observation` or `Do Not Contact`, and never send. Keep the prompt instruction that anything uncertain returns `NEEDS_REVIEW`; the sender does not rely on it.

## Safe one-time assessment of the existing rows

Records that already match when an automation is published are not picked up by a "matches conditions" trigger. Only 1 of the 10 rows is `Draft Ready`, and only `Draft Ready` rows are worth assessing.

1. Leave `GULLKORNET_ENABLE_LIVE_SEND` as it is (not `true`): the sender is a no-op, so nothing can be sent while testing.
2. In the automation editor use **Run test** on the single `Draft Ready` row. This writes only the `AI *` fields of that row (a real, but harmless and reversible, write; no e-mail). Do not publish yet.
3. Inspect the result: `AI Decision`, `AI Confidence` (needs >= 0.90 to count), `AI Evidence` copied from the row's `Personalization Evidence`, `AI Evidence URL` on the company's own site, `AI Draft Subject/Body` with an opt-out sentence.
4. Run `npm run send:preview` locally (needs your own `AIRTABLE_API_TOKEN` and `GULLKORNET_AIRTABLE_BASE_ID`; optionally the reply-status variables). It prints how many queue rows would pass every sender gate, counts only, no writes. Expect `eligible` 0 or 1.
5. Only then publish the automation (owner decision). New rows from later research syncs are then assessed automatically.

## Gates that remain with Khalil

Publishing the automation; any Airtable write (including Run test); setting `GULLKORNET_ENABLE_LIVE_SEND=true`; enabling the scheduled pipeline (see `docs/GO-LIVE-RUNBOOK.md`).
