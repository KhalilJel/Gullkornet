import type { Lead } from "./lead.js";

export type DeduplicationResult = {
  uniqueLeads: Lead[];
  duplicates: Array<{ keptLeadId: string; duplicateLeadId: string; matchedOn: "domain" | "email" }>;
};

export function normalizeDomain(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
    return hostname || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeEmail(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

export function deduplicateLeads(leads: Lead[]): DeduplicationResult {
  const uniqueLeads: Lead[] = [];
  const duplicates: DeduplicationResult["duplicates"] = [];
  const byDomain = new Map<string, Lead>();
  const byEmail = new Map<string, Lead>();

  for (const lead of leads) {
    const domain = normalizeDomain(lead.websiteUrl);
    const email = normalizeEmail(lead.contactEmail);
    const domainMatch = domain ? byDomain.get(domain) : undefined;
    const emailMatch = email ? byEmail.get(email) : undefined;
    const match = domainMatch ?? emailMatch;

    if (match) {
      duplicates.push({
        keptLeadId: match.id,
        duplicateLeadId: lead.id,
        matchedOn: domainMatch ? "domain" : "email"
      });
      continue;
    }

    uniqueLeads.push(lead);
    if (domain) byDomain.set(domain, lead);
    if (email) byEmail.set(email, lead);
  }

  return { uniqueLeads, duplicates };
}
