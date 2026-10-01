# Gullkornet

Gullkornet is Cidea's internal lead research and qualification engine.

## Initial pilot

- **Industry:** Small accounting firms and bookkeeping practices
- **Geography:** Oslo and Akershus
- **Offer:** Website redesign or a new website focused on clearer services and qualified enquiries
- **Pilot target:** Research 50 businesses, identify up to 20 genuinely qualified leads, and use the results to improve targeting
- **Daily discovery limit:** 25 leads by default
- **Safety:** Dry run is enabled by default. Sending is not implemented or enabled.

These are test assumptions, not proven conversion rates. Review lead quality and outreach response before expanding to other industries or all of Norway.

## Qualification rules

A lead is qualified only when all of these are true:
1. The industry matches the accounting/bookkeeping pilot.
2. The company is in Oslo or the Akershus pilot area.
3. A specific website opportunity is documented.
4. A source URL and concrete observation support the opportunity.
5. The lead reaches the qualification score threshold.

A website existing by itself is not a reason to qualify a business. The research must identify a real opportunity, such as unclear services, a weak contact path, mobile usability issues, poor performance, outdated design, or no website.

## Current implementation

- TypeScript configuration with safe dry-run defaults
- Structured lead model and explicit qualification rules
- Domain and email duplicate detection
- Unit tests for qualification and deduplication
- Sending remains out of scope until research quality and data handling are validated

## Next build steps

1. Build a controlled research intake for leads and evidence.
2. Add durable storage and repeatable import/export.
3. Research the first 50 companies and inspect the quality manually.
4. Generate personalized outreach drafts for human approval.
5. Add sending only after a small, reviewed pilot is ready.

## Principles

- Lead quality over lead volume.
- Evidence over assumptions.
- Simple before sophisticated.
- Trace every lead back to its source.
- Never contact the same business twice accidentally.
- Respect do-not-contact requests and applicable privacy and marketing rules.
- Do not change DNS or MX records.
- Do not connect Gullkornet to SmartSvar production state.

## Planned stack

Start with TypeScript and one clear source of truth. Choose PostgreSQL or Airtable for persistence only after the intake workflow is defined. Use Resend only when an approved outreach workflow is ready; do not duplicate storage or automate sending prematurely.
