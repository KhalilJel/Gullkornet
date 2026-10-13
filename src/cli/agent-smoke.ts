import { escalateResearch, routerPolicyFromEnv, type RouterState } from "../integrations/research-router.js";
import { scrapePublicWebsite } from "../integrations/firecrawl.js";

// Manual smoke test of the research router against fixed public pages. It forces escalation
// (as if the built-in fetch had produced nothing) so the Firecrawl path is exercised for real.
// Output is counts and provider outcomes only: never page content, URLs' bodies or keys.

const TEST_URLS = [
  "https://www.iana.org/help/example-domains",
  "https://www.w3.org/standards/",
  "https://en.wikipedia.org/wiki/Oslo"
];

async function main(): Promise<void> {
  if (!process.env.FIRECRAWL_API_KEY?.trim()) {
    console.error("FIRECRAWL_API_KEY is not set");
    process.exit(2);
  }
  const policy = routerPolicyFromEnv();
  const state: RouterState = { firecrawlUsed: 0, browserUsed: 0 };
  const providers = {
    firecrawl: async (url: string) => {
      const page = await scrapePublicWebsite(url);
      return { url: page.sourceUrl ?? page.url, markdown: page.markdown };
    }
  };

  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const url of TEST_URLS) {
    const result = await escalateResearch(
      { url, builtin: { ok: false, textLength: 0, reason: "NO_READABLE_HTML" } },
      providers,
      state,
      policy
    );
    for (const attempt of result.attempts) {
      const key = `${attempt.provider}:${attempt.outcome}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const host = new URL(url).hostname;
    lines.push(`${host} chars=${result.page?.markdown?.length ?? 0} attempts=${result.attempts.map((a) => `${a.provider}:${a.outcome}${a.reason ? `(${a.reason})` : ""}`).join(",")}`);
  }

  console.log(JSON.stringify({ urls: TEST_URLS.length, firecrawlUsed: state.firecrawlUsed, counts }, null, 2));
  for (const line of lines) console.log(line);
  if (!counts["firecrawl:ok"]) {
    console.error("FAIL: no firecrawl:ok");
    process.exit(1);
  }
  console.log("PASS: firecrawl:ok >= 1");
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message.replace(/[^A-Za-z0-9_ ]/g, "").slice(0, 80) : "UNKNOWN");
  process.exit(1);
});
