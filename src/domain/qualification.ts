import type { Lead } from "./lead.js";

export type QualificationResult = {
  qualified: boolean;
  fitScore: number;
  reasons: string[];
};

export function qualifyLead(lead: Lead): QualificationResult {
  const reasons: string[] = [];
  let score = 0;

  if (lead.websiteUrl) {
    score += 25;
    reasons.push("Has a public website to evaluate");
  }

  if (lead.industry) {
    score += 20;
    reasons.push("Industry is identified");
  }

  if (lead.contactEmail) {
    score += 20;
    reasons.push("Direct contact email is available");
  }

  if (lead.city) {
    score += 10;
    reasons.push("Location is identified");
  }

  if (lead.evidence.length > 0) {
    score += 25;
    reasons.push("Opportunity is backed by source evidence");
  }

  return {
    qualified: score >= 60,
    fitScore: score,
    reasons
  };
}
