import { readFile } from "node:fs/promises";
import { researchContactsAndDrafts, type ResearchDeps } from "../integrations/contact-research.js";
import { scrapePublicWebsite } from "../integrations/firecrawl.js";
import { createGatewayExecutor, parseGatewayBaseUrl } from "../integrations/agent-gateway-client.js";
import { routerPolicyFromEnv } from "../integrations/research-router.js";
import type { GoogleCandidate, WebsiteAudit } from "../integrations/website-audit.js";

const candidatesPath = process.argv[2] ?? "data/google-candidates.json";
const auditPath = process.argv[3] ?? "data/website-audit.json";

// Firecrawl is called directly. JEV and Browser Use live in a private container and are only
// reachable through the agent gateway when AGENT_GATEWAY_URL and AGENT_GATEWAY_TOKEN are set;
// otherwise the router keeps recording escalation_needed.
function buildResearchDeps(): ResearchDeps {
  const policy = routerPolicyFromEnv();
  const hasFirecrawl = Boolean(process.env.FIRECRAWL_API_KEY?.trim());
  const gatewayUrl = parseGatewayBaseUrl(process.env.AGENT_GATEWAY_URL);
  const gatewayToken = process.env.AGENT_GATEWAY_TOKEN?.trim();
  const gateway = gatewayUrl && gatewayToken ? { baseUrl: gatewayUrl, token: gatewayToken } : undefined;
  return {
    policy,
    state: { firecrawlUsed: 0, browserUsed: 0 },
    providers: {
      ...(hasFirecrawl
        ? {
            firecrawl: async (url: string) => {
              const page = await scrapePublicWebsite(url);
              return { url: page.sourceUrl ?? page.url, title: page.title, description: page.description, markdown: page.markdown };
            }
          }
        : {}),
      ...(gateway
        ? {
            jev: createGatewayExecutor({ ...gateway, engine: "jev-ultrafast" }),
            browserUse: createGatewayExecutor({ ...gateway, engine: "browser-use" })
          }
        : {})
    }
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

try {
  const [candidateData, auditData] = await Promise.all([readJson(candidatesPath), readJson(auditPath)]);
  if (!Array.isArray(candidateData)) throw new Error("Candidate input must be a JSON array.");
  if (!Array.isArray(auditData)) throw new Error("Website audit input must be a JSON array.");

  const candidates: GoogleCandidate[] = candidateData.map((item, index) => {
    if (!item || typeof item !== "object" || typeof item.companyName !== "string" || !item.companyName.trim()) {
      throw new Error(`Candidate at index ${index} is missing a valid companyName.`);
    }
    return {
      companyName: item.companyName,
      websiteUrl: typeof item.websiteUrl === "string" ? item.websiteUrl : undefined,
      city: typeof item.city === "string" ? item.city : undefined,
      industry: typeof item.industry === "string" ? item.industry : undefined,
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined
    };
  });

  const audits = auditData as WebsiteAudit[];
  const results = await researchContactsAndDrafts(candidates, audits, 3, buildResearchDeps());
  console.log(JSON.stringify(results, null, 2));
  const withEmail = results.filter((item) => item.emails.length > 0).length;
  const withDraft = results.filter((item) => Boolean(item.draftBody && item.subject)).length;
  console.error(`Contact research complete: ${withEmail} candidates have a publicly listed email, ${withDraft} have a personalized draft. Nothing was sent. Human review is required.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Contact research failed.");
  process.exitCode = 1;
}
