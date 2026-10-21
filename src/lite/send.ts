import { createHash } from "node:crypto";
import { businessDomainOf } from "../domain/email-domain.js";
import type { PreparedEmail, SendLedgerEntry } from "../integrations/outbound-email.js";
import { SendDeferredError } from "../integrations/send-schedule.js";
import { LITE_MARKER, LITE_READY_STATUS } from "./intake.js";
import { assessLiteRecipient } from "./recipient-policy.js";
import { withSentDate } from "./retention.js";
import { assertLiteCapacity, capacityFreesAt, countedAt, countLedger, isWithinLiteWindow, type LiteSendConfig, type LiteSlot } from "./schedule.js";
import { DeliveryStopError } from "./delivery-health.js";
import { assertLiteTemplateCompliant, LITE_FROM, LITE_TEMPLATE } from "./template.js";

export type LiteQueueRecord = { id: string; fields: Record<string, unknown> };

/** One record cannot be sent (DNC, duplicate, replied, wrong status ...). The run moves on to the next record. */
export class LiteRefusedError extends Error {}

/** Pauses before repeating a send that Resend answered with 429 (rate limit), same idempotency key. */
export const RATE_LIMIT_PAUSES_MS: readonly number[] = Object.freeze([1_000, 2_000, 5_000, 10_000, 30_000]);

