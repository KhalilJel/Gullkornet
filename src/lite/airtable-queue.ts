import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import { approvalLookupFormula } from "../integrations/airtable-send-approval.js";
import { LITE_READY_STATUS } from "./intake.js";
import type { AirtableConfig } from "./intake.js";
import type { LiteQueueRecord } from "./send.js";

const FIELDS = ["Email", "Website", "Company", "Lead Status", "Do Not Contact", "Research Notes"];

async function getJson(url: URL, cfg: AirtableConfig): Promise<{ records: LiteQueueRecord[]; offset?: string }> {
  const response = await (cfg.fetchImpl ?? fetch)(url.toString(), {
    headers: { Authorization: `Bearer ${cfg.apiToken}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable request failed (HTTP ${response.status}). Refusing to send.`);
  const payload = await response.json().catch(() => null) as { records?: unknown; offset?: unknown } | null;
  if (!payload || !Array.isArray(payload.records)) throw new Error("Airtable returned an invalid response. Refusing to send.");
  return { records: payload.records as LiteQueueRecord[], offset: typeof payload.offset === "string" ? payload.offset : undefined };
}

function tableUrl(cfg: AirtableConfig): URL {
  return new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
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
