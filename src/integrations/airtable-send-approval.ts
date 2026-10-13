import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import { businessDomainOf } from "../domain/email-domain.js";
import { isSharedBusinessInbox } from "./outbound-email.js";

export type AirtableSendApproval = {
  id: string;
  fields: {
    Email?: unknown;
    Website?: unknown;
    "Contact Source URL"?: unknown;
    "Personalization Evidence"?: unknown;
    "Research Notes"?: unknown;
    "Lead Status"?: unknown;
    "Do Not Contact"?: unknown;
    "AI Decision"?: unknown;
    "AI Confidence"?: unknown;
    "AI Evidence"?: unknown;
    "AI Evidence URL"?: unknown;
    "AI Decision Reason"?: unknown;
    "AI Draft Subject"?: unknown;
    "AI Draft Body"?: unknown;
  };
};

/**
 * A policy refusal for ONE record (DNC, duplicate, missing evidence, low confidence, ...).
 * The sender skips that record and keeps looking. Any other error (Airtable or reply-service
 * outage, bad configuration) is not a SendRefusedError and aborts the whole run: fail closed.
 */
export class SendRefusedError extends Error {}

export type ApprovedDraft = { subject: string; text: string };
type AirtableQueueResponse = { records: AirtableSendApproval[]; offset?: string };

const API_ROOT = "https://api.airtable.com/v0";

function airtableConfig(env: NodeJS.ProcessEnv) {
  const apiToken = env.AIRTABLE_API_TOKEN?.trim();
  const baseId = env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
  const tableName = env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
  if (!apiToken || !baseId || !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    throw new Error("Airtable token and valid base ID are required to load approved outreach. Refusing to send.");
  }
  return { apiToken, baseId, tableName };
}

