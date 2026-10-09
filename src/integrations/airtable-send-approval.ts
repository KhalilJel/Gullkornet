export type AirtableSendApproval = {
  id: string;
  fields: {
    Email?: unknown;
    "Lead Status"?: unknown;
    "Review Status"?: unknown;
    "Do Not Contact"?: unknown;
  };
};

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function assertAirtableRecipientApproved(
  records: AirtableSendApproval[],
  recipient: string
): void {
  const normalized = normalizeEmail(recipient);
  const matches = records.filter(record => normalizeEmail(record.fields.Email) === normalized);
  if (matches.length !== 1) {
    throw new Error(`Airtable must contain exactly one record for the recipient; found ${matches.length}. Refusing to send.`);
  }
  const fields = matches[0].fields;
  if (fields["Do Not Contact"] === true) {
    throw new Error("Airtable Do Not Contact is enabled. Refusing to send.");
  }
  if (fields["Lead Status"] !== "Approved") {
    throw new Error("Airtable Lead Status must be Approved before sending.");
  }
  if (fields["Review Status"] !== "Ready for outreach") {
    throw new Error("Airtable Review Status must be Ready for outreach before sending.");
  }
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function fetchAirtableRecipientApproval(
  recipient: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const apiToken = env.AIRTABLE_API_TOKEN?.trim();
  const baseId = env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
  const tableName = env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
  if (!apiToken || !baseId || !/^app[A-Za-z0-9]{14}$/.test(baseId)) {
    throw new Error("Airtable token and valid base ID are required to verify recipient approval. Refusing to send.");
  }

  const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
  url.searchParams.set("filterByFormula", `{Email} = "${escapeFormulaString(recipient.trim().toLowerCase())}"`);
  url.searchParams.set("pageSize", "100");
  for (const field of ["Email", "Lead Status", "Review Status", "Do Not Contact"]) {
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
  assertAirtableRecipientApproved(records, recipient);
}
