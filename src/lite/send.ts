import { createHash } from "node:crypto";
import { businessDomainOf } from "../domain/email-domain.js";
import { DEFAULT_SENDER, type PreparedEmail, type SendLedgerEntry } from "../integrations/outbound-email.js";
import { SendDeferredError } from "../integrations/send-schedule.js";
import { LITE_MARKER, LITE_READY_STATUS } from "./intake.js";
import { assessLiteRecipient } from "./recipient-policy.js";
import { assertLiteCapacity, countLedger, isWithinLiteWindow, type LiteSendConfig } from "./schedule.js";
import { assertLiteTemplateCompliant, LITE_TEMPLATE } from "./template.js";

export type LiteQueueRecord = { id: string; fields: Record<string, unknown> };

/** One record cannot be sent (DNC, duplicate, replied, wrong status ...). The run moves on to the next record. */
export class LiteRefusedError extends Error {}

// Same set as the advanced sender (airtable-send-approval.ts): a business in any of these
// states has been contacted, has answered, or must not be contacted again through any address.
const BUSINESS_BLOCKING_STATUSES = new Set([
  "Sent", "Replied", "Contacted", "Suppressed", "Do Not Contact", "Follow-up", "Meeting", "Won", "Lost"
]);

function emailOf(record: LiteQueueRecord): string {
  return typeof record.fields.Email === "string" ? record.fields.Email.trim().toLowerCase() : "";
}

function notesOf(record: LiteQueueRecord): string {
  return typeof record.fields["Research Notes"] === "string" ? record.fields["Research Notes"] : "";
}

export function orgFormFromNotes(notes: string): string | undefined {
  return /(?:^|\s)orgform=([A-Z]+)/i.exec(notes)?.[1]?.toUpperCase();
}

/**
 * The Lite gate. `records` is every Airtable row with the same address or the same business
 * domain (approvalLookupFormula). No AI fields are read or required.
 */
export function assertLiteRecipientApproved(records: LiteQueueRecord[], recipient: string, allowedOrgForms?: readonly string[]): string {
  const email = recipient.trim().toLowerCase();
  const matches = records.filter(record => emailOf(record) === email);
  if (matches.length !== 1) throw new LiteRefusedError("Expected exactly one Airtable record for the address.");
  const record = matches[0];
  const dnc = record.fields["Do Not Contact"];
  if (dnc !== undefined && dnc !== false) throw new LiteRefusedError("Do Not Contact is set.");
  if (record.fields["Lead Status"] !== LITE_READY_STATUS) throw new LiteRefusedError("Lead Status is not Lite Ready.");
  const notes = notesOf(record);
  if (!notes.includes(LITE_MARKER)) throw new LiteRefusedError("Record was not created by Lite intake.");
  const policy = assessLiteRecipient({
    email,
    orgForm: orgFormFromNotes(notes),
    websiteUrl: typeof record.fields.Website === "string" ? record.fields.Website : undefined
  }, allowedOrgForms);
  if (!policy.ok) throw new LiteRefusedError(`Recipient policy refused: ${policy.reason}.`);
  const domain = businessDomainOf(email);
  if (domain) {
    const blocked = records.some(other => other !== record && businessDomainOf(emailOf(other)) === domain &&
      (other.fields["Do Not Contact"] === true || BUSINESS_BLOCKING_STATUSES.has(String(other.fields["Lead Status"] ?? ""))));
    if (blocked) throw new LiteRefusedError("Another record for the same business is contacted, replied or suppressed.");
  }
  if (!/^rec[A-Za-z0-9]+$/.test(record.id)) throw new LiteRefusedError("Airtable record has no valid ID.");
  return record.id;
}

export function sentWithinLedger(entries: SendLedgerEntry[], recipient: string): boolean {
  const email = recipient.trim().toLowerCase();
  return entries.some(entry => (entry.to ?? []).some(to => typeof to === "string" && to.trim().toLowerCase() === email));
}

/** Resend answered 4xx (sendOneEmail's message), so the email was certainly not accepted. */
export function isDefiniteRejection(error: unknown): boolean {
  return error instanceof Error && /^Resend send failed \(HTTP 4\d\d\)/.test(error.message);
}

export function liteIdempotencyKey(recordId: string, email: PreparedEmail): string {
  return "gullkornet-lite-" + createHash("sha256")
    .update(["lite", recordId, email.to, email.subject, email.text].join("\n"))
    .digest("hex");
}

export type LiteSendDeps = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetchLedger: () => Promise<SendLedgerEntry[]>;
  fetchQueue: () => Promise<LiteQueueRecord[]>;
  /** Every record with the same address or business domain (DNC rows included). */
  lookupRecords: (email: string) => Promise<LiteQueueRecord[]>;
  /** Throws an Error whose message contains "Recipient has replied" when the business answered; any other throw is an outage. */
  assertNotReplied: (email: string) => Promise<void>;
  send: (email: PreparedEmail, idempotencyKey: string) => Promise<{ id: string }>;
  markSent: (recordId: string) => Promise<void>;
  /** Puts a claimed row back to Lite Ready after a send that Resend did not accept. */
  markReady: (recordId: string) => Promise<void>;
  log: (message: string) => void;
};

