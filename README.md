# Gullkornet

Gullkornet is Cidea's internal lead research and qualification engine.

## Initial pilot

- **Industry:** Small accounting firms and bookkeeping practices
- **Geography:** Oslo and Akershus
- **Offer:** Website redesign or a new website focused on clearer services and qualified enquiries
- **Pilot target:** Research 50 businesses, identify up to 20 genuinely qualified leads, and use the results to improve targeting
- **Planned daily discovery limit:** 25 leads; this is configuration only and is not enforced by a discovery module yet
- **Safety:** Dry run is enabled by default. Sending is not implemented or enabled.

These are test assumptions, not proven conversion rates. Review lead quality and outreach response before expanding to other industries or all of Norway.

## Current workflow

### Discover candidates from the public business registry

The first discovery adapter uses the Brønnøysund Register Centre's public Enhetsregister API. It searches for a name term in Oslo and selected Akershus municipalities. This creates a candidate list, not a list of qualified sales leads. Registry details must be checked, and website opportunities must be researched separately.

In PowerShell:

```powershell
New-Item -ItemType Directory -Force data
npm run discover:registry -- regnskap > data/discovered-candidates.json
```

The query term can be changed, for example to `økonomi` or `bokføring`. The current adapter checks a limited set of municipalities and up to two pages per municipality by default. It does not yet enforce the planned daily discovery limit.

### Import candidates and researched leads

```powershell
npm run import:leads -- data/discovered-candidates.json
npm run report:leads
```

For the complete development checks:

```bash
npm install
npm run typecheck
npm test
```

The default store is `data/leads.json`. To use another path, set `LEAD_STORE_PATH`. The local data directory is excluded from Git. Import validates each record, computes the pilot fit score, labels candidates as NEW until research is documented, and labels researched leads as QUALIFIED or RESEARCHED. Duplicate organization numbers, domains, and emails are not added again, and existing lead statuses are retained.

The report command prints total records, counts by status, and the qualified leads with their evidence summary.

The registry adapter does not evaluate websites, infer business performance, or send email. Candidates must not be treated as qualified until concrete website opportunities and supporting evidence have been reviewed.

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
- Public registry candidate discovery
- Structured lead model and explicit qualification rules
- Deduplication by organization number, domain, and email
- Validated JSON intake with per-record errors
- Atomic local JSON storage
- Local status and qualification report
- Unit tests for qualification, deduplication, registry mapping, storage, and intake
- Sending remains out of scope until research quality and data handling are validated

## Next build steps

1. Run registry discovery and review the candidate list.
2. Research website quality and contact routes for the first 50 candidates.
3. Verify evidence and manually review every qualified lead.
4. Generate personalized outreach drafts for human approval.
5. Track replies and results before considering any sending integration.

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
