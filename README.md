# Gullkornet

Gullkornet is the internal lead generation engine for Cidea.

## Goal

Generate qualified Norwegian business leads that Cidea can realistically help with websites, branding, and digital improvements.

## MVP

1. Find relevant businesses.
2. Research publicly available information.
3. Qualify the lead using explicit evidence.
4. Detect duplicates.
5. Store the lead and research notes.
6. Draft a personalized outreach message.
7. Keep sending behind explicit approval and dry-run safeguards until the workflow is proven.

## Principles

- Lead quality over lead volume.
- Evidence over assumptions.
- Simple before sophisticated.
- Trace every lead back to its source.
- Never contact the same business twice accidentally.
- Do not change DNS or MX records.
- Do not connect Gullkornet to SmartSvar production state.

## Planned stack

TypeScript + PostgreSQL + Airtable + Resend, with provider interfaces kept replaceable.
