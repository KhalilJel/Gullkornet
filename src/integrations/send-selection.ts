import { eligibleDraftFromRecord, SendRefusedError, type AirtableSendApproval } from "./airtable-send-approval.js";

export type SelectedDraft = { record: AirtableSendApproval; email: string; subject: string; text: string };

export type SelectionDeps = {
  /** Full Airtable lookup for the address: exactly one record, no DNC/duplicate/contacted business. Returns the record ID. */
  lookupApproval: (email: string, draft: { subject: string; text: string }) => Promise<string>;
  /** Throws "Recipient has replied..." when a reply exists; any other throw is an outage. */
  assertNotReplied: (email: string) => Promise<void>;
};

export type SelectionOutcome = {
  selected?: SelectedDraft;
  scanned: number;
  /** Aggregate counts only, keyed by reason code. Never addresses or content. */
  skipped: Record<"not_eligible" | "refused" | "replied", number>;
};

/**
 * Walks the approved queue and picks the first record that passes every per-record gate.
 * A per-record policy refusal (SendRefusedError) or a reply skips that record only. Every
 * other error (Airtable/reply-service outage, bad config) propagates and stops the run, so
 * an unavailable check can never be read as "allowed".
 */
export async function selectEligibleDraft(queue: AirtableSendApproval[], deps: SelectionDeps): Promise<SelectionOutcome> {
  const outcome: SelectionOutcome = { scanned: 0, skipped: { not_eligible: 0, refused: 0, replied: 0 } };
  for (const record of queue) {
    outcome.scanned += 1;
    const draft = eligibleDraftFromRecord(record);
    if (!draft) {
      outcome.skipped.not_eligible += 1;
      continue;
    }
    let recordId: string;
    try {
      recordId = await deps.lookupApproval(draft.email, { subject: draft.subject, text: draft.text });
    } catch (error) {
      if (error instanceof SendRefusedError) {
        outcome.skipped.refused += 1;
        continue;
      }
      throw error;
    }
    try {
      await deps.assertNotReplied(draft.email);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Recipient has replied")) {
        outcome.skipped.replied += 1;
        continue;
      }
      throw error;
    }
    outcome.selected = { record: { ...record, id: recordId }, ...draft };
    return outcome;
  }
  return outcome;
}

export type PreviewOutcome = { scanned: number; eligible: number; skipped: SelectionOutcome["skipped"] };

/**
 * Read-only dry run of the same gates over the whole queue (does not stop at the first
 * eligible record). Used by `npm run send:preview`; it cannot send and never writes.
 */
export async function previewQueue(queue: AirtableSendApproval[], deps: SelectionDeps): Promise<PreviewOutcome> {
  const outcome: PreviewOutcome = { scanned: 0, eligible: 0, skipped: { not_eligible: 0, refused: 0, replied: 0 } };
  for (const record of queue) {
    const result = await selectEligibleDraft([record], deps);
    outcome.scanned += 1;
    outcome.eligible += result.selected ? 1 : 0;
    for (const key of Object.keys(result.skipped) as Array<keyof SelectionOutcome["skipped"]>) outcome.skipped[key] += result.skipped[key];
  }
  return outcome;
}
