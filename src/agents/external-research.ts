import type { AgentReachClient } from "../integrations/agent-reach.js";
import type { WebsiteResearch } from "../domain/website-research.js";

export async function enrichWithExternalResearch(
  research: WebsiteResearch,
  client?: AgentReachClient
): Promise<WebsiteResearch> {
  if (!client) {
    return {
      ...research,
      unresolvedQuestions: [
        ...research.unresolvedQuestions,
        "Agent Reach is not configured in this runtime."
      ]
    };
  }

  const query = `"${research.websiteUrl}" competitors customer reviews positioning`;
  const evidence = await client.search(query);

  const sources = evidence.map((item) => ({
    url: item.sourceUrl,
    title: item.title,
    sourceType: item.platform === "web" ? "search" as const : item.platform === "linkedin" || item.platform === "reddit" || item.platform === "twitter" || item.platform === "youtube" ? "social" as const : "other" as const,
    collectedAt: item.collectedAt,
    excerpt: item.excerpt
  }));

  return {
    ...research,
    sources: [...research.sources, ...sources],
    unresolvedQuestions: research.unresolvedQuestions.filter(
      (question) => question !== "Run external context research before making competitor or market claims."
    )
  };
}
