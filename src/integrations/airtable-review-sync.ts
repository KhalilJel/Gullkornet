export type EmailSource = { email: string; sourceUrl: string; sourceType?: string };

export type ResearchRecord = {
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
  qualificationStatus?: string;
  fitScore?: number;
  qualificationReasons?: string[];
  notes?: string[];
  researchedAt?: string;
};

type AirtableRecord = { id: string; fields: Record<string, unknown> };
type AirtableListResponse = { records: AirtableRecord[]; offset?: string };
type AirtableWriteResponse = { records: AirtableRecord[] };

export type AirtableReviewSyncOptions = {
  apiToken: string;
  baseId: string;
  tableName?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type AirtableReviewSyncResult = {
  inputRecords: number;
  uniqueBusinesses: number;
  created: number;
  updated: number;
  skipped: number;
};

const API_ROOT = "https://api.airtable.com/v0";
const PRESERVED_STATUSES = new Set([
  "Sent", "Replied", "Approved", "Follow-up", "Contacted", "Meeting", "Won", "Lost", "Do Not Contact"
]);

function normalizeDomain(value?: string): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function normalizeName(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("nb-NO")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function duplicateKey(item: ResearchRecord): string {
  return normalizeDomain(item.websiteUrl) || `name:${normalizeName(item.companyName)}`;
}

function existingStatus(existing?: AirtableRecord): string {
  return typeof existing?.fields["Lead Status"] === "string"
    ? String(existing.fields["Lead Status"])
    : "";
}

function isProtectedRecord(existing?: AirtableRecord): boolean {
  if (!existing) return false;
  return existing.fields["Do Not Contact"] === true
    || existingStatus(existing) === "Suppressed"
    || existingStatus(existing) === "Do Not Contact"
    || PRESERVED_STATUSES.has(existingStatus(existing));
}

function keyForExisting(record: AirtableRecord): string {
  const explicitKey = record.fields["Duplicate Key"];
  if (typeof explicitKey === "string" && explicitKey.trim()) return explicitKey.trim();
  return duplicateKey({
    companyName: typeof record.fields.Company === "string" ? record.fields.Company : "",
    websiteUrl: typeof record.fields.Website === "string" ? record.fields.Website : undefined
  });
}

export function getStatus(item: ResearchRecord, existing?: AirtableRecord): string {
  const status = existingStatus(existing);
  const doNotContact = existing?.fields["Do Not Contact"] === true;

  if (doNotContact) return status === "Do Not Contact" ? "Do Not Contact" : "Suppressed";
  if (status === "Suppressed" || status === "Do Not Contact") return status;
  if (PRESERVED_STATUSES.has(status)) return status;
  if (item.notes?.some((note) => note.includes("MANUAL REVIEW:"))) return "Needs Review";

  const hasCurrentEmail = Boolean(item.emails?.length);
  const hasExistingEmail = typeof existing?.fields["Email"] === "string"
    && Boolean((existing.fields["Email"] as string).trim());
  const hasCurrentDraft = Boolean(item.subject && item.draftBody);
  const hasExistingDraft = typeof existing?.fields["Outreach Subject"] === "string"
    && Boolean((existing.fields["Outreach Subject"] as string).trim())
    && typeof existing?.fields["Outreach Draft"] === "string"
    && Boolean((existing.fields["Outreach Draft"] as string).trim());

  // Preserve existing data when a later run finds less information.
  if ((hasCurrentEmail || hasExistingEmail) && (hasCurrentDraft || hasExistingDraft)) return "Draft Ready";
  if (hasCurrentEmail || hasExistingEmail) return "Researched";
  if (item.researchStatus === "NO_WEBSITE" || item.emails?.length === 0) return "No Public Email";
  return "Needs Review";
}

function fieldsFor(
  item: ResearchRecord,
  key: string,
  existing: AirtableRecord | undefined,
  now: () => Date
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Company: item.companyName.trim(),
    "Lead Status": getStatus(item, existing),
    "Duplicate Key": key,
    "Last Seen": now().toISOString()
  };
  const put = (field: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) fields[field] = value.trim();
  };

  put("Website", item.websiteUrl);
  put("City", item.city);
  put("Industry", item.industry);
  if (!existing?.fields["First Seen"]) fields["First Seen"] = item.researchedAt || now().toISOString();

  // Never overwrite email/draft/research history for sent, replied, approved,
  // follow-up, terminal, suppressed, or do-not-contact records.
  if (!isProtectedRecord(existing)) {
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
  }

  // A sync must never uncheck a suppression flag.
  if (existing?.fields["Do Not Contact"] === true) fields["Do Not Contact"] = true;
  return fields;
}

