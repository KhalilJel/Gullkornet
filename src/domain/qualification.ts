import type { Lead } from "./lead.js";

export type QualificationResult = {
  qualified: boolean;
  fitScore: number;
  reasons: string[];
  missingRequirements: string[];
};

const isTargetIndustry = (industry?: string): boolean => {
  if (!industry) return false;
  return /regnskap|regnskapsfør|accounting|bookkeep/i.test(industry);
};

const isPilotArea = (city?: string): boolean => {
  if (!city) return false;
  return /oslo|akershus|bærum|baerum|asker|lillestrøm|lillestrom|lørenskog|lorenskog|nordre follo|nesodden|ullensaker|rælingen|ralingen|eidsvoll|nannestad|vestby|frogn|enebakk|åsgårdstrand/i.test(city);
};

const hasOpportunity = (lead: Lead): boolean =>
  Boolean(lead.websiteIssue && lead.websiteIssue !== "NONE");

export function qualifyLead(lead: Lead): QualificationResult {
  const reasons: string[] = [];
  const missingRequirements: string[] = [];
  let score = 0;

  if (isTargetIndustry(lead.industry)) {
    score += 25;
    reasons.push("Matches the initial accounting-firm pilot");
  } else {
    missingRequirements.push("Verify that the company belongs to the target industry");
  }

  if (isPilotArea(lead.city)) {
    score += 15;
    reasons.push("Located in Oslo or the Akershus pilot area");
  } else {
    missingRequirements.push("Verify that the company is in the pilot area");
  }

  if (hasOpportunity(lead)) {
    score += 25;
    reasons.push(`Documented website opportunity: ${lead.websiteIssue}`);
  } else {
    missingRequirements.push("Document a specific website opportunity");
  }

  if (lead.contactEmail) {
    score += 15;
    reasons.push("Public contact email is available");
  } else {
    missingRequirements.push("Find a suitable public business contact route");
  }

  if (lead.evidence.some((item) => item.sourceUrl.trim() && item.observation.trim())) {
    score += 20;
    reasons.push("Opportunity is supported by source evidence");
  } else {
    missingRequirements.push("Add a source URL and a concrete observation");
  }

  const requiredSignalsPresent =
    isTargetIndustry(lead.industry) &&
    isPilotArea(lead.city) &&
    hasOpportunity(lead) &&
    lead.evidence.some((item) => item.sourceUrl.trim() && item.observation.trim());

  return {
    qualified: requiredSignalsPresent && score >= 60,
    fitScore: score,
    reasons,
    missingRequirements
  };
}
