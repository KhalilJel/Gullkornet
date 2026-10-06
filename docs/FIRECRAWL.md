# Firecrawl — Phase 3

Status: Phase 3 — complete

## Role

Firecrawl is Gullkornet's primary website crawling and structured web extraction capability.

The boundary is intentionally narrow:

- Agent Reach handles broad public-internet research.
- Firecrawl handles website-specific scraping, crawling and extraction.
- Gullkornet owns normalized evidence, qualification and opportunity logic.
- Hermes coordinates when the capability is used.

The adapter currently uses the v2 `/scrape` and `/crawl` endpoints.

## Gullkornet adapter

Implementation:

- `src/integrations/firecrawl.ts`
- `scrapePublicWebsite(url)`
- `crawlPublicWebsite(url, limit)`

The adapter returns a small provider-neutral shape and does not expose Firecrawl response objects to the domain layer.

The existing `website-audit.ts` remains unchanged in Phase 3. Firecrawl is not yet wired into the production lead pipeline; that belongs to the later integration phase.

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

Phase 3 uses the hosted Firecrawl API. Self-hosting is deliberately deferred so it does not add a second multi-service crawler stack to the Hermes Railway environment before that infrastructure decision is justified.

## Verification

Completed 2026-10-06:

1. TypeScript typecheck: PASS through GitHub Actions.
2. Unit tests: PASS through GitHub Actions.
3. `FIRECRAWL_API_KEY`: configured only in Railway runtime variables.
4. Real scrape smoke test: PASS against `https://example.com`.
5. Real crawl smoke test: PASS with 2 completed pages.
6. Hermes restart and post-restart Firecrawl scrape: PASS.
7. DNS/MX changes: none.

The CI workflow used for reproducible typecheck/test verification was added in PR #63 and merged to `main`.

**Phase 3 is complete.**

## Next integration step

During the later end-to-end integration phase, wire Firecrawl into website research as:

`candidate → safe URL check → Firecrawl scrape/crawl → normalized evidence → existing audit/qualification logic`

Do not let provider-specific fields bypass Gullkornet's evidence model.
