import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import { LITE_MARKER, LITE_READY_STATUS, type AirtableConfig } from "./intake.js";
import { orgnrFromNotes } from "./freshness.js";
import type { LiteQueueRecord } from "./send.js";

// 90-day retention for Gullkornet Lite rows (docs/PROSPECT-DATA-RETENTION-POLICY.md,
// docs/LITE-LAGRING-OG-SLETTING.md). Only rows with the [GK-LITE] marker are in scope.
//
//   Lite Ready, never contacted, First Seen > 90 days      -> delete the row
//   Sent without reply, sent > 90 days                      -> minimise: keep only what stops a
//                                                              second email (address, org number,
//                                                              duplicate key, status)
//   Do Not Contact / Suppressed (any age)                   -> minimise; the reservation is kept
//   Replied, Interested, Meeting, Offer Sent, Won, Lost     -> keep (active sales or customer
//                                                              record); listed for manual review
//
// Nothing is changed unless the caller passes execute=true AND GULLKORNET_LITE_RETENTION_EXECUTE
// is "true" (owner approval). The plan itself is pure and reads nothing but the rows.

export const LITE_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;
const MINIMIZED = /(?:^|\s)minimized=\d{4}-\d{2}-\d{2}/;
const KEEP_STATUSES = new Set(["Replied", "Interested", "Meeting", "Offer Sent", "Won", "Lost"]);
/** Fields cleared on minimisation. Email, Lead Status, Do Not Contact, Duplicate Key stay: they enforce no re-contact. */
export const MINIMIZE_CLEAR_FIELDS = Object.freeze([
  "Website", "City", "Industry", "Discovery Source URL", "Contact Source URL", "Next Step", "Next Step Date"
]);
export const MINIMIZED_COMPANY = "(minimert)";

export type RetentionAction =
  | { id: string; action: "delete"; reason: "NEVER_CONTACTED_EXPIRED" }
  | { id: string; action: "minimize"; reason: "SENT_NO_REPLY_EXPIRED" | "RESERVATION"; notes: string };

export type RetentionPlan = {
  actions: RetentionAction[];
  keptActive: string[];
  /** Rows the rule cannot date (no First Seen / sent date): never touched, reported. */
  undated: string[];
  alreadyMinimized: number;
};

function text(row: LiteQueueRecord, field: string): string {
  const value = row.fields[field];
  return typeof value === "string" ? value.trim() : "";
}

export function sentDateFromNotes(notes: string): number | undefined {
  const day = /(?:^|\s)sent=(\d{4}-\d{2}-\d{2})(?:\s|$)/.exec(notes)?.[1];
  const ms = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

/** Appends (or replaces) the send date that retention counts from. */
export function withSentDate(notes: string, nowMs: number): string {
  return `${notes.replace(/\s+sent=\S+/g, "").trimEnd()} sent=${new Date(nowMs).toISOString().slice(0, 10)}`;
}

/** The suppression record: marker, org number (de-duplication) and why/when it was minimised. */
export function minimizedNotes(notes: string, reason: string, nowMs: number): string {
  const orgnr = orgnrFromNotes(notes);
  return [LITE_MARKER, orgnr ? `orgnr=${orgnr}` : "", `retention=${reason}`, `minimized=${new Date(nowMs).toISOString().slice(0, 10)}`]
    .filter(Boolean).join(" ");
}

export function planLiteRetention(rows: LiteQueueRecord[], nowMs: number, days = LITE_RETENTION_DAYS): RetentionPlan {
  const plan: RetentionPlan = { actions: [], keptActive: [], undated: [], alreadyMinimized: 0 };
  const cutoff = nowMs - days * DAY_MS;
  for (const row of rows) {
    const notes = text(row, "Research Notes");
    if (!notes.includes(LITE_MARKER)) continue;
    if (MINIMIZED.test(notes)) { plan.alreadyMinimized++; continue; }
    const status = text(row, "Lead Status");
    const reservation = row.fields["Do Not Contact"] === true || status === "Do Not Contact" || status === "Suppressed";
    if (reservation) {
      plan.actions.push({ id: row.id, action: "minimize", reason: "RESERVATION", notes: minimizedNotes(notes, "RESERVATION", nowMs) });
      continue;
    }
    if (KEEP_STATUSES.has(status)) { plan.keptActive.push(row.id); continue; }
    if (status === LITE_READY_STATUS) {
      const firstSeen = Date.parse(text(row, "First Seen"));
      if (!Number.isFinite(firstSeen)) { plan.undated.push(row.id); continue; }
      if (firstSeen < cutoff) plan.actions.push({ id: row.id, action: "delete", reason: "NEVER_CONTACTED_EXPIRED" });
      continue;
    }
    if (status === "Sent") {
      const sent = sentDateFromNotes(notes);
      if (sent === undefined) { plan.undated.push(row.id); continue; }
      if (sent < cutoff) {
        plan.actions.push({ id: row.id, action: "minimize", reason: "SENT_NO_REPLY_EXPIRED", notes: minimizedNotes(notes, "SENT_NO_REPLY_EXPIRED", nowMs) });
      }
    }
  }
  return plan;
}

export function retentionExecutionAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GULLKORNET_LITE_RETENTION_EXECUTE?.trim() === "true";
}

