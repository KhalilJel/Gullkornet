# Market Insight Pilot — First Run

This workflow creates a reviewable CSV from website-audit observations. It does not score businesses, make customer-facing claims, modify the internal lead registry, or send email.

## Run locally

1. Install dependencies and configure `GOOGLE_MAPS_API_KEY` in your local `.env` file. Do not commit the key.
2. Discover candidates in one niche:
   `npm run discover:google -- regnskapsfører`
3. Save the JSON output to `data/google-candidates.json` (the discovery command prints JSON to stdout).
4. Audit the websites:
   `npm run audit:websites -- data/google-candidates.json > data/website-audits.json`
5. Export the audit observations:
   `npm run export:market-insight -- data/website-audits.json data/market-insight-pilot.csv`
6. Manually verify each candidate and every proposed opportunity against the linked public source before sharing anything externally.

## Important interpretation rules

- A missing email link does not mean the company has no contact route.
- Automated website flags are observations, not proof of commercial opportunity.
- `NO_WEBSITE` means no website URL was supplied to the audit, not that the business has no website.
- The exported CSV includes all audit statuses and the source URL so reviewers can exclude weak or uncertain records.
- Keep customer-facing datasets separate from Cidea's internal lead registry.
- Do not run any email sending commands for this pilot.
