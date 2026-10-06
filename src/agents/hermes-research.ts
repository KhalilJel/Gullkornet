import type { FirecrawlClient } from "../integrations/firecrawl.js";
import { researchBrief, type WebsiteResearch } from "../domain/website-research.js";
import { cideaTargetSchema, type CideaTarget } from "../domain/website-audit.js";

export type HermesInput = {
  target: CideaTarget;
  websiteUrl: string;
};

export type HermesResearchAdapters = {
  firecrawl?: FirecrawlClient;
};

export async function hermesResearch(input: HermesInput, adapters: HermesResearchAdapters): Promise<WebsiteResearch> {
  const target = cideaTargetSchema.parse(input.target);
  const collectedAt = new Date().toISOString();
  const sources: WebsiteResearch["sources"] = [];
  const signals: WebsiteResearch["signals"] = [];

  if (adapters.firecrawl) {
    const page = await adapters.firecrawl.scrape(input.websiteUrl);
    sources.push({
      url: page.url,
      title: page.title,
      sourceType: "website",
      collectedAt,
      excerpt: page.markdown?.slice(0, 2000)
    });

    if (page.title) {
      signals.push({
        category: "SEO",
        claim: "The page exposes a document title.",
        evidence: page.title,
        sourceUrls: [page.url],
        confidence: 1
      });
    }
  }

  return {
    target,
    websiteUrl: input.websiteUrl,
    collectedAt,
    sources,
    signals,
    unresolvedQuestions: [
      researchBrief(target),
      "Run external context research before making competitor or market claims.",
      "Run browser testing before making interaction or conversion claims."
    ]
  };
}
