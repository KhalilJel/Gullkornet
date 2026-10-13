# Gullkornet autonomous AI outreach

## Approved operating rules

- Discover businesses across Norway and across the existing rotating business categories. Qualification (`evaluateLeadQualification`) is Norway-wide by default; the former Oslo-area default was removed. A restriction only applies when a caller passes `targetGeographies`.
- Target at least 50 eligible first-contact emails per day when the qualified queue supports it. Never lower the evidence, recipient, opt-out, duplicate, reply, or suppression checks to reach the target.
- Send only to public, role-based business inboxes on the same domain as the official business website. Do not guess addresses or address named individuals.
- Send Monday–Friday from 09:00 to 15:00 Europe/Oslo, with at least five minutes between messages.
- Use `hello@cideamarketing.com`, one email per business, and no automatic follow-up.
- Capacity check: weekdays 09:00 to 15:00 with at least five minutes between emails allows at most 72 sends a day. The target of 50 qualified first-contact emails a day fits inside that; the hard ceiling of 100 per Oslo day cannot be reached within the window and is only a safety limit.
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
- The sending workflow runs every five minutes on weekdays (07:00-14:55 UTC, a superset of 09:00-15:00 Europe/Oslo in summer and winter). Code enforces the exact window (09:00 inclusive to 15:00 exclusive), at least five minutes between emails, one email per run, at most 12 per rolling hour, and a hard ceiling of 100 per Oslo calendar day. The window allows at most 72 sends a day; the 50/day target is reachable within it. Outside the window, too soon, or at a limit, a run exits successfully without sending.
- Pull request runs can never write to production Airtable (`src/domain/airtable-write-guard.ts`), and no workflow uploads raw contact drafts as an artifact.
- Existing Oslo records need a fresh AI assessment after the Airtable automation is enabled; their earlier human-review status is not an AI decision.

## Verification

`npm run typecheck` passes and the Node test suite passes. See `docs/LAUNCH-READINESS.md` for the gates that remain before any live send.
