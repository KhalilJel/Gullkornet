export type QualificationStatus = "qualified" | "review_required" | "rejected" | "suppressed";

export type QualificationInput = {
  company?: string;
  website?: string;
  location?: string;
  industry?: string;
  identityVerified?: boolean;
  suppressed?: boolean;
  requiresHumanReview?: boolean;
  evidence: string[];
  targetGeographies?: string[];
};

export type QualificationDecision = {
  status: QualificationStatus;
  score: number;
  reasons: string[];
  reviewReasons: string[];
  opportunitySignals: string[];
};

const DEFAULT_TARGET_GEOGRAPHIES = ["Oslo", "Akershus"];
const COMPETITOR_INDUSTRY = /web\s?design|webutvikling|web development|digital marketing agency|markedsføringsbyrå|branding agency|merkevarebyrå|seo agency|seo-byrå/i;

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("nb-NO").replace(/\s+/g, " ");
}

function matchesTargetGeography(location: string, targets: string[]): boolean {
  const normalizedLocation = normalize(location);
  return targets.some((target) => {
    const normalizedTarget = normalize(target);
    if (!normalizedTarget) return false;
    // Require token boundaries so "Oslofjord" does not match "Oslo".
    const escaped = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^\\p{L}\\p{N}])" + escaped + "($|[^\\p{L}\\p{N}])", "iu").test(normalizedLocation);
  });
}

/**
 * Deterministic qualification based only on supplied identity, geography, industry,
 * and explicit website evidence. Automated website signals are opportunities to review,
 * not proof of business harm or expected revenue.
 */
export function evaluateLeadQualification(input: QualificationInput): QualificationDecision {
  const reasons: string[] = [];
  const reviewReasons: string[] = [];
  const targets = (input.targetGeographies ?? DEFAULT_TARGET_GEOGRAPHIES).filter((item) => item.trim());
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.filter((item): item is string => typeof item === "string" && item.trim().length >= 12)
    : [];
  const opportunitySignals = [...new Set(evidence.flatMap((item) => {
    const matches = item.match(/MISSING_TITLE|MISSING_META_DESCRIPTION|MISSING_VIEWPORT_META|NO_OBVIOUS_CONTACT_PATH|NO_WEBSITE/g);
    return matches ?? [];
  }))].sort();

  if (input.suppressed) {
    return { status: "suppressed", score: 0, reasons: ["Contact is suppressed or marked do-not-contact."], reviewReasons, opportunitySignals: [] };
  }

  const company = typeof input.company === "string" ? input.company.trim() : "";
  if (!company) reviewReasons.push("Business identity is uncertain because the company name is missing.");
  else reasons.push("A business name is present.");

  if (input.identityVerified === true) reasons.push("Business identity has been explicitly verified.");
  else reviewReasons.push("Business identity has not been explicitly verified.");

  const location = typeof input.location === "string" ? input.location.trim() : "";
  if (!location) {
    reviewReasons.push("Geography is unknown.");
  } else if (!matchesTargetGeography(location, targets)) {
    return {
      status: "rejected",
      score: 0,
      reasons: ["Location does not match configured target geographies: " + targets.join(", ") + "."],
      reviewReasons,
      opportunitySignals
    };
  } else {
    reasons.push("Location matches a configured target geography.");
  }

  const industry = typeof input.industry === "string" ? input.industry.trim() : "";
  if (!industry) reviewReasons.push("Industry is unknown.");
  else if (COMPETITOR_INDUSTRY.test(industry)) {
    return {
      status: "rejected",
      score: 0,
      reasons: ["Industry appears to be a direct competitor to Cidea's website, branding, or digital-marketing services."],
      reviewReasons,
      opportunitySignals
    };
  } else {
    reasons.push("Industry is not identified as a direct competitor; service fit still needs human confirmation.");
  }

  if (evidence.length === 0) {
    reviewReasons.push("Evidence is missing or too weak to support a qualification decision.");
    return { status: "review_required", score: 0, reasons, reviewReasons, opportunitySignals };
  }

  if (opportunitySignals.length === 0) {
    return {
      status: "rejected",
      score: 0,
      reasons: ["No supported website/digital-presence opportunity signal was found in the supplied evidence."],
      reviewReasons,
      opportunitySignals
    };
  }
  reasons.push("Observed website signals to review: " + opportunitySignals.join(", ") + ".");

  let score = 0;
  if (company) score += 10;
  if (input.identityVerified === true) score += 20;
  if (location && matchesTargetGeography(location, targets)) score += 20;
  if (industry && !COMPETITOR_INDUSTRY.test(industry)) score += 15;
  score += Math.min(30, opportunitySignals.length * 10);
  if (typeof input.website === "string" && /^https?:\/\//i.test(input.website.trim())) score += 5;
  score = Math.max(0, Math.min(100, score));

  if (input.requiresHumanReview) reviewReasons.push("Research provider requires human review.");
  if (reviewReasons.length > 0 || score < 60) {
    if (score < 60) reviewReasons.push("Evidence-backed score is below the qualification threshold of 60.");
    return { status: "review_required", score, reasons, reviewReasons, opportunitySignals };
  }

  return { status: "qualified", score, reasons, reviewReasons, opportunitySignals };
}
