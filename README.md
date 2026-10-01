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

## Current workflow

### Import researched leads

Create a JSON file containing an array of records. Each record must include a company name and should include public website/contact details plus source-backed evidence. See `docs/LEAD-INTAKE.md` for the format.

Run:

```bash
npm install
npm run typecheck
npm test
npm run import:leads -- ./path/to/leads.json
```

The default store is `data/leads.json`. To use another path, set `LEAD_STORE_PATH`. The local data directory is excluded from Git. Import validates each record, computes the pilot fit score, labels the lead as QUALIFIED or RESEARCHED, and prevents duplicate domains/emails from being added again. Existing lead statuses are retained when duplicates are encountered.

The import command does not discover businesses from the internet and does not send email. Research sources and observations must be collected and verified before import.

### Qualification rules

A lead is qualified only when all of these are true:
1. The industry matches the accounting/bookkeeping pilot.
2. The company is in the Oslo or Akershus pilot area.
3. A specific website opportunity is documented.
4. A source URL and concrete observation support the opportunity.
5. The lead reaches the qualification score threshold.

A website existing by itself is not a reason to qualify a business. The research must identify a real opportunity, such as unclear services, a weak contact path, mobile usability issues, poor performance, outdated design, or no website.

## Current implementation

- TypeScript configuration with safe dry-run defaults
- Structured lead model and explicit qualification rules
- Domain and email duplicate detection
- Validated JSON intake with per-record errors
- Atomic local JSON storage
- Unit tests for qualification, deduplication, and intake
- Sending remains out of scope until research quality and data handling are validated

## Next build steps

1. Add a repeatable research source workflow for the first 50 businesses.
2. Review all qualified leads manually and verify the evidence.
3. Generate personalized outreach drafts for human approval.
4. Track replies and results.
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

## Storage decision

The initial pilot uses one local JSON store to keep the workflow simple. Before multiple users or hosted production use, migrate to one shared persistent database and add backups, access controls, and retention rules. Do not maintain parallel Airtable and PostgreSQL sources without a clear reason.