export type LiteRunSummary = {
  sent: number;
  scanned: number;
  skipped: { refused: number; replied: number; recentlySent: number };
  stoppedBy: "max_per_run" | "queue_empty" | "outside_window" | "limit" | "preview";
  eligibleInPreview?: number;
};

export type LiteRunOptions = { preview?: boolean; allowedOrgForms?: readonly string[] };

/**
 * Sends up to cfg.maxPerRun template emails. Every record passes the Lite gate, the reply check
 * and the ledger checks first. Any outage (Airtable, reply service, Resend) throws and stops the
 * run: an unavailable check is never read as "allowed". preview=true runs every gate and sends nothing.
 */
export async function runLiteSend(deps: LiteSendDeps, cfg: LiteSendConfig, options: LiteRunOptions = {}): Promise<LiteRunSummary> {
  assertLiteTemplateCompliant();
  const summary: LiteRunSummary = { sent: 0, scanned: 0, skipped: { refused: 0, replied: 0, recentlySent: 0 }, stoppedBy: "queue_empty" };
  if (!options.preview && !isWithinLiteWindow(deps.now(), cfg)) {
    summary.stoppedBy = "outside_window";
    return summary;
  }
  const ledger = [...await deps.fetchLedger()];
  const queue = await deps.fetchQueue();
  let eligible = 0;

  for (const record of queue) {
    if (!options.preview && summary.sent >= cfg.maxPerRun) { summary.stoppedBy = "max_per_run"; break; }
    if (!options.preview) {
      if (!isWithinLiteWindow(deps.now(), cfg)) { summary.stoppedBy = "outside_window"; break; }
      try {
        assertLiteCapacity(countLedger(ledger, deps.now()), cfg, deps.now());
      } catch (error) {
        if (!(error instanceof SendDeferredError)) throw error;
        const counts = countLedger(ledger, deps.now());
        const waitMs = counts.newestMs === undefined ? 0 : cfg.minSpacingMs - (deps.now() - counts.newestMs);
        const onlySpacing = counts.lastDay < cfg.dailyLimit && counts.lastDay < cfg.resendDailyQuota && counts.lastHour < cfg.hourlyLimit;
        if (!onlySpacing || waitMs <= 0 || waitMs > 5 * 60 * 1000) { summary.stoppedBy = "limit"; deps.log("Deferred: " + error.message); break; }
        await deps.sleep(waitMs);
        if (!isWithinLiteWindow(deps.now(), cfg)) { summary.stoppedBy = "outside_window"; break; }
        try {
          assertLiteCapacity(countLedger(ledger, deps.now()), cfg, deps.now());
        } catch (retryError) {
          if (!(retryError instanceof SendDeferredError)) throw retryError;
          summary.stoppedBy = "limit"; deps.log("Deferred: " + retryError.message); break;
        }
      }
    }

    summary.scanned++;
    const email = emailOf(record);
    let recordId: string;
    try {
      if (!email) throw new LiteRefusedError("Record has no email.");
      recordId = assertLiteRecipientApproved(await deps.lookupRecords(email), email, options.allowedOrgForms);
      if (recordId !== record.id) throw new LiteRefusedError("Lookup returned a different record.");
    } catch (error) {
      if (error instanceof LiteRefusedError) { summary.skipped.refused++; continue; }
      throw error;
    }
    try {
      await deps.assertNotReplied(email);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Recipient has replied")) { summary.skipped.replied++; continue; }
      throw error;
    }
    if (sentWithinLedger(ledger, email)) { summary.skipped.recentlySent++; continue; }

    if (options.preview) { eligible++; continue; }

    const prepared: PreparedEmail = { from: DEFAULT_SENDER, to: email, subject: LITE_TEMPLATE.subject, text: LITE_TEMPLATE.text };
    // Claim the row (Sent) before sending: a row that is not Lite Ready never re-enters the queue,
    // so a later failure can at worst leave one row marked Sent without an email, never send twice.
    try {
      await deps.markSent(recordId);
    } catch {
      throw new Error("Airtable could not mark the row Sent before sending. Nothing was sent. Refusing to continue.");
    }
    try {
      await deps.send(prepared, liteIdempotencyKey(recordId, prepared));
    } catch (error) {
      // Only a clear 4xx means Resend did not take the email. A timeout, reset, 5xx or a 2xx without
      // an ID may have gone out, so the row stays Sent rather than risk a second email after 24 h.
      if (!isDefiniteRejection(error)) {
        throw new Error("Send result is unknown; the row stays Sent. Check Resend and reset it by hand only if no email went out.");
      }
      try {
        await deps.markReady(recordId);
      } catch {
        throw new Error("Send failed and the row could not be put back to Lite Ready. It stays Sent; reconcile by hand if it should be retried.");
      }
      throw error;
    }
    ledger.push({ created_at: new Date(deps.now()).toISOString(), to: [email] });
    summary.sent++;
  }
  if (options.preview) { summary.stoppedBy = "preview"; summary.eligibleInPreview = eligible; }
  else if (summary.sent >= cfg.maxPerRun) summary.stoppedBy = "max_per_run";
  return summary;
}
