import { z } from "zod";
import type { WebsiteResearch } from "../domain/website-research.js";
import { improvementPlanSchema, type ImprovementPlan } from "../domain/improvement-plan.js";

const actionSchema = z.object({
  id: z.string(),
  category: z.enum(["UX","SEO","CRO","DESIGN","CONTENT","PERFORMANCE","TRUST"]),
  priority: z.enum(["P0","P1","P2","P3"]),
  problem: z.string(),
  evidence: z.array(z.string().url()).min(1),
  proposedChange: z.string(),
  expectedImpact: z.enum(["low","medium","high"]),
  confidence: z.number().min(0).max(1),
  requiresHumanApproval: z.boolean()
});

export function createImprovementPlan(research: WebsiteResearch, candidateActions: unknown[]): ImprovementPlan {
  const validActions = candidateActions
    .map((action) => actionSchema.safeParse(action))
    .filter((result): result is { success: true; data: z.infer<typeof actionSchema> } => result.success)
    .map((result) => result.data)
    .slice(0, 20);

  const ranked = [...validActions].sort((a, b) => {
    const priority = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return priority[a.priority] - priority[b.priority] || b.confidence - a.confidence;
  });

  return improvementPlanSchema.parse({
    target: research.target,
    websiteUrl: research.websiteUrl,
    generatedAt: new Date().toISOString(),
    actions: ranked,
    selectedTopFive: ranked.slice(0, 5).map((action) => action.id),
    status: "review_required"
  });
}
