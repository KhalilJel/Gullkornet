import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import { businessDomainOf } from "../domain/email-domain.js";
import { duplicateKey } from "../integrations/airtable-review-sync.js";
import { assessLiteRecipient, type LiteRejectReason } from "./recipient-policy.js";
import { LITE_TEMPLATE_VERSION } from "./template.js";

export const LITE_READY_STATUS = "Lite Ready";
export const LITE_MARKER = "[GK-LITE]";

export type LiteSourceCandidate = {
  source: "brreg" | "places";
  organizationNumber?: string;
  companyName: string;
  orgForm?: string;
  email?: string;
  websiteUrl?: string;
  city?: string;
  industry?: string;
  bankrupt?: boolean;
  windingUp?: boolean;
  /** Where the business was found (Brreg unit URL or Places listing). */
  sourceUrl: string;
  /** Where the email address was published (Brreg unit URL or the website page). */
  contactSourceUrl?: string;
};

export type LiteLead = LiteSourceCandidate & { email: string };

export type ExistingIndex = {
  emails: Set<string>;
  businessDomains: Set<string>;
  duplicateKeys: Set<string>;
  organizationNumbers: Set<string>;
};

export type LiteSelection = {
  leads: LiteLead[];
  rejected: Partial<Record<LiteRejectReason, number>>;
  alreadyKnown: number;
  duplicateInBatch: number;
};

export function emptyIndex(): ExistingIndex {
  return { emails: new Set(), businessDomains: new Set(), duplicateKeys: new Set(), organizationNumbers: new Set() };
}

function keyOf(candidate: LiteSourceCandidate): string {
  return duplicateKey({ companyName: candidate.companyName, websiteUrl: candidate.websiteUrl });
}

function isKnown(candidate: LiteSourceCandidate, email: string, index: ExistingIndex): boolean {
  const domain = businessDomainOf(email);
  return index.emails.has(email)
    || (domain !== undefined && index.businessDomains.has(domain))
    || index.duplicateKeys.has(keyOf(candidate))
    || (candidate.organizationNumber !== undefined && index.organizationNumbers.has(candidate.organizationNumber));
}

function remember(candidate: LiteSourceCandidate, email: string, index: ExistingIndex): void {
  index.emails.add(email);
  const domain = businessDomainOf(email);
  if (domain) index.businessDomains.add(domain);
  index.duplicateKeys.add(keyOf(candidate));
  if (candidate.organizationNumber) index.organizationNumbers.add(candidate.organizationNumber);
}

/**
 * Pure selection step: legal recipient policy first, then de-duplication against everything
 * already in Airtable (any status: contacted, replied, DNC, advanced pipeline rows) and within the batch.
 */
export function selectLiteLeads(
  candidates: LiteSourceCandidate[],
  existing: ExistingIndex,
  allowedOrgForms?: readonly string[]
): LiteSelection {
  const seen = emptyIndex();
  const result: LiteSelection = { leads: [], rejected: {}, alreadyKnown: 0, duplicateInBatch: 0 };
  for (const candidate of candidates) {
    const decision = assessLiteRecipient(candidate, allowedOrgForms);
    if (!decision.ok) {
      result.rejected[decision.reason] = (result.rejected[decision.reason] ?? 0) + 1;
      continue;
    }
    if (isKnown(candidate, decision.email, existing)) { result.alreadyKnown++; continue; }
    if (isKnown(candidate, decision.email, seen)) { result.duplicateInBatch++; continue; }
    remember(candidate, decision.email, seen);
    result.leads.push({ ...candidate, email: decision.email });
  }
  return result;
}

export function liteResearchNote(lead: LiteLead): string {
  const parts = [LITE_MARKER, `source=${lead.source}`];
  if (lead.organizationNumber) parts.push(`orgnr=${lead.organizationNumber}`);
  if (lead.orgForm) parts.push(`orgform=${lead.orgForm}`);
  parts.push(`template=${LITE_TEMPLATE_VERSION}`);
  return parts.join(" ");
}

