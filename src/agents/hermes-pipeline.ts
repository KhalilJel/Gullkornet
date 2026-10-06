import { createFirecrawlClient } from "../integrations/firecrawl.js";
import { hermesResearch } from "./hermes-research.js";
import { createImprovementPlan } from "./improvement-director.js";
import type { ImprovementPlan } from "../domain/improvement-plan.js";
import type { WebsiteResearch } from "../domain/website-research.js";
import type { CideaTarget } from "../domain/website-audit.js";
import type { AgentReachClient } from "../integrations/agent-reach.js";
import { enrichWithExternalResearch } from "./external-research.js";

export type HermesPipelineInput = {
  target: CideaTarget;
  websiteUrl: string;
  candidateActions?: unknown[];
  enableFirecrawl?: boolean;
  agentReach?: AgentReachClient;
};

export type HermesPipelineResult = {
  research: WebsiteResearch;
  improvementPlan: ImprovementPlan;
};

export async function runHermesPipeline(input: HermesPipelineInput): Promise<HermesPipelineResult> {
  const firecrawl = input.enableFirecrawl === false ? undefined : createFirecrawlClient();
  const research = await hermesResearch(
    { target: input.target, websiteUrl: input.websiteUrl },
    { firecrawl }
  );

  const enrichedResearch = await enrichWithExternalResearch(research, input.agentReach);

  const improvementPlan = createImprovementPlan(
    enrichedResearch,
    input.candidateActions ?? []
  );

  return { research: enrichedResearch, improvementPlan };
}
