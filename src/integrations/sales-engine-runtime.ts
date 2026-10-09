import { createHash } from "node:crypto";
import { createKeeLeadClient, type KeeLeadClient } from "./keelead.js";
import { createOpenOutSendIngestClient, type OpenOutSendLead } from "./openoutsend-ingest.js";
import { auditCandidate, type GoogleCandidate } from "./website-audit.js";
import { researchContactAndDraft } from "./contact-research.js";
import type { LeadResearch, SalesEngineDependencies, SalesLead } from "./sales-engine.js";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordLike
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function websiteFrom(value: unknown): string | undefined {
  const raw = nonEmptyString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function parseKeeLeadSearch(payload: unknown): SalesLead[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.leads)) throw new Error("KEELEAD_INVALID_SEARCH_RESPONSE");
  return root.leads.flatMap((value) => {
    const row = asRecord(value);
    if (!row) return [];
    const company = nonEmptyString(row.company) ?? nonEmptyString(row.companyName) ?? nonEmptyString(row.name);
    if (!company) return [];
    const domain = nonEmptyString(row.domain);
    const website = websiteFrom(row.website) ?? websiteFrom(domain);
    return [{
      id: nonEmptyString(row.id) ?? nonEmptyString(row.lead_id),
      company,
      email: nonEmptyString(row.email)?.toLowerCase(),
      website,
      title: nonEmptyString(row.title),
      location: nonEmptyString(row.location),
      industry: nonEmptyString(row.industry),
      linkedin: nonEmptyString(row.linkedin)
    }];
  });
}

export function parseKeeLeadVerification(payload: unknown, expectedEmail: string): { valid: boolean; reason?: string } {
  const root = asRecord(payload);
  if (!root) return { valid: false, reason: "verification_response_invalid" };
  const rows = Array.isArray(root.results) ? root.results.map(asRecord).filter((x): x is RecordLike => Boolean(x)) : [root];
  const expected = expectedEmail.trim().toLowerCase();
  const row = rows.find((item) => nonEmptyString(item.email)?.toLowerCase() === expected)
    ?? (rows.length === 1 && !nonEmptyString(rows[0]?.email) ? rows[0] : undefined);
  if (!row) return { valid: false, reason: "verification_result_not_found" };
  const status = (nonEmptyString(row.status) ?? nonEmptyString(row.verdict) ?? "").toLowerCase();
  const valid = row.valid === true || row.isValid === true || status === "valid" || status === "deliverable";
  const disposable = row.disposable === true || row.disposable_email === true;
  return valid && !disposable
    ? { valid: true }
    : { valid: false, reason: disposable ? "disposable_email" : "email_not_verified" };
}

export type AirtableSuppressionOptions = {
  apiToken?: string;
  baseId?: string;
  tableName?: string;
  fetchImpl?: typeof fetch;
};