export async function fetchApprovedOutreachQueue(
  env: NodeJS.ProcessEnv = process.env
): Promise<AirtableSendApproval[]> {
  const { apiToken, baseId, tableName } = airtableConfig(env);
  const records: AirtableSendApproval[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(API_ROOT + "/" + baseId + "/" + encodeURIComponent(tableName));
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("filterByFormula", 'AND({Lead Status} = "Draft Ready", {AI Decision} = "APPROVE", {AI Confidence} >= 0.9, {Do Not Contact} = 0)');
    for (const field of ["Email", "Website", "Contact Source URL", "Personalization Evidence", "Research Notes", "Lead Status", "Do Not Contact", "AI Decision", "AI Confidence", "AI Evidence", "AI Evidence URL", "AI Decision Reason", "AI Draft Subject", "AI Draft Body"]) {
      url.searchParams.append("fields[]", field);
    }
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url.toString(), {
      headers: { Authorization: "Bearer " + apiToken, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Airtable approved queue check failed (HTTP ${response.status}). Refusing to send.`);
    const payload: unknown = await response.json().catch(() => null);
    if (typeof payload !== "object" || payload === null || !("records" in payload) || !Array.isArray((payload as { records: unknown }).records)) {
      throw new Error("Airtable returned an invalid approved queue. Refusing to send.");
    }
    records.push(...(payload as AirtableQueueResponse).records);
    offset = typeof (payload as AirtableQueueResponse).offset === "string" ? (payload as AirtableQueueResponse).offset : undefined;
    if (!offset) return records;
  }
  throw new Error("Airtable approved queue exceeded the safe pagination limit. Refusing to send.");
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// A business in any of these states has been contacted, has answered, or must not be
// contacted. No other address at the same business may be sent to.
const BUSINESS_BLOCKING_STATUSES = new Set([
  "Sent", "Replied", "Contacted", "Suppressed", "Do Not Contact", "Follow-up", "Meeting", "Won", "Lost"
]);

function assertBusinessNotAlreadyContacted(
  records: AirtableSendApproval[],
  approvedRecord: AirtableSendApproval,
  recipient: string
): void {
  const domain = businessDomainOf(recipient);
  if (!domain) return;
  const blocked = records.some((record) =>
    record !== approvedRecord &&
    businessDomainOf(normalizeEmail(record.fields.Email)) === domain &&
    (record.fields["Do Not Contact"] === true ||
      BUSINESS_BLOCKING_STATUSES.has(String(record.fields["Lead Status"] ?? "")))
  );
  if (blocked) {
    throw new SendRefusedError("Another Airtable record for the same business domain is already contacted, replied, or suppressed. Refusing to send.");
  }
}

export function assertAirtableRecipientApproved(
  records: AirtableSendApproval[],
  recipient: string,
  expected: ApprovedDraft
): string {
  const normalized = normalizeEmail(recipient);
  const matches = records.filter(record => normalizeEmail(record.fields.Email) === normalized);
  if (matches.length !== 1) {
    throw new SendRefusedError(`Airtable must contain exactly one record for the recipient; found ${matches.length}. Refusing to send.`);
  }
  const fields = matches[0].fields;
  assertBusinessNotAlreadyContacted(records, matches[0], normalized);
  // Airtable's API omits an unchecked checkbox instead of returning false, so absent means
  // unchecked. Every Do Not Contact read also passes a formula that references the field
  // (see approvalLookupFormula and the queue filter), so a renamed field errors instead.
  if (fields["Do Not Contact"] !== undefined && fields["Do Not Contact"] !== false) {
    throw new SendRefusedError("Airtable Do Not Contact is enabled or has an unexpected value. Refusing to send.");
  }
  if (fields["Lead Status"] !== "Draft Ready") {
    throw new SendRefusedError("Airtable Lead Status must be Draft Ready before AI-approved sending.");
  }
  if (fields["AI Decision"] !== "APPROVE") {
    throw new SendRefusedError("Airtable AI Decision must be APPROVE before sending.");
  }
  if (typeof fields["AI Confidence"] !== "number" || fields["AI Confidence"] < 0.9) {
    throw new SendRefusedError("Airtable AI Confidence must be at least 0.90 before sending.");
  }
  if (fields["AI Draft Subject"] !== expected.subject || fields["AI Draft Body"] !== expected.text) {
    throw new SendRefusedError("The AI-approved Airtable subject and draft must exactly match the message to be sent.");
  }
  // A strategic account needs deeper research and must not receive ordinary automated outreach.
  if (typeof fields["Research Notes"] === "string" && fields["Research Notes"].includes("[GK-ROUTE:STRATEGIC_ACCOUNT]")) {
    throw new SendRefusedError("Strategic accounts are not eligible for automated outreach. Refusing to send.");
  }
  const evidence = fields["AI Evidence"];
  const evidenceUrl = typeof fields["AI Evidence URL"] === "string" ? fields["AI Evidence URL"] : "";
  const personalEvidence = typeof fields["Personalization Evidence"] === "string" ? fields["Personalization Evidence"] : "";
  if (typeof evidence !== "string" || !evidence.trim() || !personalEvidence.includes(evidence.trim())) {
    throw new SendRefusedError("AI evidence must match the public-site research evidence exactly.");
  }
  const website = typeof fields.Website === "string" ? fields.Website : "";
  const contactUrl = typeof fields["Contact Source URL"] === "string" ? fields["Contact Source URL"] : "";
  const evidenceHost = hostOf(evidenceUrl);
  const websiteHost = hostOf(website);
  if (!evidenceHost || !websiteHost || !isSameSite(evidenceHost, websiteHost) || hostOf(contactUrl) !== websiteHost) {
    throw new SendRefusedError("AI evidence and contact source must be on the business's official website.");
  }
  const emailDomain = normalized.split("@").at(-1) ?? "";
  if (emailDomain !== websiteHost) {
    throw new SendRefusedError("The public shared-inbox email domain must match the official business website.");
  }
  if (!/(?:nei takk|ikke ønsker flere|stoppe henvendelser)/i.test(expected.text)) {
    throw new SendRefusedError("The draft must include a clear opt-out instruction before sending.");
  }
  const recordId = matches[0].id;
  if (typeof recordId !== "string" || !/^rec[A-Za-z0-9]+$/.test(recordId)) {
    throw new SendRefusedError("Airtable approval record has no valid record ID. Refusing to send.");
  }
  return recordId;
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Approval lookup. Deliberately does NOT filter out Do Not Contact rows (the field reference is only a tripwire): a suppressed
 * duplicate must be returned so the exactly-one check fails closed. Matching is
 * case/whitespace-insensitive, and for business domains it also returns records at the
 * same domain so a business is not contacted twice through another address.
 */
export function approvalLookupFormula(recipient: string): string {
  const email = recipient.trim().toLowerCase();
  const exact = `LOWER(TRIM({Email})) = "${escapeFormulaString(email)}"`;
  const domain = businessDomainOf(email);
  const match = domain
    ? `OR(${exact}, RIGHT(LOWER(TRIM({Email})), ${domain.length + 1}) = "${escapeFormulaString("@" + domain)}")`
    : exact;
  // Always true for a checkbox; it only makes Airtable reject the query if the field is missing.
  return `AND(${match}, OR({Do Not Contact} = 0, {Do Not Contact} = 1))`;
}

export async function fetchAirtableRecipientApproval(
  recipient: string,
  expected: ApprovedDraft,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const { apiToken, baseId, tableName } = airtableConfig(env);

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
  url.searchParams.set("filterByFormula", approvalLookupFormula(recipient));
  url.searchParams.set("pageSize", "100");
  for (const field of ["Email", "Website", "Contact Source URL", "Personalization Evidence", "Research Notes", "Lead Status", "Do Not Contact", "AI Decision", "AI Confidence", "AI Evidence", "AI Evidence URL", "AI Decision Reason", "AI Draft Subject", "AI Draft Body"]) {
    url.searchParams.append("fields[]", field);
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiToken}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`Airtable approval check failed with HTTP ${response.status}. Refusing to send.`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || !("records" in payload) ||
      !Array.isArray((payload as { records: unknown }).records)) {
    throw new Error("Airtable returned an invalid approval response. Refusing to send.");
  }
  const records = (payload as { records: AirtableSendApproval[] }).records;
  // A paginated result is unexpected for an exact email lookup; do not assume the first page is complete.
  if ("offset" in payload && typeof (payload as { offset?: unknown }).offset === "string") {
    throw new Error("Airtable approval lookup was paginated. Refusing to send until duplicates are reconciled.");
  }
  return assertAirtableRecipientApproved(records, recipient, expected);
}

function hostOf(value: string): string {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return ""; }
}

function isSameSite(candidateHost: string, websiteHost: string): boolean {
  return candidateHost === websiteHost || candidateHost.endsWith("." + websiteHost);
}

export async function markAirtableRecipientSent(
  recordId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  assertAirtableWritesAllowed(env);
  const apiToken = env.AIRTABLE_API_TOKEN?.trim();
  const baseId = env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
  const tableName = env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
  if (!apiToken || !baseId || !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    throw new Error("Airtable credentials are required to record the accepted send. Manual reconciliation is required.");
  }
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) {
    throw new Error("Airtable record ID is invalid. Manual reconciliation is required.");
  }

  const response = await fetch(
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}/${recordId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields: { "Lead Status": "Sent" } }),
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!response.ok) {
    throw new Error(`Resend accepted the email, but Airtable could not be marked Sent (HTTP ${response.status}). Reconcile the record before retrying.`);
  }
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null || !("id" in payload) ||
      (payload as { id: unknown }).id !== recordId || !("fields" in payload)) {
    throw new Error("Resend accepted the email, but Airtable's Sent state could not be verified. Reconcile before retrying.");
  }
  const fields = (payload as { fields: unknown }).fields;
  if (typeof fields !== "object" || fields === null ||
      (fields as Record<string, unknown>)["Lead Status"] !== "Sent") {
    throw new Error("Resend accepted the email, but Airtable's Sent state could not be verified. Reconcile before retrying.");
  }
}

/**
 * Extracts the exact message the sender would use for a queue record, or undefined if the
 * record is not eligible on its own (missing or non-role address, missing draft, or any
 * single-record approval rule fails). The full duplicate/DNC lookup happens separately.
 */
export function eligibleDraftFromRecord(record: AirtableSendApproval): { email: string; subject: string; text: string } | undefined {
  const fields = record.fields;
  const email = typeof fields.Email === "string" ? fields.Email.trim().toLowerCase() : "";
  const subject = typeof fields["AI Draft Subject"] === "string" ? fields["AI Draft Subject"].trim() : "";
  const text = typeof fields["AI Draft Body"] === "string" ? fields["AI Draft Body"].trim() : "";
  if (!email || !subject || !text || !isSharedBusinessInbox(email)) return undefined;
  try {
    assertAirtableRecipientApproved([record], email, { subject, text });
    return { email, subject, text };
  } catch (error) {
    if (error instanceof SendRefusedError) return undefined;
    throw error;
  }
}
