import type { LiteQueueRecord } from "./send.js";

// Registers answers in Airtable: every Lite row that was sent (Lead Status "Sent") is looked up in
// the read-only reply-status service, and a business that has written back is moved to "Replied".
// It never sends anything. Sending to a business already stops at "Sent"; this makes the answer
// visible in Airtable so a person can follow it up.
//
// Lookups go in batches (one mailbox read per batch on the reply service), so a few thousand sent
// rows stay well inside the job's time limit.

export type LiteReplySyncDeps = {
  fetchSent: () => Promise<LiteQueueRecord[]>;
  /** Read-only batch lookup; throws on any doubt (outage, invalid or incomplete answer). */
  hasRepliedBatch: (emails: string[]) => Promise<Map<string, boolean>>;
  markReplied: (recordId: string) => Promise<void>;
};

export type LiteReplySyncSummary = { checked: number; replied: number; noEmail: number; batches: number };

export async function runLiteReplySync(deps: LiteReplySyncDeps, batchSize = 200): Promise<LiteReplySyncSummary> {
  const summary: LiteReplySyncSummary = { checked: 0, replied: 0, noEmail: 0, batches: 0 };
  const rows: Array<{ id: string; email: string }> = [];
  for (const row of await deps.fetchSent()) {
    const email = typeof row.fields.Email === "string" ? row.fields.Email.trim().toLowerCase() : "";
    if (!email) { summary.noEmail++; continue; }
    rows.push({ id: row.id, email });
  }
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    // An outage stops the run: rows not yet checked keep their status and are checked next time.
    const answers = await deps.hasRepliedBatch(batch.map(r => r.email));
    summary.batches++;
    for (const row of batch) {
      const replied = answers.get(row.email);
      if (replied === undefined) throw new Error("Reply-status batch left out an address. Stopping.");
      summary.checked++;
      if (replied) { await deps.markReplied(row.id); summary.replied++; }
    }
  }
  return summary;
}
