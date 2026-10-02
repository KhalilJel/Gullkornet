# Gullkornet

Gullkornet is Cidea's internal lead research and qualification engine.

## Initial pilot

- **Industry:** Small accounting firms and bookkeeping practices
- **Geography:** Oslo and Akershus
- **Core promise:** Improve a business's digital presence so it is easier to find, understand, trust, and contact.
- **Possible solutions:** Website, branding and visual identity, social media setup, or a combination, depending on the specific business need.
- **Initial pilot delivery:** Website-focused research only. Broader digital-presence research will be added as evidence sources and qualification rules are implemented.
- **Pilot target:** Research 50 businesses, identify up to 20 genuinely qualified leads, and use the results to improve targeting
- **Planned daily discovery limit:** 25 leads; this is configuration only and is not enforced by a discovery module yet
- **Safety:** Dry run is enabled by default. Sending is not implemented or enabled.

These are test assumptions, not proven conversion rates. Review lead quality and outreach response before expanding to other industries or all of Norway.

## Cidea's value principle

Cidea does not sell a website by default. The goal is to give each business a useful improvement to its digital presence. The right solution depends on what the business actually needs:

- **Website:** when key information is hard to find, services are unclear, the mobile experience is weak, or the route to contact the business is difficult.
- **Branding:** when the visual identity appears inconsistent, unclear, or poorly aligned with the business's stated positioning. Treat this as a hypothesis for human review, not an objective verdict.
- **Social media presence:** when official profiles appear absent, incomplete, inconsistent, or disconnected from the business's core information.
- **Combined improvements:** when evidence supports more than one gap.

Gullkornet should identify the observed issue first and recommend a possible solution second. It must not force every prospect into a website offer, assume poor digital presence means lost revenue, or claim that a proposed change will increase sales. Outreach should only open a conversation: use the subject “Dette la vi merke til hos dere”, lead with a directly checkable audit finding (currently a missing contact/booking path, meta description, or page title), explain a cautious potential improvement without promising outcomes, and ask whether the recipient would like a short explanation by email. Do not draft outreach from weak signals alone, such as a missing mailto link, missing viewport metadata, or keyword-detection gaps. Khalil handles all sales conversations personally.

**Current implementation boundary:** the pilot currently researches public business listings and websites. Branding and social-media checks are a planned extension, not capabilities to assume are already implemented. Any proposed opportunity requires a source URL and a concrete observation.

## Candidate discovery sources

Gullkornet now supports two discovery sources. They answer different questions and neither source produces qualified leads by itself.

### Google Places: primary discovery source

Google Places Text Search helps find accounting firms and their public websites. It is the preferred starting point for discovering businesses that have an online presence or may need a website review. It requires a Google Maps Platform API key, Places API (New) enabled, and billing configured. The adapter requests only selected fields and does not collect phone numbers, reviews, or personal contact details.

Set `GOOGLE_MAPS_API_KEY` in your local `.env` file. Never commit the key to Git. Check Google Maps Platform pricing, quotas, and applicable terms before running a larger search. Google Places data use is subject to Google's policies.

In PowerShell:

```powershell
npm install
New-Item -ItemType Directory -Force data
npm run --silent discover:google -- regnskapsfører > data/google-candidates.json
npm run import:leads -- data/google-candidates.json
npm run report:leads
```

The Google discovery adapter searches Oslo and selected Akershus municipalities, up to 20 results per municipality per run. Repeated businesses are deduplicated by website domain where possible. This is a discovery cap per query, not a daily limit; daily discovery enforcement is not implemented yet.

If you want to search for another relevant phrase, pass it as the first argument, for example `økonomikonsulent`. Review the search terms and resulting candidates before treating them as accounting firms.

### Brønnøysundregistrene: verification and additional discovery

The Brønnøysund Register Centre's public Enhetsregister API provides structured company information such as organization number, registered name, and available contact fields. It remains useful for verification and to discover firms that Google Places may miss.

```powershell
npm run --silent discover:registry -- regnskap > data/discovered-candidates.json
npm run import:leads -- data/discovered-candidates.json
npm run report:leads
```

The registry adapter searches a name term in Oslo and selected Akershus municipalities and checks a limited number of result pages. It creates candidates, not qualified sales leads.

## Daily lead machine

The Google Places workflow runs on weekday mornings and rotates one local-business category per day: hairdressers, restaurants, accounting firms, dentists, and auto repair shops. The website audit and contact-research workflows are triggered from successful upstream runs, producing a review-queue artifact without sending email.

To run a one-off search, open **Actions → Gullkornet Google Places Discovery → Run workflow** and choose a business type. The scheduled workflow requires the repository secret `GOOGLE_MAPS_API_KEY`; ensure Places API billing and quotas are configured. Google Places and website requests may incur costs or be rate-limited.

This pipeline discovers candidates, audits websites, researches publicly listed contact routes, and drafts outreach. It does **not** deduplicate against previous runs, guarantee new leads each day, qualify businesses automatically, or send emails. Review the generated queue manually before contacting anyone. For more frequent outreach, use the queue as a daily worklist and track contacted businesses separately to prevent duplicate contact.

## Import and research workflow

The default store is `data/leads.json`. To use another path, set `LEAD_STORE_PATH`. The local data directory is excluded from Git. Import validates each record, computes the pilot fit score, labels candidates as NEW until research is documented, and labels researched leads as QUALIFIED or RESEARCHED. Duplicate organization numbers, domains, and emails are not added again, and existing lead statuses are retained.

The report command prints total records, counts by status, and the qualified leads with their evidence summary.

Use `docs/WEBSITE-RESEARCH-CHECKLIST.md` to assess a specific opportunity. A website existing by itself is not a reason to qualify a business. The research must identify a real opportunity, such as unclear services, a weak contact path, mobile usability issues, poor performance, outdated design, or no website.

## Development checks

```bash
npm install
npm run typecheck
npm test
```

## Principles and safety

- Lead quality over lead volume.
- Evidence over assumptions.
- Trace every lead back to its source.
- Never contact the same business twice accidentally.
- Respect do-not-contact requests and applicable privacy and marketing rules.
- Sending is not implemented or enabled.
- Do not change DNS or MX records.
- Do not connect Gullkornet to SmartSvar production state.

## Storage decision

The initial pilot uses one local JSON store to keep the workflow simple. Before multiple users or hosted production use, migrate to one shared persistent database and add backups, access controls, and retention rules. Do not maintain parallel Airtable and PostgreSQL sources without a clear reason.
