import { z } from "zod";
import { cideaTargetSchema, auditCategorySchema, type CideaTarget } from "./website-audit.js";

export const researchSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  sourceType: z.enum(["website","competitor","search","social","browser","other"]),
  collectedAt: z.string().datetime(),
  excerpt: z.string().max(2000).optional(),
});

export const researchSignalSchema = z.object({
  category: auditCategorySchema,
  claim: z.string().min(1),
  evidence: z.string().min(1),
  sourceUrls: z.array(z.string().url()).min(1),
  confidence: z.number().min(0).max(1),
});

export const websiteResearchSchema = z.object({
  target: cideaTargetSchema,
  websiteUrl: z.string().url(),
  collectedAt: z.string().datetime(),
  sources: z.array(researchSourceSchema),
  signals: z.array(researchSignalSchema),
  unresolvedQuestions: z.array(z.string()),
});

export type WebsiteResearch = z.infer<typeof websiteResearchSchema>;
export type ResearchSignal = z.infer<typeof researchSignalSchema>;

export function researchBrief(target: CideaTarget): string {
  if (target === "CideaLead") {
    return "Focus on conversion, offer clarity, trust, contact friction and evidence that a visitor can become a qualified lead.";
  }
  if (target === "CideaMarketing") {
    return "Focus on SEO, content, positioning, demand generation, social proof and marketing authority.";
  }
  return "Focus on authority, business problems, AI/digital opportunities, consulting positioning and decision-maker trust.";
}
