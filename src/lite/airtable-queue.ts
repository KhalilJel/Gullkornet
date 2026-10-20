import { fetchReadWithRetry } from "./http-retry.js";
import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import { approvalLookupFormula } from "../integrations/airtable-send-approval.js";
import { LITE_READY_STATUS } from "./intake.js";
import type { AirtableConfig } from "./intake.js";
import type { LiteQueueRecord } from "./send.js";
import { parsePilotPreviewIds } from "./pilot-preview.js";

const FIELDS = ["Email", "Website", "Company", "Lead Status", "Do Not Contact", "Research Notes"];

async function getJson(url: URL, cfg: AirtableConfig): Promise<{ records: LiteQueueRecord[]; offset?: string }> {
  // Reads only: a single timeout or 5xx is retried briefly; a lasting outage still refuses to send.
  const response = await fetchReadWithRetry(cfg.fetchImpl ?? fetch, url.toString(), {
    headers: { Authorization: `Bearer ${cfg.apiToken}` }
  }, 15000, cfg.retryPausesMs);
  if (!response.ok) throw new Error(`Airtable request failed (HTTP ${response.status}). Refusing to send.`);
  const payload = await response.json().catch(() => null) as { records?: unknown; offset?: unknown } | null;
  if (!payload || !Array.isArray(payload.records)) throw new Error("Airtable returned an invalid response. Refusing to send.");
  return { records: payload.records as LiteQueueRecord[], offset: typeof payload.offset === "string" ? payload.offset : undefined };
}

function tableUrl(cfg: AirtableConfig): URL {
  return new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
}

/** Reads precisely the requested pilot rows, including any now blocked rows; never substitutes others. */
export async function fetchPilotPreviewRows(cfg: AirtableConfig, ids: string[]): Promise<LiteQueueRecord[]> {
  const selected = parsePilotPreviewIds(ids.join(","));
  const url = tableUrl(cfg);
  url.searchParams.set("filterByFormula", `OR(${selected.map(id => `RECORD_ID()='${id}'`).join(",")})`);
  url.searchParams.set("pageSize", "100");
  for (const field of FIELDS) url.searchParams.append("fields[]", field);
  const result = await getJson(url, cfg);
  if (result.offset || result.records.length !== selected.length ||
      new Set(result.records.map(row => row.id)).size !== selected.length ||
      result.records.some(row => !selected.includes(row.id))) {
    throw new Error("Exact pilot preview could not read every selected record. No substitution allowed.");
  }
  return selected.map(id => result.records.find(row => row.id === id)!);
}

/** Lite Ready rows with Do Not Contact unticked, oldest first. The DNC field reference also makes a renamed field fail. */
export async function fetchLiteQueue(cfg: AirtableConfig, maxPages = 3): Promise<LiteQueueRecord[]> {
  const records: LiteQueueRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = tableUrl(cfg);
    url.searchParams.set("filterByFormula", `AND({Lead Status} = "${LITE_READY_STATUS}", {Do Not Contact} = 0)`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("sort[0][field]", "First Seen");
    url.searchParams.append("sort[0][direction]", "asc");
    for (const field of FIELDS) url.searchParams.append("fields[]", field);
    if (offset) url.searchParams.set("offset", offset);
    const result = await getJson(url, cfg);
    records.push(...result.records);
    offset = result.offset;
    if (!offset) break;
  }
  return records;
}

/** Same lookup formula as the advanced sender: exact address plus every row on the same business domain, DNC rows included. */
export async function lookupLiteRecords(cfg: AirtableConfig, email: string): Promise<LiteQueueRecord[]> {
  const url = tableUrl(cfg);
  url.searchParams.set("filterByFormula", approvalLookupFormula(email));
  url.searchParams.set("pageSize", "100");
  for (const field of FIELDS) url.searchParams.append("fields[]", field);
  const result = await getJson(url, cfg);
  if (result.offset) throw new Error("Airtable lookup was paginated. Refusing to send until duplicates are reconciled.");
  return result.records;
}

/**
 * The pre-send claim: Lead Status Sent plus the research reference in Research Notes, verified
 * from Airtable's response. A row that is not Lite Ready never re-enters the Lite queue.
 */
