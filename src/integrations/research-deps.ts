import { createGatewayExecutor, parseGatewayBaseUrl } from "./agent-gateway-client.js";
import type { ResearchDeps } from "./contact-research.js";
import { scrapePublicWebsite } from "./firecrawl.js";
import { routerPolicyFromEnv, type ResearchProviders } from "./research-router.js";

export type ResearchDepsBuild = {
  deps: ResearchDeps;
  /** Human-readable, secret-free lines describing which providers are active and why not. */
  notices: string[];
};

/**
 * Builds the escalation providers from the environment. A provider is wired only when its
 * configuration is complete; every gap is reported in `notices` so the fallback is visible
 * (the router additionally records `skipped`/`escalation_needed` per company).
 */
export function buildResearchDeps(env: NodeJS.ProcessEnv = process.env): ResearchDepsBuild {
  const notices: string[] = [];
  const providers: ResearchProviders = {};

  if (env.FIRECRAWL_API_KEY?.trim()) {
    providers.firecrawl = async (url) => {
      const page = await scrapePublicWebsite(url);
      return { url: page.sourceUrl ?? page.url, title: page.title, description: page.description, markdown: page.markdown };
    };
    notices.push("Firecrawl fallback: active");
  } else {
    notices.push("Firecrawl fallback: OFF (FIRECRAWL_API_KEY not set); built-in fetch only");
  }

  const rawUrl = env.AGENT_GATEWAY_URL?.trim();
  const token = env.AGENT_GATEWAY_TOKEN?.trim();
  if (rawUrl && token) {
    try {
      const baseUrl = parseGatewayBaseUrl(rawUrl)!;
      providers.jev = createGatewayExecutor({ baseUrl, token, engine: "jev-ultrafast" });
      providers.browserUse = createGatewayExecutor({ baseUrl, token, engine: "browser-use" });
      notices.push("Browser escalation via agent gateway: active (at most one browser path per company)");
    } catch (error) {
      notices.push(`Browser escalation: OFF (${error instanceof Error ? error.message : "AGENT_GATEWAY_URL_INVALID"}); escalation_needed is recorded instead`);
    }
  } else if (rawUrl || token) {
    notices.push(`Browser escalation: OFF (incomplete configuration: ${rawUrl ? "AGENT_GATEWAY_TOKEN" : "AGENT_GATEWAY_URL"} missing); escalation_needed is recorded instead`);
  } else {
    notices.push("Browser escalation: OFF (agent gateway not configured); escalation_needed is recorded instead");
  }

  return { deps: { policy: routerPolicyFromEnv(env), state: { firecrawlUsed: 0, browserUsed: 0 }, providers }, notices };
}
