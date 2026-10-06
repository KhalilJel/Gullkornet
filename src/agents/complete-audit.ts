import { auditCandidate } from "../integrations/website-audit.js";
import { runDeterministicSpecialistAudits } from "./specialist-audits.js";
import { scoreAllCategories } from "./specialist-score.js";
import { createImprovementPlan } from "./improvement-director.js";
import type { CideaTarget } from "../domain/website-audit.js";
import type { AgentReachClient } from "../integrations/agent-reach.js";
import type { JEVBrowserClient } from "../integrations/jev-browser.js";
import { enrichWithExternalResearch } from "./external-research.js";
import { runBrowserJourney } from "./browser-journey.js";

export type CompleteAuditInput = {
  target: CideaTarget;
  websiteUrl: string;
  agentReach?: AgentReachClient;
  browser?: JEVBrowserClient;
  browserActions?: unknown[];
};

export async function runCompleteAudit(input: CompleteAuditInput) {
  const baseline = await auditCandidate({
    companyName: input.target,
    websiteUrl: input.websiteUrl,
    sourceUrl: input.websiteUrl
  });

  const deterministicFindings = runDeterministicSpecialistAudits(baseline);
  let browser = undefined;
  if (input.browser && input.browserActions?.length) {
    browser = await runBrowserJourney(input.browser, input.browserActions);
  }

  const research = await enrichWithExternalResearch({
    target: input.target,
    websiteUrl: input.websiteUrl,
    collectedAt: new Date().toISOString(),
    sources: [{
      url: input.websiteUrl,
      sourceType: "website",
      collectedAt: new Date().toISOString(),
      title: baseline.title,
      excerpt: baseline.metaDescription
    }],
    signals: [],
    unresolvedQuestions: [
      "Run external context research before making competitor or market claims.",
      "Run browser testing before making interaction or conversion claims."
    ]
  }, input.agentReach);

  const scores = scoreAllCategories(deterministicFindings);
  const improvementPlan = createImprovementPlan(research, deterministicFindings.map((finding, index) => ({
    id: `audit-${index + 1}`,
    category: finding.category,
    priority: finding.severity === "critical" ? "P0" : finding.severity === "high" ? "P1" : finding.severity === "medium" ? "P2" : "P3",
    problem: finding.title,
    evidence: finding.evidence.map((item) => item.sourceUrl),
    proposedChange: finding.recommendation,
    expectedImpact: finding.severity === "critical" || finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
    confidence: finding.confidence,
    requiresHumanApproval: true
  })));

  return {
    auditedAt: new Date().toISOString(),
    baseline,
    scores,
    findings: deterministicFindings,
    research,
    browser,
    improvementPlan,
    status: "review_required" as const
  };
}
