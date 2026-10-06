# Firecrawl — Phase 3

Status: Phase 3 — implementation and verification

## Role

Firecrawl is Gullkornet's primary website crawling and structured web extraction capability.

The boundary is intentionally narrow:

- Agent Reach handles broad public-internet research.
- Firecrawl handles website-specific scraping, crawling and extraction.
- Gullkornet owns normalized evidence, qualification and opportunity logic.
- Hermes coordinates when the capability is used.

Firecrawl's current API provides scrape, crawl and map capabilities. The adapter currently uses the v2 `/scrape` and `/crawl` endpoints. citeturn0search9turn0search2

## Gullkornet adapter

Implementation:

- `src/integrations/firecrawl.ts`
- `scrapePublicWebsite(url)`
- `crawlPublicWebsite(url, limit)`

The adapter returns a small provider-neutral shape and does not expose Firecrawl response objects to the domain layer.

The existing `website-audit.ts` remains unchanged in Phase 3. This avoids replacing a working audit path before the Firecrawl runtime has been verified.

## Security boundary

Before a URL is sent to Firecrawl, Gullkornet applies its existing public-URL safety check.

The adapter rejects:

- localhost
- private/reserved IP ranges
- unsupported protocols
- URLs containing embedded credentials
- domains that cannot be resolved as public addresses

The Firecrawl API key is runtime-only:

`FIRECRAWL_API_KEY`

It must never be committed to GitHub or included in source code.

No DNS/MX changes are required.

## Runtime strategy

Phase 3 does not self-host Firecrawl yet.

The first implementation targets the hosted Firecrawl API because it avoids adding a second multi-service crawler stack to the Hermes Railway volume. Firecrawl's self-hosted stack includes the API, workers, Playwright and queue/storage dependencies, so self-hosting should be an explicit infrastructure decision rather than an incidental dependency. citeturn0search0

## Verification gate

Phase 3 is not complete until:

1. TypeScript typecheck passes.
2. Unit tests pass.
3. `FIRECRAWL_API_KEY` is configured only in the runtime secret store.
4. A real scrape smoke test succeeds against a public website.
5. A real crawl smoke test succeeds against a small public website.
6. The service is restarted/redeployed and the Firecrawl configuration remains available.
7. No DNS/MX changes occur.

Only after this gate should the Firecrawl adapter be connected to the production lead-research pipeline.

## Next integration step

After runtime verification, wire Firecrawl into website research as:

`candidate → safe URL check → Firecrawl scrape/crawl → normalized evidence → existing audit/qualification logic`

Do not let provider-specific fields bypass Gullkornet's evidence model.
