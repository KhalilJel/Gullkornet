import { z } from "zod";
import { cideaTargetSchema, auditCategorySchema } from "./website-audit.js";

export const improvementActionSchema = z.object({
  id: z.string().min(1),
  category: auditCategorySchema,
  priority: z.enum(["P0","P1","P2","P3"]),
  problem: z.string().min(1),
  evidence: z.array(z.string().url()).min(1),
  proposedChange: z.string().min(1),
  expectedImpact: z.enum(["low","medium","high"]),
  confidence: z.number().min(0).max(1),
  requiresHumanApproval: z.boolean(),
});

export const improvementPlanSchema = z.object({
  target: cideaTargetSchema,
  websiteUrl: z.string().url(),
  generatedAt: z.string().datetime(),
  actions: z.array(improvementActionSchema).max(20),
  selectedTopFive: z.array(z.string()).max(5),
  status: z.enum(["draft","review_required","approved","implemented"]),
});

export type ImprovementPlan = z.infer<typeof improvementPlanSchema>;
