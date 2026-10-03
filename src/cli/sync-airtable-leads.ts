import "dotenv/config";
import { readFile } from "node:fs/promises";

type EmailSource = { email: string; sourceUrl: string; sourceType?: string };
type ResearchRecord = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  industry?: string;
  sourceUrl?: string;
  researchStatus?: string;
  pageTitle?: string;
  headline?: string;
  serviceEvidence?: string;
  emails?: EmailSource[];
  subject?: string;
  draftBody?: string;
  personalizationEvidence?: string;
  contactPageUrl?: string;
  notes?: string[];
  researchedAt?: string;
};
type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};
type AirtableListResponse = { records: AirtableRecord[]; offset?: string };
type AirtableWriteResponse = { records: AirtableRecord[] };

const apiToken = process.env.AIRTABLE_API_TOKEN?.trim();
const baseId = process.env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
const tableName = process.env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
const inputPath = process.argv[2] || "data/contact-research-drafts.json";
const API_ROOT = "https://api.airtable.com/v0";

if (!apiToken || !baseId) {
  console.error("AIRTABLE_SYNC_SKIPPED: set AIRTABLE_API_TOKEN and GULLKORNET_AIRTABLE_BASE_ID.");
  process.exit(1);
}

function normalizeDomain(value?: string): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("nb-NO").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function duplicateKey(item: ResearchRecord): string {
  return normalizeDomain(item.websiteUrl) || `name:${normalizeName(item.companyName)}`;
}

function getStatus(item: ResearchRecord, existing?: AirtableRecord): string {
  const existingStatus = existing?.fields["Lead Status"];
  const doNotContact = existing?.fields["Do Not Contact"] === true;
  const hasCurrentEmail = Boolean(item.emails?.length);
  const hasExistingEmail = typeof existing?.fields["Email"] === "string" && Boolean((existing.fields["Email"] as string).trim());
  const hasCurrentDraft = Boolean(item.subject && item.draftBody);
  const hasExistingDraft = typeof existing?.fields["Outreach Subject"] === "string"
    && Boolean((existing.fields["Outreach Subject"] as string).trim())
    && typeof existing?.fields["Outreach Draft"] === "string"
    && Boolean((existing.fields["Outreach Draft"] as string).trim());

  if (doNotContact || existingStatus === "Suppressed") return "Suppressed";
  if (["Sent", "Replied", "Approved", "Follow-up"].includes(String(existingStatus))) return String(existingStatus);
  if (item.notes?.some((note) => note.includes("MANUAL REVIEW:"))) return "Needs Review";
  // The sync only overwrites non-empty fields, so a missing email/draft in a later
  // research run does not erase an older saved value. Status must reflect that
  // retained data rather than incorrectly labeling the record "No Public Email".
  if ((hasCurrentEmail || hasExistingEmail) && (hasCurrentDraft || hasExistingDraft)) return "Draft Ready";
  if (hasCurrentEmail || hasExistingEmail) return "Researched";
  if (item.researchStatus === "NO_WEBSITE" || item.emails?.length === 0) return "No Public Email";
  return "Needs Review";
}

async function airtableRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...init.headers
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`AIRTABLE_REQUEST_FAILED status=${response.status} detail=${detail}`);
  }
  return await response.json() as T;
}

async function listAllRecords(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`${API_ROOT}/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("fields[]", "Duplicate Key");
    url.searchParams.append("fields[]", "Lead Status");
    url.searchParams.append("fields[]", "Do Not Contact");
    if (offset) url.searchParams.set("offset", offset);
    const page = await airtableRequest<AirtableListResponse>(url.toString());
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

function fieldsFor(item: ResearchRecord, key: string, existing?: AirtableRecord): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Company: item.companyName.trim(),
    "Lead Status": getStatus(item, existing),
    "Duplicate Key": key,
    "Last Seen": new Date().toISOString()
  };
  const put = (field: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) fields[field] = value.trim();
  };
  put("Website", item.websiteUrl);
  put("City", item.city);
  put("Industry", item.industry);
  put("Discovery Source URL", item.sourceUrl);
  put("Contact Source URL", item.emails?.[0]?.sourceUrl || item.contactPageUrl);
  put("Email", item.emails?.[0]?.email);
  put("Outreach Subject", item.subject);
  put("Outreach Draft", item.draftBody);
  const observedEvidence = [
    item.pageTitle ? `Sidetittel: ${item.pageTitle}` : "",
    item.headline ? `Overskrift: ${item.headline}` : "",
    item.serviceEvidence ? `Tjenestetekst: ${item.serviceEvidence}` : ""
  ].filter(Boolean);
  const evidenceSummary = observedEvidence.length
    ? `Automatisk hentet fra offentlig nettside, ikke uavhengig verifisert og ikke fremsatt som et konkret problem i e-postutkastet: ${observedEvidence.join(" | ")}`
    : item.personalizationEvidence;
  put("Personalization Evidence", evidenceSummary);
  put("Research Notes", item.notes?.join("\n"));
  if (!existing?.fields["First Seen"]) fields["First Seen"] = item.researchedAt || new Date().toISOString();
  // Never clear or uncheck an existing do-not-contact flag.
  if (existing?.fields["Do Not Contact"] === true) fields["Do Not Contact"] = true;
  return fields;
}

async function writeBatch(
  mode: "create" | "update",
  items: Array<{ item: ResearchRecord; key: string; existing?: AirtableRecord }>
): Promise<number> {
  let written = 0;
  for (let start = 0; start < items.length; start += 10) {
    const chunk = items.slice(start, start + 10);
    const records = chunk.map(({ item, key, existing }) => ({
      ...(mode === "update" && existing ? { id: existing.id } : {}),
      fields: fieldsFor(item, key, existing)
    }));
    const endpoint = `${API_ROOT}/${baseId}/${encodeURIComponent(tableName)}`;
    const result = await airtableRequest<AirtableWriteResponse>(endpoint, {
      method: mode === "create" ? "POST" : "PATCH",
      body: JSON.stringify({ records, typecast: true })
    });
    written += result.records.length;
  }
  return written;
}

try {
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Contact research input must be a JSON array.");
  const research = (parsed as ResearchRecord[]).filter((item) =>
    item && typeof item.companyName === "string" && item.companyName.trim()
  );

  const existingRecords = await listAllRecords();
  const existingByKey = new Map<string, AirtableRecord>();
  for (const record of existingRecords) {
    const key = record.fields["Duplicate Key"];
    if (typeof key === "string" && key) existingByKey.set(key, record);
  }

  const unique = new Map<string, ResearchRecord>();
  for (const item of research) {
    const key = duplicateKey(item);
    if (!key || key === "name:") continue;
    const prior = unique.get(key);
    // Keep the most useful record if a run contains duplicate businesses.
    if (!prior || ((prior.emails?.length ?? 0) === 0 && (item.emails?.length ?? 0) > 0)) unique.set(key, item);
  }

  const creates: Array<{ item: ResearchRecord; key: string }> = [];
  const updates: Array<{ item: ResearchRecord; key: string; existing: AirtableRecord }> = [];
  for (const [key, item] of unique) {
    const existing = existingByKey.get(key);
    if (existing) updates.push({ item, key, existing });
    else creates.push({ item, key });
  }

  const updated = await writeBatch("update", updates);
  const created = await writeBatch("create", creates);
  console.log(JSON.stringify({
    baseId,
    tableName,
    inputRecords: research.length,
    uniqueBusinesses: unique.size,
    created,
    updated,
    skipped: research.length - unique.size,
    emailsSent: 0
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Airtable lead sync failed.");
  process.exitCode = 1;
}