export function createAirtableSuppressionChecker(options: AirtableSuppressionOptions = {}): (email: string) => Promise<boolean> {
  const apiToken = (options.apiToken ?? process.env.AIRTABLE_API_TOKEN ?? "").trim();
  const baseId = (options.baseId ?? process.env.GULLKORNET_AIRTABLE_BASE_ID ?? "").trim();
  const tableName = (options.tableName ?? process.env.GULLKORNET_AIRTABLE_TABLE ?? "Leads").trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  let suppressedCache: Promise<Set<string>> | undefined;

  async function loadSuppressed(): Promise<Set<string>> {
    if (!apiToken || !baseId || !tableName) throw new Error("AIRTABLE_SUPPRESSION_NOT_CONFIGURED");
    const suppressed = new Set<string>();
    let offset: string | undefined;
    do {
      const url = new URL("https://api.airtable.com/v0/" + baseId + "/" + encodeURIComponent(tableName));
      url.searchParams.set("pageSize", "100");
      url.searchParams.append("fields[]", "Email");
      url.searchParams.append("fields[]", "Do Not Contact");
      url.searchParams.append("fields[]", "Lead Status");
      if (offset) url.searchParams.set("offset", offset);
      const response = await fetchImpl(url.toString(), {
        headers: { Authorization: "Bearer " + apiToken, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error("AIRTABLE_SUPPRESSION_HTTP_" + response.status);
      const payload = asRecord(await response.json());
      if (!payload || !Array.isArray(payload.records)) throw new Error("AIRTABLE_SUPPRESSION_INVALID_RESPONSE");
      for (const recordValue of payload.records) {
        const record = asRecord(recordValue);
        const fields = asRecord(record?.fields);
        if (fields?.["Do Not Contact"] !== true && fields?.["Lead Status"] !== "Suppressed") continue;
        const email = nonEmptyString(fields.Email)?.toLowerCase();
        if (email) suppressed.add(email);
      }
      offset = nonEmptyString(payload.offset);
    } while (offset);
    return suppressed;
  }

  return async (email: string) => {
    suppressedCache ??= loadSuppressed();
    return (await suppressedCache).has(email.trim().toLowerCase());
  };
}

export type Phase9RuntimeOptions = {
  keeLead?: KeeLeadClient;
  isSuppressed?: (email: string) => Promise<boolean>;
  ingest?: (leads: OpenOutSendLead[]) => Promise<unknown>;
  fetchImpl?: typeof fetch;
  query?: string;
  location?: string;
  industry?: string;
  count?: number;
};

export function createPhase9SalesEngineDependencies(options: Phase9RuntimeOptions = {}): SalesEngineDependencies {
  const fetchImpl = options.fetchImpl ?? fetch;
  const keeLead = options.keeLead ?? createKeeLeadClient({
    baseUrl: process.env.KEELEAD_API_URL ?? "https://keelead-production-9f05.up.railway.app",
    fetchImpl
  });
  const isSuppressed = options.isSuppressed ?? createAirtableSuppressionChecker({ fetchImpl });
  const openOutSend = createOpenOutSendIngestClient({ fetchImpl });

  return {
    async discover() {
      const count = Math.min(100, Math.max(1, Math.floor(options.count ?? Number(process.env.GULLKORNET_DISCOVERY_COUNT ?? 20))));
      const result = await keeLead.searchLeads({
        query: options.query ?? process.env.GULLKORNET_DISCOVERY_QUERY ?? "web design businesses in Oslo",
        count,
        location: options.location ?? process.env.GULLKORNET_DISCOVERY_LOCATION ?? "Oslo",
        industry: options.industry ?? process.env.GULLKORNET_DISCOVERY_INDUSTRY ?? "professional services"
      });
      return parseKeeLeadSearch(result);
    },

    async enrich(lead) {
      const result = asRecord(await keeLead.enrichLead({
        company: lead.company,
        domain: lead.website ? new URL(lead.website).hostname : undefined,
        email: lead.email,
        website: lead.website
      }));
      if (!result) throw new Error("KEELEAD_INVALID_ENRICH_RESPONSE");
      const merged: SalesLead = { ...lead };
      for (const key of ["id", "lead_id", "company", "companyName", "email", "website", "domain", "title", "firstName", "lastName", "linkedin"]) {
        const value = nonEmptyString(result[key]);
        if (!value) continue;
        if (key === "companyName") merged.company = value;
        else if (key === "domain" && !merged.website) merged.website = websiteFrom(value);
        else if (key === "website") {
          const safeWebsite = websiteFrom(value);
          if (safeWebsite) merged.website = safeWebsite;
        }
        else if (key === "lead_id") merged.id = value;
        else if (key === "firstName") merged.firstName = value;
        else if (key === "lastName") merged.lastName = value;
        else if (key === "linkedin") merged.linkedin = value;
        else merged[key] = value;
      }
      if (typeof merged.email === "string") merged.email = merged.email.trim().toLowerCase();
      return merged;
    },

    async verifyContact(lead) {
      const result = await keeLead.verifyEmail({ email: lead.email });
      return parseKeeLeadVerification(result, lead.email ?? "");
    },

    async research(lead): Promise<LeadResearch> {
      const candidate: GoogleCandidate = {
        companyName: lead.company ?? "Unknown business",
        websiteUrl: lead.website,
        city: nonEmptyString(lead.location),
        industry: nonEmptyString(lead.industry)
      };
      const audit = await auditCandidate(candidate);
      const contact = await researchContactAndDraft(candidate, audit);
      const evidence = [
        contact.pageTitle,
        contact.headline,
        contact.serviceEvidence,
        ...audit.flags.map((flag) => "Automated website signal: " + flag)
      ].filter((value): value is string => typeof value === "string" && value.trim().length >= 12);
      const score = Math.max(0, Math.min(100, 40 + audit.flags.length * 8 + (audit.status === "NO_WEBSITE" ? 20 : 0)));
      return {
        websiteUrl: contact.websiteUrl,
        evidence,
        score,
        // Contact research deliberately requires human review. Do not bypass this gate
        // merely because a provider returned a syntactically valid email.
        requiresHumanReview: true,
        draft: contact.subject && contact.draftBody
          ? { subject: contact.subject, body: contact.draftBody }
          : undefined
      };
    },

    isSuppressed,

    async ingest(leads) {
      const payload: OpenOutSendLead[] = leads.map((lead) => {
        const email = String(lead.email ?? "").trim().toLowerCase();
        const company = String(lead.company ?? "Unknown business").trim();
        const providerId = nonEmptyString(lead.id);
        const stableMaterial = providerId ?? company.toLowerCase() + "|" + email;
        const leadId = "cidea-" + createHash("sha256").update(stableMaterial).digest("hex").slice(0, 32);
        return {
          lead_id: leadId,
          email,
          company,
          website: lead.website,
          title: nonEmptyString(lead.title),
          reason: lead.research.evidence.slice(0, 5).join("; "),
          profile_text: lead.research.evidence.join("\n"),
          qualified_at: new Date().toISOString()
        };
      });
      if (options.ingest) {
        await options.ingest(payload);
      } else {
        await openOutSend.ingestLeads(payload);
      }
    }
  };
}
