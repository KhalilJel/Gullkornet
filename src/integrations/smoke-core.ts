import { escalateResearch, type ResearchProviders, type RouterPolicy, type RouterState } from "./research-router.js";

export const SMOKE_URLS: readonly string[] = [
  "https://www.iana.org/help/example-domains",
  "https://www.w3.org/standards/",
  "https://en.wikipedia.org/wiki/Oslo"
];

export type SmokeReport = {
  urls: number;
  firecrawlUsed: number;
  counts: Record<string, number>;
  /** One redacted line per URL: host, character count and provider outcome codes. No content. */
  lines: string[];
  passed: boolean;
};

/** Forces escalation (as if the built-in fetch produced nothing) and reports counts only. */
export async function runSmoke(urls: readonly string[], providers: ResearchProviders, policy: RouterPolicy): Promise<SmokeReport> {
  const state: RouterState = { firecrawlUsed: 0, browserUsed: 0 };
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const url of urls) {
    const result = await escalateResearch({ url, builtin: { ok: false, textLength: 0, reason: "NO_READABLE_HTML" } }, providers, state, policy);
    for (const attempt of result.attempts) {
      const key = `${attempt.provider}:${attempt.outcome}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const outcomes = result.attempts.map((a) => `${a.provider}:${a.outcome}${a.reason ? `(${a.reason})` : ""}`).join(",");
    lines.push(`${new URL(url).hostname} chars=${result.page?.markdown?.length ?? 0} attempts=${outcomes}`);
  }
  return { urls: urls.length, firecrawlUsed: state.firecrawlUsed, counts, lines, passed: (counts["firecrawl:ok"] ?? 0) >= 1 };
}