// Same set as the advanced sender (airtable-send-approval.ts): a business in any of these
// states has been contacted, has answered, or must not be contacted again through any address.
const BUSINESS_BLOCKING_STATUSES = new Set([
  "Sent", "Replied", "Contacted", "Suppressed", "Do Not Contact", "Follow-up", "Interested", "Meeting", "Offer Sent", "Won", "Lost"
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

/** Resend answered 4xx other than 429 (sendOneEmail's message), so the email was certainly not accepted. */
export function isDefiniteRejection(error: unknown): boolean {
  return error instanceof Error && /^Resend send failed \(HTTP 4(?!29)\d\d\)/.test(error.message);
}

/** Resend's rate limit (HTTP 429): the request was not processed and may be repeated. */
export function isRateLimited(error: unknown): boolean {
  return error instanceof Error && /^Resend send failed \(HTTP 429\)/.test(error.message);
}

/**
 * Follows Resend's real API limit instead of a fixed spacing: a 429 is waited out and the request
 * repeated with the same idempotency key, so it can never become a second email.
 */
export async function sendWithinRateLimit(send: LiteSendDeps["send"], sleep: LiteSendDeps["sleep"], email: PreparedEmail, key: string): Promise<{ id: string }> {
  for (const pause of RATE_LIMIT_PAUSES_MS) {
    try { return await send(email, key); }
    catch (error) { if (!isRateLimited(error)) throw error; await sleep(pause); }
  }
  return send(email, key);
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
  /** Re-checks the row's facts at their sources (Brreg, DNS). Returns a refusal reason, undefined when still valid; throws on an outage. */
  checkFreshness: (email: string, notes: string) => Promise<string | undefined>;
  /** Live only: takes a row that failed the freshness check out of the queue (Lite Stale / Lite Recheck). */
  markStale?: (recordId: string, reason: string, notes: string) => Promise<void>;
  send: (email: PreparedEmail, idempotencyKey: string) => Promise<{ id: string }>;
  /** Claims the row: Lead Status Sent, with the send date in Research Notes. */
  markSent: (recordId: string, researchNotes: string) => Promise<void>;
  /** Puts a claimed row back to Lite Ready after a send that Resend did not accept. */
  markReady: (recordId: string) => Promise<void>;
  log: (message: string) => void;
};

export type LiteRunSummary = {
  sent: number;
  scanned: number;
  skipped: { refused: number; replied: number; recentlySent: number; stale: number };
  stoppedBy: "max_per_run" | "queue_empty" | "outside_window" | "limit" | "preview";
  eligibleInPreview?: number;
  /** Slot runs: how many this run aimed for after subtracting the last 24 h of account sends. */
  target?: number;
};

export type LiteRunOptions = {
  preview?: boolean;
  allowedOrgForms?: readonly string[];
  /** Preview only: stop after this many scanned rows (keeps a large queue inside the job time limit). */
  previewLimit?: number;
  /**
   * Live only. The run waits for slot.startMs and sends, as fast as Resend's API accepts, at most what
   * the 24 h, hourly and per-run limits and the Resend quota leave after the account's earlier sends;
   * it waits for older sends to leave the window when that happens before slot.endMs.
   * Without a slot the run uses the hourly startHour-endHour window (tests and dry runs).
   */
  slot?: LiteSlot;
};

/**
 * Sends up to cfg.maxPerRun template emails. Every record passes the Lite gate, the reply check
 * and the ledger checks first. Any outage (Airtable, reply service, Resend) throws and stops the
 * run: an unavailable check is never read as "allowed". preview=true runs every gate and sends nothing.
 */
export async function runLiteSend(deps: LiteSendDeps, cfg: LiteSendConfig, options: LiteRunOptions = {}): Promise<LiteRunSummary> {
  const summary: LiteRunSummary = { sent: 0, scanned: 0, skipped: { refused: 0, replied: 0, recentlySent: 0, stale: 0 }, stoppedBy: "queue_empty" };
  try {
    return await runLiteSendInto(summary, deps, cfg, options);
  } catch (error) {
    // A stop (lasting outage, delivery-health stop, claim failure) always reports what was accepted.
    deps.log(`Run stopped after ${summary.sent} accepted: ${error instanceof Error ? error.message : "unknown error"}`);
    throw error;
  }
}

async function runLiteSendInto(summary: LiteRunSummary, deps: LiteSendDeps, cfg: LiteSendConfig, options: LiteRunOptions): Promise<LiteRunSummary> {
  assertLiteTemplateCompliant();
  const slot = options.preview ? undefined : options.slot;
  const inWindow = () => slot ? deps.now() >= slot.startMs && deps.now() < slot.endMs : isWithinLiteWindow(deps.now(), cfg);
  if (slot && deps.now() < slot.startMs && deps.now() < slot.endMs) {
    deps.log(`Waiting ${Math.round((slot.startMs - deps.now()) / 1000)} s for the slot to open.`);
    await deps.sleep(slot.startMs - deps.now());
  }
  if (!options.preview && !inWindow()) {
    summary.stoppedBy = "outside_window";
    return summary;
  }
  // A delivery-health stop (complaint or provider failure in the last 24 h) that lifts inside the slot is waited out;
  // one that outlasts the slot, a new event, or an outage stops the run as before.
  const fetchLedgerOrWait = async (): Promise<SendLedgerEntry[]> => {
    for (;;) {
      try {
        return await deps.fetchLedger();
      } catch (error) {
        if (!(slot && error instanceof DeliveryStopError && error.liftsAtMs !== undefined && error.liftsAtMs + 5_000 < slot.endMs)) throw error;
        deps.log(`${error.message} It lifts at ${new Date(error.liftsAtMs).toISOString()}, inside the slot; waiting.`);
        await deps.sleep(error.liftsAtMs + 5_000 - deps.now());
      }
    }
  };
  let ledger = [...await fetchLedgerOrWait()];
  // Keep locally accepted messages even if the provider list has not caught up yet.
  const accepted: SendLedgerEntry[] = [];
  const refreshLedger = async () => {
    const fresh = await fetchLedgerOrWait(); // also enforces live delivery health; an outage stops here
    ledger = [...fresh, ...accepted.filter(local => !(local.to ?? []).every(to => sentWithinLedger(fresh, to)))];
  };
  const queue = await deps.fetchQueue();
  let eligible = 0;

  // The target is what the rolling 24 h limit and the Resend quota still allow by the end of the slot
  // (account-wide: sends still inside the window when the slot ends are subtracted).
  let maxThisRun = cfg.maxPerRun;
  if (slot) {
    const counts = countLedger(ledger, deps.now());
    const carried = countedAt(ledger, slot.endMs);
    maxThisRun = Math.max(0, Math.min(cfg.maxPerRun, cfg.dailyLimit - carried, cfg.resendDailyQuota - carried));
    summary.target = maxThisRun;
    deps.log(`Slot plan (${slot.kind}): sentLast24h=${counts.lastDay} stillCountedAtSlotEnd=${carried} dailyLimit=${cfg.dailyLimit} resendDailyQuota=${cfg.resendDailyQuota} ` +
      `target=${maxThisRun} queue=${queue.length} ends=${new Date(slot.endMs).toISOString()}`);
    if (maxThisRun === 0) { summary.stoppedBy = "limit"; return summary; }
  }
  /** True when one more send is allowed now, or (slot runs) older sends roll out before the slot ends. */
  const capacityReachable = (): boolean => {
    try { assertLiteCapacity(countLedger(ledger, deps.now()), cfg); return true; }
    catch (error) {
      if (!(error instanceof SendDeferredError)) throw error;
      const freesAt = capacityFreesAt(ledger, cfg, deps.now());
      if (slot && freesAt !== undefined && freesAt > deps.now() && freesAt + 1_000 < slot.endMs) return true;
      deps.log("Deferred: " + error.message);
      return false;
    }
  };
  /** Slot runs: true when a send is allowed now, after waiting for older sends to roll out if that happens inside the slot. */
  const waitForCapacity = async (): Promise<boolean> => {
    for (;;) {
      try {
        assertLiteCapacity(countLedger(ledger, deps.now()), cfg);
        return true;
      } catch (error) {
        if (!(error instanceof SendDeferredError)) throw error;
        const freesAt = capacityFreesAt(ledger, cfg, deps.now());
        if (!slot || freesAt === undefined || freesAt <= deps.now() || freesAt + 1_000 >= slot.endMs) { deps.log("Deferred: " + error.message); return false; }
        await deps.sleep(freesAt + 1_000 - deps.now());
      }
    }
  };

  for (const record of queue) {
    if (!options.preview && summary.sent >= maxThisRun) { summary.stoppedBy = maxThisRun < cfg.maxPerRun ? "limit" : "max_per_run"; break; }
    if (options.preview && options.previewLimit !== undefined && summary.scanned >= options.previewLimit) break;
    if (!options.preview) {
      if (!inWindow()) { summary.stoppedBy = "outside_window"; break; }
      // Stop when the limits cannot free up inside the slot. The wait itself comes right before the
      // claim, after the checks, so their time never carries over into tomorrow's rolling window.
      if (!capacityReachable()) { summary.stoppedBy = "limit"; break; }
    }

    summary.scanned++;
    const email = emailOf(record);
    let recordId: string;
    let freshNotes: string;
    try {
      if (!email) throw new LiteRefusedError("Record has no email.");
      const related = await deps.lookupRecords(email);
      recordId = assertLiteRecipientApproved(related, email, options.allowedOrgForms);
      // Notes as they are now, not as they were when the queue was read (a run can wait minutes).
      freshNotes = notesOf(related.find(r => r.id === recordId)!);
      if (recordId !== record.id) throw new LiteRefusedError("Lookup returned a different record.");
    } catch (error) {
      if (error instanceof LiteRefusedError) { summary.skipped.refused++; continue; }
      throw error;
    }
    // The company may have been deleted, gone bankrupt or changed its address since intake.
    const staleReason = await deps.checkFreshness(email, freshNotes);
    if (staleReason) {
      summary.skipped.stale++;
      deps.log(`Skipped ${recordId}: ${staleReason}`);
      // Out of the queue so it is not checked again tomorrow. A failed write only costs that recheck.
      if (!options.preview && deps.markStale) {
        try {
          await deps.markStale(recordId, staleReason, freshNotes);
        } catch (error) {
          deps.log(`Could not take ${recordId} out of the queue: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
      continue;
    }
    if (sentWithinLedger(ledger, email)) { summary.skipped.recentlySent++; continue; }

    if (options.preview) {
      try { await deps.assertNotReplied(email); }
      catch (error) {
        if (error instanceof Error && error.message.includes("Recipient has replied")) { summary.skipped.replied++; continue; }
        throw error;
      }
      eligible++; continue;
    }

    // Fresh right before the claim: delivery health and reservations, account-wide capacity,
    // the duplicate check, the recipient's rows and the reply status.
    await refreshLedger();
    if (sentWithinLedger(ledger, email)) { summary.skipped.recentlySent++; continue; }
    if (!await waitForCapacity()) { summary.stoppedBy = "limit"; break; }
    try { assertLiteRecipientApproved(await deps.lookupRecords(email), email, options.allowedOrgForms); }
    catch (error) {
      if (error instanceof LiteRefusedError) { summary.skipped.refused++; continue; }
      throw error;
    }
    try { await deps.assertNotReplied(email); }
    catch (error) {
      if (error instanceof Error && error.message.includes("Recipient has replied")) { summary.skipped.replied++; continue; }
      throw error;
    }
    if (!inWindow()) { summary.stoppedBy = "outside_window"; break; }
    const prepared: PreparedEmail = { from: LITE_FROM, to: email, subject: LITE_TEMPLATE.subject, text: LITE_TEMPLATE.text };
    // Claim the row (Sent) before sending: a row that is not Lite Ready never re-enters the queue,
    // so a later failure can at worst leave one row marked Sent without an email, never send twice.
    try {
      // sent=<date> is what the 90-day retention counts from (src/lite/retention.ts).
      await deps.markSent(recordId, withSentDate(freshNotes, deps.now()));
    } catch {
      throw new Error("Airtable could not mark the row Sent before sending. Nothing was sent. Refusing to continue.");
    }
    try {
      await sendWithinRateLimit(deps.send, deps.sleep, prepared, liteIdempotencyKey(recordId, prepared));
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
    const entry = { created_at: new Date(deps.now()).toISOString(), to: [email] };
    accepted.push(entry);
    ledger.push(entry);
    summary.sent++;
    if (slot) deps.log(`Sent ${summary.sent}/${maxThisRun} at ${new Date(deps.now()).toISOString()}`);
  }
  if (options.preview) { summary.stoppedBy = "preview"; summary.eligibleInPreview = eligible; }
  else if (summary.sent >= maxThisRun) summary.stoppedBy = maxThisRun < cfg.maxPerRun ? "limit" : "max_per_run";
  return summary;
}

/**
 * The reply service opens an IMAP connection per lookup and answers 503 now and then under a burst
 * of lookups, and a network call can fail once. Retry a 503 or a network error / timeout twice after
 * a pause; any other answer, or a third failure, stops the run as before.
 */
export async function withTransientRetry<T>(call: () => Promise<T>, wait: (ms: number) => Promise<void>, pausesMs = [10_000, 30_000]): Promise<T> {
  for (const pause of pausesMs) {
    try {
      return await call();
    } catch (error) {
      const transient = error instanceof TypeError || (error instanceof Error && (/HTTP 503\b/.test(error.message) || error.name === "TimeoutError" || error.name === "AbortError"));
      if (!transient) throw error;
      await wait(pause);
    }
  }
  return call();
}
