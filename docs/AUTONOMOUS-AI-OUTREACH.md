# Gullkornet autonomous AI outreach

## Approved operating rules

- Discover businesses across Norway and across the existing rotating business categories.
- Target at least 50 eligible first-contact emails per day when the qualified queue supports it. Never lower the evidence, recipient, opt-out, duplicate, reply, or suppression checks to reach the target.
- Send only to public, role-based business inboxes on the same domain as the official business website. Do not guess addresses or address named individuals.
- Send Monday–Friday from 09:00 to 15:00 Europe/Oslo, with at least five minutes between messages.
- Use `hello@cideamarketing.com`, one email per business, and no automatic follow-up.
- Stop or hold a record when evidence, identity, contact source, or AI confidence is uncertain. Require AI confidence of at least 0.90 for an eligible decision.
- Honor Airtable `Do Not Contact`, the reply-status service, suppression lists, and provider send history. A reply, opt-out, duplicate, complaint, or delivery failure must block further outreach.
- Keep the human-only `Verified Observation` field blank. AI decisions are stored separately.

## AI review fields

The Gullkornet Lead Registry now has dedicated fields for `AI Decision`, `AI Confidence`, `AI Evidence`, `AI Evidence URL`, `AI Decision Reason`, `AI Draft Subject`, and `AI Draft Body`.

The Airtable automation **Gullkornet AI Outreach Assessment** reviews changed research records and writes those fields. It does not write the human-only observation or send email. The automation is currently a draft and remains off until enabled in Airtable.

The sender requires an exact AI decision of `APPROVE`, confidence at least 0.90, evidence copied from the research record, an evidence URL on the official website, a matching shared inbox, an opt-out instruction, no suppression, and no reply. New research syncs reset any old AI approval before the Airtable automation can reassess the record.

## Current implementation status

- Google Places discovery now searches 15 markets spanning Norway. The current category rotation remains in place.
- The Airtable AI fields and assessment automation draft are created.
- The sender now reads AI-generated subject/body and checks the AI decision and its supporting evidence.
- The live-send kill switch remains required. No email was sent by this change.
- The scheduled workflow still has its existing one-email-per-day setting. The requested 50/day target is not yet implemented; the automated review rejected the proposed increase in sending capacity. See the pending approval item before changing those limits.
- Existing Oslo records need a fresh AI assessment after the Airtable automation is enabled; their earlier human-review status is not an AI decision.

## Verification

`npm run typecheck` passes and the full Node test suite passes: 172 tests.