async function airtableRequest<T>(
  url: string,
  method: "GET" | "POST" | "PATCH",
  options: AirtableReviewSyncOptions,
  body?: string
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = method === "GET" ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        ...(body ? { body } : {}),
        headers: {
          Authorization: "Bearer " + options.apiToken,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      lastError = error;
      if (method === "GET" && attempt + 1 < maxAttempts) continue;
      throw new Error("AIRTABLE_REQUEST_FAILED: network or timeout error");
    }

    if (response.ok) return await response.json() as T;
    const retryable = method === "GET" && (response.status === 429 || response.status >= 500);
    await response.body?.cancel().catch(() => undefined);
    if (retryable && attempt + 1 < maxAttempts) {
      lastError = new Error("AIRTABLE_READ_RETRYABLE_HTTP_" + response.status);
      continue;
    }
    throw new Error("AIRTABLE_REQUEST_FAILED status=" + response.status);
  }

  throw lastError instanceof Error ? lastError : new Error("AIRTABLE_REQUEST_FAILED");
}

async function listAllRecords(options: AirtableReviewSyncOptions, tableName: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(API_ROOT + "/" + options.baseId + "/" + encodeURIComponent(tableName));
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("fields[]", "Duplicate Key");
    url.searchParams.append("fields[]", "Lead Status");
    url.searchParams.append("fields[]", "Do Not Contact");
    url.searchParams.append("fields[]", "Email");
    url.searchParams.append("fields[]", "Outreach Subject");
    url.searchParams.append("fields[]", "Outreach Draft");
    url.searchParams.append("fields[]", "First Seen");
    if (offset) url.searchParams.set("offset", offset);

    const page = await airtableRequest<AirtableListResponse>(url.toString(), "GET", options);
    if (!page || !Array.isArray(page.records)) throw new Error("AIRTABLE_INVALID_LIST_RESPONSE");
    records.push(...page.records);
    offset = typeof page.offset === "string" && page.offset ? page.offset : undefined;
  } while (offset);
  return records;
}

async function writeBatch(
  mode: "create" | "update",
  items: Array<{ item: ResearchRecord; key: string; existing?: AirtableRecord }>,
  options: AirtableReviewSyncOptions,
  tableName: string,
  now: () => Date
): Promise<number> {
  let written = 0;
  for (let start = 0; start < items.length; start += 10) {
    const chunk = items.slice(start, start + 10);
    const records = chunk.map(({ item, key, existing }) => ({
      ...(mode === "update" && existing ? { id: existing.id } : {}),
      fields: fieldsFor(item, key, existing, now)
    }));
    const endpoint = API_ROOT + "/" + options.baseId + "/" + encodeURIComponent(tableName);
    const result = await airtableRequest<AirtableWriteResponse>(
      endpoint,
      mode === "create" ? "POST" : "PATCH",
      options,
      JSON.stringify({ records, typecast: true })
    );
    if (!result || !Array.isArray(result.records)) throw new Error("AIRTABLE_INVALID_WRITE_RESPONSE");
    written += result.records.length;
  }
  return written;
}

/** Idempotent review-record upsert. Reads may retry transient failures; writes do not retry
 * automatically because an ambiguous POST result could otherwise create duplicate records.
 */
export async function syncAirtableReviewRecords(
  input: ResearchRecord[],
  options: AirtableReviewSyncOptions
): Promise<AirtableReviewSyncResult> {
  const apiToken = options.apiToken.trim();
  const baseId = options.baseId.trim();
  const tableName = options.tableName?.trim() || "Leads";
  if (!apiToken || !baseId || !tableName) throw new Error("AIRTABLE_SYNC_NOT_CONFIGURED");
  const normalizedOptions = { ...options, apiToken, baseId, tableName };
  const now = options.now ?? (() => new Date());
  const research = input.filter((item) => item && typeof item.companyName === "string" && item.companyName.trim());

  const existingRecords = await listAllRecords(normalizedOptions, tableName);
  const existingByKey = new Map<string, AirtableRecord>();
  for (const record of existingRecords) {
    const key = keyForExisting(record);
    if (!key || key === "name:") continue;
    const prior = existingByKey.get(key);
    // If historical duplicates exist, prefer the record with protected status so
    // a sync cannot accidentally overwrite a sent/replied/suppressed history.
    if (!prior || (isProtectedRecord(record) && !isProtectedRecord(prior))) {
      existingByKey.set(key, record);
    }
  }

  const unique = new Map<string, ResearchRecord>();
  for (const item of research) {
    const key = duplicateKey(item);
    if (!key || key === "name:") continue;
    const prior = unique.get(key);
    if (!prior || ((prior.emails?.length ?? 0) === 0 && (item.emails?.length ?? 0) > 0)) {
      unique.set(key, item);
    }
  }

  const creates: Array<{ item: ResearchRecord; key: string }> = [];
  const updates: Array<{ item: ResearchRecord; key: string; existing: AirtableRecord }> = [];
  for (const [key, item] of unique) {
    const existing = existingByKey.get(key);
    if (existing) updates.push({ item, key, existing });
    else creates.push({ item, key });
  }

  const updated = await writeBatch("update", updates, normalizedOptions, tableName, now);
  const created = await writeBatch("create", creates, normalizedOptions, tableName, now);
  return {
    inputRecords: research.length,
    uniqueBusinesses: unique.size,
    created,
    updated,
    skipped: research.length - unique.size
  };
}
