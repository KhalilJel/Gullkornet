import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import { TEMPORARY_FRESHNESS_REASONS, type FreshnessReason } from "./freshness.js";
import { LITE_READY_STATUS, LITE_RECHECK_STATUS, LITE_STALE_STATUS, type AirtableConfig } from "./intake.js";
import type { LiteQueueRecord } from "./send.js";

// A row that fails a send-time freshness check leaves the queue, so the same dead row is not
// checked (and waited on) every day. A definite reason makes it Lite Stale for good. A temporary
// DNS failure makes it Lite Recheck with a recheck_after date; a due row goes back to Lite Ready and
// passes every gate again. After RECHECK_BACKOFF_DAYS.length temporary failures it becomes Lite Stale.

export const RECHECK_BACKOFF_DAYS = Object.freeze([1, 3, 7]);
const DAY_MS = 86_400_000;
const TOKENS = /(?:^|\s)(?:stale|recheck|recheck_after)=\S+/g;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function recheckCount(notes: string): number {
  const n = Number(/(?:^|\s)recheck=(\d+)/.exec(notes)?.[1] ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function recheckAfter(notes: string): number | undefined {
  const value = /(?:^|\s)recheck_after=(\d{4}-\d{2}-\d{2})(?:\s|$)/.exec(notes)?.[1];
  const ms = value ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

export type StaleUpdate = { status: string; notes: string };

/** The status and notes a refused row gets. Earlier stale/recheck tokens are replaced, the rest kept. */
export function staleUpdate(notes: string, reason: FreshnessReason, nowMs: number): StaleUpdate {
  const base = notes.replace(TOKENS, "").replace(/\s+/g, " ").trim();
  if (TEMPORARY_FRESHNESS_REASONS.has(reason)) {
    const attempt = recheckCount(notes) + 1;
    if (attempt <= RECHECK_BACKOFF_DAYS.length) {
      const after = day(nowMs + RECHECK_BACKOFF_DAYS[attempt - 1]! * DAY_MS);
      return { status: LITE_RECHECK_STATUS, notes: `${base} recheck=${attempt} recheck_after=${after}` };
    }
    return { status: LITE_STALE_STATUS, notes: `${base} stale=${reason}_REPEATED@${day(nowMs)}` };
  }
  return { status: LITE_STALE_STATUS, notes: `${base} stale=${reason}@${day(nowMs)}` };
}

/** Lite Recheck rows whose recheck_after date has come (Oslo and UTC agree on the date at any send hour). */
export function dueRechecks(rows: LiteQueueRecord[], nowMs: number): LiteQueueRecord[] {
  return rows.filter(row => {
    if (row.fields["Lead Status"] !== LITE_RECHECK_STATUS || row.fields["Do Not Contact"] === true) return false;
    const after = recheckAfter(String(row.fields["Research Notes"] ?? ""));
    return after !== undefined && after <= nowMs;
  });
}

/** Writes Lead Status and Research Notes, verified from Airtable's answer. typecast adds a missing status option. */
export async function writeLiteStatus(cfg: AirtableConfig, recordId: string, update: StaleUpdate, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertAirtableWritesAllowed(env);
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) throw new Error("Airtable record ID is invalid.");
  if (![LITE_STALE_STATUS, LITE_RECHECK_STATUS, LITE_READY_STATUS].includes(update.status)) throw new Error("Unexpected Lite status.");
  const response = await (cfg.fetchImpl ?? fetch)(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Lead Status": update.status, "Research Notes": update.notes }, typecast: true }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable could not update the Lite status (HTTP ${response.status}).`);
  const payload = await response.json().catch(() => null) as { id?: unknown; fields?: Record<string, unknown> } | null;
  if (payload?.id !== recordId || payload.fields?.["Lead Status"] !== update.status || payload.fields?.["Research Notes"] !== update.notes) {
    throw new Error("Airtable's Lite status could not be verified.");
  }
}