export function liteAirtableFields(lead: LiteLead, now: Date): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Company: lead.companyName.trim(),
    "Duplicate Key": keyOf(lead),
    Email: lead.email,
    "Lead Status": LITE_READY_STATUS,
    "Research Notes": liteResearchNote(lead),
    "Discovery Source URL": lead.sourceUrl,
    "Contact Source URL": lead.contactSourceUrl ?? lead.sourceUrl,
    "First Seen": now.toISOString(),
    "Last Seen": now.toISOString()
  };
  if (lead.websiteUrl) fields.Website = lead.websiteUrl;
  if (lead.city) fields.City = lead.city;
  if (lead.industry) fields.Industry = lead.industry;
  return fields;
}

// ---------- Airtable I/O ----------

type AirtableRecord = { id: string; fields: Record<string, unknown> };

export type AirtableConfig = { apiToken: string; baseId: string; tableName: string; fetchImpl?: typeof fetch };

export function airtableConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AirtableConfig {
  const apiToken = env.AIRTABLE_API_TOKEN?.trim();
  const baseId = env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
  const tableName = env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
  if (!apiToken || !baseId || !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    throw new Error("AIRTABLE_API_TOKEN and a valid GULLKORNET_AIRTABLE_BASE_ID are required.");
  }
  return { apiToken, baseId, tableName };
}

const ORGNR_IN_NOTES = /orgnr=(\d{9})/g;

export function indexFromRecords(records: AirtableRecord[]): ExistingIndex {
  const index = emptyIndex();
  for (const record of records) {
    const email = typeof record.fields.Email === "string" ? record.fields.Email.trim().toLowerCase() : "";
    if (email) {
      index.emails.add(email);
      const domain = businessDomainOf(email);
      if (domain) index.businessDomains.add(domain);
    }
    const key = typeof record.fields["Duplicate Key"] === "string" ? record.fields["Duplicate Key"].trim() : "";
    if (key) index.duplicateKeys.add(key);
    const website = typeof record.fields.Website === "string" ? record.fields.Website : undefined;
    const company = typeof record.fields.Company === "string" ? record.fields.Company : "";
    if (website || company) index.duplicateKeys.add(duplicateKey({ companyName: company, websiteUrl: website }));
    const notes = typeof record.fields["Research Notes"] === "string" ? record.fields["Research Notes"] : "";
    for (const match of notes.matchAll(ORGNR_IN_NOTES)) index.organizationNumbers.add(match[1]);
  }
  return index;
}

/** Reads every row (all statuses). Fails closed: a partial read would let duplicates through. */
export async function fetchExistingIndex(cfg: AirtableConfig): Promise<ExistingIndex> {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 500; page++) {
    const url = new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
    url.searchParams.set("pageSize", "100");
    for (const field of ["Email", "Website", "Company", "Duplicate Key", "Research Notes"]) url.searchParams.append("fields[]", field);
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${cfg.apiToken}` },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Airtable read failed (HTTP ${response.status}); Lite intake stopped.`);
    const payload = await response.json() as { records?: AirtableRecord[]; offset?: string };
    if (!Array.isArray(payload.records)) throw new Error("Airtable returned an invalid list; Lite intake stopped.");
    records.push(...payload.records);
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return indexFromRecords(records);
  }
  throw new Error("Airtable table exceeded the safe pagination limit; Lite intake stopped.");
}

export async function createLiteRecords(
  leads: LiteLead[],
  cfg: AirtableConfig,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date()
): Promise<number> {
  assertAirtableWritesAllowed(env);
  const fetchImpl = cfg.fetchImpl ?? fetch;
  let created = 0;
  for (let i = 0; i < leads.length; i += 10) {
    const batch = leads.slice(i, i + 10);
    const response = await fetchImpl(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: batch.map(lead => ({ fields: liteAirtableFields(lead, now()) })), typecast: true }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`Airtable create failed (HTTP ${response.status}) after ${created} records.`);
    const payload = await response.json() as { records?: unknown[] };
    created += Array.isArray(payload.records) ? payload.records.length : 0;
    // Airtable allows 5 requests/second per base.
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return created;
}
