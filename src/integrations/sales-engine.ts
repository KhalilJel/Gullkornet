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

export type SalesEngineResult = {
  discovered: number;
  deduplicated: number;
  researched: number;
  queued: number;
  skipped: Record<string, number>;
  dryRun: boolean;
};

function emailOf(lead: SalesLead): string {
  return typeof lead.email === "string" ? lead.email.trim().toLowerCase() : "";
}

/**
 * Phase 9 orchestration boundary. This function prepares a qualified queue only.
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
  const seen = new Set<string>();

  for (const lead of found) {
    const email = emailOf(lead);
    const company = typeof lead.company === "string" ? lead.company.trim().toLowerCase() : "";
    const key = email || (company ? "company:" + company : "");
    if (!key) { skip("missing_identity"); continue; }
    if (seen.has(key)) { skip("duplicate"); continue; }
    seen.add(key);
    unique.push(lead);
  }

  const queue: Array<SalesLead & { research: LeadResearch }> = [];
  let researched = 0;

  for (const candidate of unique.slice(0, maxLeads)) {
    let lead: SalesLead;
    try {
      lead = await dependencies.enrich(candidate);
    } catch {
      skip("enrichment_failed");
      continue;
    }

    const email = emailOf(lead);
    if (!email) { skip("missing_email"); continue; }

    let verification: { valid: boolean; reason?: string };
    try {
      verification = await dependencies.verifyContact(lead);
    } catch {
      skip("verification_failed");
      continue;
    }
    if (!verification.valid) { skip("invalid_contact"); continue; }

    let suppressed: boolean;
    try {
      suppressed = await dependencies.isSuppressed(email);
    } catch {
      skip("suppression_check_failed");
      continue;
    }
    if (suppressed) { skip("suppressed"); continue; }

    let research: LeadResearch;
    try {
      research = await dependencies.research(lead);
      researched += 1;
    } catch {
      skip("research_failed");
      continue;
    }

    if (research.requiresHumanReview || research.evidence.length === 0 || !research.draft?.subject?.trim() || !research.draft?.body?.trim()) {
      skip("insufficient_evidence_or_draft");
      continue;
    }

    queue.push({ ...lead, research });
  }

  if (!dryRun && queue.length > 0) {
    await dependencies.ingest(queue);
  }

  return {
    discovered: found.length,
    deduplicated: unique.length,
    researched,
    queued: queue.length,
    skipped,
    dryRun
  };
}
