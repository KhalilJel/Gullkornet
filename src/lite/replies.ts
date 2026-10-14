import type { LiteQueueRecord } from "./send.js";

// Registers answers in Airtable: every Lite row that was sent (Lead Status "Sent") is looked up in
// the read-only reply-status service, and a business that has written back is moved to "Replied".
// It never sends anything. Sending is already blocked for the whole business once a row is Sent;
// this makes the answer visible in Airtable so a person can follow it up.

export type LiteReplySyncDeps = {
  fetchSent: () => Promise<LiteQueueRecord[]>;
  /** Read-only lookup; throws on any doubt (outage, invalid answer). */
  hasReplied: (email: string) => Promise<boolean>;
  markReplied: (recordId: string) => Promise<void>;
};

export type LiteReplySyncSummary = { checked: number; replied: number; noEmail: number };

export async function runLiteReplySync(deps: LiteReplySyncDeps, maxChecks = 200): Promise<LiteReplySyncSummary> {
  const summary: LiteReplySyncSummary = { checked: 0, replied: 0, noEmail: 0 };
  const rows = await deps.fetchSent();
  if (rows.length > maxChecks) throw new Error(`More than ${maxChecks} sent Lite rows; raise the limit deliberately.`);
  for (const row of rows) {
    const email = typeof row.fields.Email === "string" ? row.fields.Email.trim().toLowerCase() : "";
    if (!email) { summary.noEmail++; continue; }
    summary.checked++;
    // An outage stops the run: a row that was not checked keeps its status and is checked next time.
    if (await deps.hasReplied(email)) {
      await deps.markReplied(row.id);
      summary.replied++;
    }
  }
  return summary;
}