export type RetentionWriter = {
  deleteRecords: (ids: string[]) => Promise<void>;
  minimizeRecord: (id: string, notes: string) => Promise<void>;
};

/** Applies a plan. Refuses unless the owner switch is on; stops at the first failure. */
export async function executeLiteRetention(plan: RetentionPlan, writer: RetentionWriter, env: NodeJS.ProcessEnv = process.env): Promise<{ deleted: number; minimized: number }> {
  if (!retentionExecutionAllowed(env)) throw new Error("GULLKORNET_LITE_RETENTION_EXECUTE is not true. Nothing was changed.");
  assertAirtableWritesAllowed(env);
  let minimized = 0;
  // Minimise first: a reservation must never be lost because a later delete failed.
  for (const action of plan.actions) {
    if (action.action !== "minimize") continue;
    await writer.minimizeRecord(action.id, action.notes);
    minimized++;
  }
  const deletes = plan.actions.filter(a => a.action === "delete").map(a => a.id);
  let deleted = 0;
  for (let i = 0; i < deletes.length; i += 10) {
    await writer.deleteRecords(deletes.slice(i, i + 10));
    deleted += Math.min(10, deletes.length - i);
  }
  return { deleted, minimized };
}

// ---------- Airtable writer ----------

function recordUrl(cfg: AirtableConfig, suffix = ""): string {
  return `https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}${suffix}`;
}

export function airtableRetentionWriter(cfg: AirtableConfig): RetentionWriter {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" };
  return {
    async deleteRecords(ids) {
      if (!ids.length || ids.length > 10 || ids.some(id => !/^rec[A-Za-z0-9]+$/.test(id))) throw new Error("Invalid delete batch.");
      const url = new URL(recordUrl(cfg));
      for (const id of ids) url.searchParams.append("records[]", id);
      const response = await fetchImpl(url.toString(), { method: "DELETE", headers, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Airtable delete failed (HTTP ${response.status}).`);
    },
    async minimizeRecord(id, notes) {
      if (!/^rec[A-Za-z0-9]+$/.test(id)) throw new Error("Airtable record ID is invalid.");
      const fields: Record<string, unknown> = { Company: MINIMIZED_COMPANY, "Research Notes": notes };
      for (const field of MINIMIZE_CLEAR_FIELDS) fields[field] = null;
      const response = await fetchImpl(recordUrl(cfg, `/${id}`), {
        method: "PATCH", headers, body: JSON.stringify({ fields }), signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`Airtable minimise failed (HTTP ${response.status}).`);
    }
  };
}
