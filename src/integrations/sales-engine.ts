export type SalesLead = {
  id?: string;
  company?: string;
  email?: string;
  website?: string;
  [key: string]: unknown;
};

export type LeadResearch = {
  websiteUrl?: string;
  evidence: string[];
  score: number;
  requiresHumanReview: boolean;
  draft?: { subject: string; body: string };
};

export type SalesEngineDependencies = {
  discover: () => Promise<SalesLead[]>;
  enrich: (lead: SalesLead) => Promise<SalesLead>;
  verifyContact: (lead: SalesLead) => Promise<{ valid: boolean; reason?: string }>;
  research: (lead: SalesLead) => Promise<LeadResearch>;
  isSuppressed: (email: string) => Promise<boolean>;
  ingest: (leads: Array<SalesLead & { research: LeadResearch }>) => Promise<void>;
};

export type SalesEngineReviewItem = {
  lead: SalesLead;
  reason: string;
  research?: LeadResearch;
};

export type SalesEngineResult = {
  discovered: number;
  deduplicated: number;
  researched: number;
  queued: number;
  reviewRequired: SalesEngineReviewItem[];
  skipped: Record<string, number>;
  dryRun: boolean;
};

function normalizeEmail(lead: SalesLead): string {
  return typeof lead.email === "string" ? lead.email.trim().toLowerCase() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function normalizeCompany(lead: SalesLead): string {
  return typeof lead.company === "string"
    ? lead.company.normalize("NFKC").trim().toLocaleLowerCase("nb-NO").replace(/\s+/g, " ")
    : "";
}

function normalizeWebsiteDomain(lead: SalesLead): string {
  if (typeof lead.website !== "string" || !lead.website.trim()) return "";
  const raw = lead.website.trim();
  // Only HTTP(S) URLs are identity evidence; reject other explicit schemes.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return "";
    return url.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Phase 9 orchestration boundary. Prepares a qualified queue only.
 * It never sends email; sending remains a separately gated OpenOutSend operation.
 */
export async function runSalesEngine(
  dependencies: SalesEngineDependencies,
  options: { dryRun?: boolean; maxLeads?: number } = {}
): Promise<SalesEngineResult> {
  const dryRun = options.dryRun ?? true;
  const maxLeads = options.maxLeads ?? 20;
  if (!Number.isInteger(maxLeads) || maxLeads < 1 || maxLeads > 100) {
    throw new Error("SALES_ENGINE_INVALID_MAX_LEADS");
  }

  const found = await dependencies.discover();
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const unique: SalesLead[] = [];
  const seenEmails = new Set<string>();
  const seenCompanies = new Set<string>();
  const seenDomains = new Set<string>();

  for (const lead of found) {
    const email = normalizeEmail(lead);
    const company = normalizeCompany(lead);
    const domain = normalizeWebsiteDomain(lead);
    if (!email && !company) {
      skip("missing_identity");
      continue;
    }
    if (
      (email && seenEmails.has(email)) ||
      (company && seenCompanies.has(company)) ||
      (domain && seenDomains.has(domain))
    ) {
      skip("duplicate");
      continue;
    }
    if (email) seenEmails.add(email);
    if (company) seenCompanies.add(company);
    if (domain) seenDomains.add(domain);
    unique.push(lead);
  }

  const queue: Array<SalesLead & { research: LeadResearch }> = [];
  const reviewRequired: SalesEngineReviewItem[] = [];
  let researched = 0;

  for (const candidate of unique.slice(0, maxLeads)) {
    let lead: SalesLead;
    try {
      lead = await dependencies.enrich(candidate);
    } catch {
      skip("enrichment_failed");
      continue;
    }

    const email = normalizeEmail(lead);
    if (!email) {
      skip("missing_email");
      continue;
    }
    if (!isValidEmail(email)) {
      skip("invalid_email_format");
      continue;
    }

    let verification: { valid: boolean; reason?: string };
    try {
      verification = await dependencies.verifyContact(lead);
    } catch {
      skip("verification_failed");
      continue;
    }
    if (!verification.valid) {
      skip("invalid_contact");
      continue;
    }

    let suppressed: boolean;
    try {
      suppressed = await dependencies.isSuppressed(email);
    } catch {
      skip("suppression_check_failed");
      continue;
    }
    if (suppressed) {
      skip("suppressed");
      continue;
    }

    let research: LeadResearch;
    try {
      research = await dependencies.research(lead);
      researched += 1;
    } catch {
      skip("research_failed");
      continue;
    }

    const hasEvidence = Array.isArray(research.evidence) &&
      research.evidence.some((item) => typeof item === "string" && item.trim().length >= 12);
    const hasDraft = Boolean(research.draft?.subject?.trim() && research.draft?.body?.trim());
    const validScore = Number.isFinite(research.score) && research.score >= 0 && research.score <= 100;
    if (research.requiresHumanReview || !hasEvidence || !hasDraft || !validScore) {
      const reason = research.requiresHumanReview
        ? "human_review_required"
        : "insufficient_evidence_or_draft";
      reviewRequired.push({ lead, reason, research });
      skip(reason);
      continue;
    }

    queue.push({ ...lead, research });
  }

  // This is a queue-ingestion boundary only. It does not authorize or perform email sends.
  if (!dryRun && queue.length > 0) {
    await dependencies.ingest(queue);
  }

  return {
    discovered: found.length,
    deduplicated: unique.length,
    researched,
    queued: queue.length,
    reviewRequired,
    skipped,
    dryRun
  };
}