export async function markLiteSent(cfg: AirtableConfig, recordId: string, researchNotes: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertAirtableWritesAllowed(env);
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) throw new Error("Airtable record ID is invalid.");
  const response = await (cfg.fetchImpl ?? fetch)(`${tableUrl(cfg).toString()}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Lead Status": "Sent", "Research Notes": researchNotes } }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable could not mark the row Sent (HTTP ${response.status}).`);
  const payload = await response.json().catch(() => null) as { id?: unknown; fields?: Record<string, unknown> } | null;
  if (payload?.id !== recordId || payload.fields?.["Lead Status"] !== "Sent" || payload.fields?.["Research Notes"] !== researchNotes) throw new Error("Airtable's Sent state could not be verified.");
}

/** Undoes the pre-send claim (Sent -> Lite Ready) after a send that failed. */
export async function markLiteReady(cfg: AirtableConfig, recordId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertAirtableWritesAllowed(env);
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) throw new Error("Airtable record ID is invalid.");
  const response = await (cfg.fetchImpl ?? fetch)(`${tableUrl(cfg).toString()}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Lead Status": LITE_READY_STATUS } }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable could not reset the row to Lite Ready (HTTP ${response.status}).`);
}

/** Lite rows (intake marker) in one Lead Status, any DNC value. Fails closed beyond maxPages. */
export async function fetchLiteRowsByStatus(cfg: AirtableConfig, status: string, maxPages = 10): Promise<LiteQueueRecord[]> {
  if (!/^[A-Za-z -]+$/.test(status)) throw new Error("Lead Status filter is invalid.");
  const records: LiteQueueRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = tableUrl(cfg);
    url.searchParams.set("filterByFormula", `AND({Lead Status} = "${status}", FIND("[GK-LITE]", {Research Notes}))`);
    url.searchParams.set("pageSize", "100");
    for (const field of FIELDS) url.searchParams.append("fields[]", field);
    if (offset) url.searchParams.set("offset", offset);
    const result = await getJson(url, cfg);
    records.push(...result.records);
    offset = result.offset;
    if (!offset) return records;
  }
  throw new Error(`Too many Lite rows with status ${status} to read safely (more than ${maxPages * 100}).`);
}

/** Lite rows (any status) created in Airtable during the last `hours` hours: the intake's gross supply. */
export async function countLiteRowsCreatedSince(cfg: AirtableConfig, hours: number, maxPages = 20): Promise<number> {
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) throw new Error("hours must be 1-720.");
  let count = 0;
  let offset: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = tableUrl(cfg);
    url.searchParams.set("filterByFormula", `AND(FIND("[GK-LITE]", {Research Notes}), IS_AFTER(CREATED_TIME(), DATEADD(NOW(), -${hours}, 'hours')))`);
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("fields[]", "Lead Status");
    if (offset) url.searchParams.set("offset", offset);
    const result = await getJson(url, cfg);
    count += result.records.length;
    offset = result.offset;
    if (!offset) return count;
  }
  throw new Error("Too many new Lite rows to count safely.");
}

/** Sent -> Replied, verified from Airtable's response. typecast adds the option if the field lacks it. */
export async function markLiteReplied(cfg: AirtableConfig, recordId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertAirtableWritesAllowed(env);
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) throw new Error("Airtable record ID is invalid.");
  const response = await (cfg.fetchImpl ?? fetch)(`${tableUrl(cfg).toString()}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Lead Status": "Replied" }, typecast: true }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable could not mark the row Replied (HTTP ${response.status}).`);
  const payload = await response.json().catch(() => null) as { id?: unknown; fields?: Record<string, unknown> } | null;
  if (payload?.id !== recordId || payload.fields?.["Lead Status"] !== "Replied") throw new Error("Airtable's Replied state could not be verified.");
}

/** Every row, every field (all statuses, both pipelines). Read-only; fails closed beyond 500 pages. */
export async function fetchAllTableRows(cfg: AirtableConfig): Promise<LiteQueueRecord[]> {
  const rows: LiteQueueRecord[] = [];
  let offset: string | undefined;
  for (let page = 0; page < 500; page++) {
    const url = new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const response = await (cfg.fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${cfg.apiToken}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Airtable read failed (HTTP ${response.status}).`);
    const payload = await response.json() as { records?: LiteQueueRecord[]; offset?: string };
    if (!Array.isArray(payload.records)) throw new Error("Airtable returned an invalid list.");
    rows.push(...payload.records);
    offset = typeof payload.offset === "string" ? payload.offset : undefined;
    if (!offset) return rows;
  }
  throw new Error("Airtable table exceeded the safe pagination limit.");
}
