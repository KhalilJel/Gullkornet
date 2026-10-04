export type CideaPriorityInput = {
  status: "AUDITED" | "NO_WEBSITE" | "BLOCKED_URL" | "FETCH_ERROR";
  https?: boolean;
  title?: string;
  metaDescription?: string;
  hasViewportMeta?: boolean;
  hasContactPath?: boolean;
  hasEmailLink?: boolean;
  responseTimeMs?: number;
  flags?: string[];
};

export type CideaPriority = {
  score: number;
  band: "HIGH" | "MEDIUM" | "LOW";
  recommendedService: "Website" | "SEO" | "Combined" | "Review required";
  reviewRequired: true;
  reasons: string[];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Produces a transparent prioritisation signal from website-audit observations.
 * It is not lead qualification. Human review is always required before outreach.
 */
export function prioritizeCidea(input: CideaPriorityInput): CideaPriority {
  if (input.status !== "AUDITED") {
    return {
      score: 0,
      band: "LOW",
      recommendedService: "Review required",
      reviewRequired: true,
      reasons: ["Website could not be assessed reliably."]
    };
  }

  let score = 40;
  const reasons: string[] = [];
  let websiteSignals = 0;
  let seoSignals = 0;

  if (!input.title?.trim()) {
    score += 12;
    websiteSignals += 1;
    reasons.push("Missing page title detected.");
  }

  if (!input.metaDescription?.trim()) {
    score += 8;
    seoSignals += 1;
    reasons.push("Missing meta description detected.");
  }

  if (input.hasViewportMeta === false) {
    score += 10;
    websiteSignals += 1;
    reasons.push("No viewport meta tag detected.");
  }

  if (input.hasContactPath === false) {
    score += 14;
    websiteSignals += 1;
    reasons.push("No obvious contact/booking path detected.");
  }

  if (input.hasEmailLink === false) {
    score += 5;
    websiteSignals += 1;
    reasons.push("No mailto link detected.");
  }

  if (input.https === false) {
    score += 5;
    websiteSignals += 1;
    reasons.push("HTTPS was not detected on the audited URL.");
  }

  if (typeof input.responseTimeMs === "number" && input.responseTimeMs >= 2500) {
    score += 6;
    websiteSignals += 1;
    reasons.push("Slow initial response observed.");
  }

  const finalScore = clamp(score);
  const band = finalScore >= 70 ? "HIGH" : finalScore >= 50 ? "MEDIUM" : "LOW";

  let recommendedService: CideaPriority["recommendedService"] = "Website";
  if (websiteSignals === 0 && seoSignals > 0) recommendedService = "SEO";
  if (websiteSignals > 0 && seoSignals > 0) recommendedService = "Combined";
  if (reasons.length === 0) recommendedService = "Review required";

  return {
    score: finalScore,
    band,
    recommendedService,
    reviewRequired: true,
    reasons
  };
}
