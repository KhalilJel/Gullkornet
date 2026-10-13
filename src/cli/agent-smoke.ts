import { scrapePublicWebsite } from "../integrations/firecrawl.js";
import { routerPolicyFromEnv } from "../integrations/research-router.js";
import { runSmoke, SMOKE_URLS } from "../integrations/smoke-core.js";

// Manual smoke test of the research router against fixed public pages. No Airtable, no e-mail,
// no writes. Output is counts and provider outcome codes only: never page content or keys.
// Local run:  FIRECRAWL_API_KEY=<key> npm run smoke:agents

if (!process.env.FIRECRAWL_API_KEY?.trim()) {
  console.error("FIRECRAWL_API_KEY is not set. Nothing was called.");
  process.exit(2);
}

try {
  const report = await runSmoke(
    SMOKE_URLS,
    {
      firecrawl: async (url) => {
        const page = await scrapePublicWebsite(url);
        return { url: page.sourceUrl ?? page.url, markdown: page.markdown };
      }
    },
    routerPolicyFromEnv()
  );
  console.log(JSON.stringify({ urls: report.urls, firecrawlUsed: report.firecrawlUsed, counts: report.counts }, null, 2));
  for (const line of report.lines) console.log(line);
  console.log(report.passed ? "PASS: firecrawl:ok >= 1" : "FAIL: no firecrawl:ok");
  process.exitCode = report.passed ? 0 : 1;
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message.replace(/[^A-Za-z0-9_ ]/g, "").slice(0, 80) : "UNKNOWN");
  process.exitCode = 1;
}
