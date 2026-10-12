export type AirtableSendApproval = {
  id: string;
  fields: {
    Email?: unknown;
    "Lead Status"?: unknown;
    "Review Status"?: unknown;
    "Do Not Contact"?: unknown;
    "Outreach Subject"?: unknown;
    "Outreach Draft"?: unknown;
    "Verified Observation"?: unknown;
  };
};

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
    url.searchParams.set("filterByFormula", 'AND({Lead Status} = "Approved", {Review Status} = "Ready for outreach", {Do Not Contact} = 0)');
    for (const field of ["Email", "Lead Status", "Review Status", "Do Not Contact", "Outreach Subject", "Outreach Draft", "Verified Observation"]) {
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

export function assertAirtableRecipientApproved(
  records: AirtableSendApproval[],
  recipient: string,
  expected: ApprovedDraft
): string {
  const normalized = normalizeEmail(recipient);
  const matches = records.filter(record => normalizeEmail(record.fields.Email) === normalized);
  if (matches.length !== 1) {
    throw new Error(`Airtable must contain exactly one record for the recipient; found ${matches.length}. Refusing to send.`);
  }
  const fields = matches[0].fields;
  if (fields["Do Not Contact"] !== false) {
    throw new Error("Airtable Do Not Contact is enabled or cannot be verified false. Refusing to send.");
  }
  if (fields["Lead Status"] !== "Approved") {
    throw new Error("Airtable Lead Status must be Approved before sending.");
  }
  if (fields["Review Status"] !== "Ready for outreach") {
    throw new Error("Airtable Review Status must be Ready for outreach before sending.");
  }
  const verifiedObservation = fields["Verified Observation"];
  if (typeof verifiedObservation !== "string" || !verifiedObservation.trim()) {
    throw new Error("A human-verified website observation is required before sending.");
  }
  if (fields["Outreach Subject"] !== expected.subject || fields["Outreach Draft"] !== expected.text) {
    throw new Error("The approved Airtable subject and draft must exactly match the message to be sent.");
  }
  if (!/\\b(?:jeg la merke til|jeg så at|jeg så på|jeg la merke til at)\\b/i.test(expected.text) ||
      /Vi kom over bedriften deres|Jeg kom over nettsiden deres/i.test(expected.text)) {
    throw new Error("Only a source-grounded personalized draft is eligible for outreach.");
  }
  if (!/(?:nei takk|ikke ønsker flere|stoppe henvendelser)/i.test(expected.text)) {
    throw new Error("The draft must include a clear opt-out instruction before sending.");
  }
  const recordId = matches[0].id;
  if (typeof recordId !== "string" || !/^rec[A-Za-z0-9]+$/.test(recordId)) {
    throw new Error("Airtable approval record has no valid record ID. Refusing to send.");
  }
  return recordId;
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchAirtableRecipientApproval(
  recipient: string,
  expected: ApprovedDraft,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const { apiToken, baseId, tableName } = airtableConfig(env);

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
  url.searchParams.set("filterByFormula", `AND({Email} = "${escapeFormulaString(recipient.trim().toLowerCase())}", {Do Not Contact} = 0)`);
  url.searchParams.set("pageSize", "100");
  for (const field of ["Email", "Lead Status", "Review Status", "Do Not Contact", "Outreach Subject", "Outreach Draft", "Verified Observation"]) {
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

export async function markAirtableRecipientSent(
  recordId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
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
