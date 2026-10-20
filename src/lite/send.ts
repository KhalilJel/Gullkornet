import { createHash } from "node:crypto";
import { businessDomainOf } from "../domain/email-domain.js";
import type { PreparedEmail, SendLedgerEntry } from "../integrations/outbound-email.js";
import { SendDeferredError } from "../integrations/send-schedule.js";
import { LITE_MARKER, LITE_READY_STATUS } from "./intake.js";
import { assessResearch, segmentFromNotes, withResearchRef, type LiteSegment, type SegmentResearch } from "./market-research.js";
import { assessLiteRecipient } from "./recipient-policy.js";
import { withSentDate } from "./retention.js";
import { assertLiteCapacity, capacityFreesAt, countedAt, countLedger, isWithinLiteWindow, type LiteSendConfig, type LiteSlot } from "./schedule.js";
import { DeliveryStopError } from "./delivery-health.js";
import { assertLiteTemplateCompliant, LITE_FROM, LITE_TEMPLATE } from "./template.js";

export type LiteQueueRecord = { id: string; fields: Record<string, unknown> };

/** One record cannot be sent (DNC, duplicate, replied, wrong status ...). The run moves on to the next record. */
export class LiteRefusedError extends Error {}

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
  /** Stored market research for a segment (research/segments), if any. */
  findResearch: (segment: LiteSegment) => SegmentResearch | undefined;
  /** Re-checks the row's facts at their sources (Brreg, DNS). Returns a refusal reason, undefined when still valid; throws on an outage. */
  checkFreshness: (email: string, notes: string) => Promise<string | undefined>;
  /** Live only: takes a row that failed the freshness check out of the queue (Lite Stale / Lite Recheck). */
  markStale?: (recordId: string, reason: string, notes: string) => Promise<void>;
  send: (email: PreparedEmail, idempotencyKey: string) => Promise<{ id: string }>;
  /** Claims the row: Lead Status Sent and Research Notes with the research reference. */
  markSent: (recordId: string, researchNotes: string) => Promise<void>;
  /** Puts a claimed row back to Lite Ready after a send that Resend did not accept. */
  markReady: (recordId: string) => Promise<void>;
  log: (message: string) => void;
};

export type LiteRunSummary = {
  sent: number;
  scanned: number;
  skipped: { refused: number; replied: number; recentlySent: number; noResearch: number; stale: number };
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
   * Live only. The run waits for slot.startMs, sends at most what the daily limit and Resend quota
   * leave after the last 24 h of account sends, spread evenly until slot.endMs, and stops there.
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
  assertLiteTemplateCompliant();
  const summary: LiteRunSummary = { sent: 0, scanned: 0, skipped: { refused: 0, replied: 0, recentlySent: 0, noResearch: 0, stale: 0 }, stoppedBy: "queue_empty" };
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
  // A delivery-health stop that lifts inside the slot (24 h after the failed email) is waited out;
  // one that outlasts the slot, a new event, or an outage stops the run as before.
  const fetchLedgerOrWait = async (): Promise<SendLedgerEntry[]> => {
    for (;;) {
      try {
        return await deps.fetchLedger();
      } catch (error) {
        if (!(slot && error instanceof DeliveryStopError && error.liftsAtMs !== undefined && error.liftsAtMs + 5_000 < slot.endMs - cfg.minSpacingMs)) throw error;
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

  // Slot pacing: the target is what the rolling 24 h daily limit and Resend quota still allow
  // (account-wide, so sends earlier today count), spread evenly over what is left of the slot.
  let maxThisRun = cfg.maxPerRun;
  let paceStartMs = 0;
  let intervalMs = 0;
  if (slot) {
    // What the rolling 24 h limits allow by the end of the slot: sends from yesterday's slot roll out
    // during today's, so the target counts only those still inside the window when the slot ends.
    // Each send still checks the limits at its own moment and waits for the next roll-out if needed.
    const counts = countLedger(ledger, deps.now());
    const carried = countedAt(ledger, slot.endMs);
    maxThisRun = Math.max(0, Math.min(cfg.maxPerRun, cfg.dailyLimit - carried, cfg.resendDailyQuota - carried));
    summary.target = maxThisRun;
    paceStartMs = deps.now();
    intervalMs = maxThisRun > 0 ? Math.max(cfg.minSpacingMs, Math.floor((slot.endMs - paceStartMs) / maxThisRun)) : 0;
    deps.log(`Slot plan (${slot.kind}): sentLast24h=${counts.lastDay} stillCountedAtSlotEnd=${carried} dailyLimit=${cfg.dailyLimit} resendDailyQuota=${cfg.resendDailyQuota} ` +
      `target=${maxThisRun} queue=${queue.length} intervalSec=${Math.round(intervalMs / 1000)} ends=${new Date(slot.endMs).toISOString()}`);
    if (maxThisRun === 0) { summary.stoppedBy = "limit"; return summary; }
  }
  /** Slot runs: true when a send is allowed now, after waiting for older sends to roll out if that happens inside the slot. */
  const waitForCapacity = async (spacing: boolean): Promise<boolean> => {
    for (;;) {
      const counts = countLedger(ledger, deps.now());
      try {
        assertLiteCapacity(spacing ? counts : { ...counts, newestMs: undefined }, cfg, deps.now());
        return true;
      } catch (error) {
        if (!(error instanceof SendDeferredError)) throw error;
        const freesAt = capacityFreesAt(ledger, cfg, deps.now());
        const spacingAt = spacing && counts.newestMs !== undefined ? counts.newestMs + cfg.minSpacingMs : 0;
        const at = Math.max(freesAt ?? 0, spacingAt);
        if (!slot || at <= deps.now() || at + 1_000 >= slot.endMs) { deps.log("Deferred: " + error.message); return false; }
        await deps.sleep(at + 1_000 - deps.now());
      }
    }
  };

  for (const record of queue) {
    if (!options.preview && summary.sent >= maxThisRun) { summary.stoppedBy = maxThisRun < cfg.maxPerRun ? "limit" : "max_per_run"; break; }
    if (options.preview && options.previewLimit !== undefined && summary.scanned >= options.previewLimit) break;
    if (slot) {
      if (!inWindow()) { summary.stoppedBy = "outside_window"; break; }
      // Spacing is handled by the pace below; daily, hourly and quota limits wait for roll-out or stop the run.
      if (!await waitForCapacity(false)) { summary.stoppedBy = "limit"; break; }
      if (!inWindow()) { summary.stoppedBy = "outside_window"; break; }
    } else if (!options.preview) {
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
    // "Vi har sett på hvordan bedrifter i deres marked ..." must be documented for this lead's segment.
    const segment = segmentFromNotes(freshNotes);
    const research = assessResearch(segment, segment && deps.findResearch(segment), deps.now());
    if (!research.ok) { summary.skipped.noResearch++; continue; }
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

    if (slot) {
      // Every gate has passed; wait for this send's place in the even spread (gate time is absorbed by the wait).
      const newest = countLedger(ledger, deps.now()).newestMs;
      const dueAt = Math.max(paceStartMs + summary.sent * intervalMs, newest === undefined ? 0 : newest + cfg.minSpacingMs);
      if (dueAt >= slot.endMs) { summary.stoppedBy = "outside_window"; break; }
      if (dueAt > deps.now()) await deps.sleep(dueAt - deps.now());
      if (!inWindow()) { summary.stoppedBy = "outside_window"; break; }
      if (!await waitForCapacity(true)) { summary.stoppedBy = "limit"; break; }
      if (!inWindow()) { summary.stoppedBy = "outside_window"; break; }
    }

    // Checks before a pacing wait can be minutes old. Refresh policy, account-wide capacity,
    // reservations and replies after that wait, before claiming or sending this message.
    await refreshLedger();
    if (sentWithinLedger(ledger, email)) { summary.skipped.recentlySent++; continue; }
    if (slot) {
      if (!await waitForCapacity(true)) { summary.stoppedBy = "limit"; break; }
    } else {
      try { assertLiteCapacity(countLedger(ledger, deps.now()), cfg, deps.now()); }
      catch (error) {
        if (!(error instanceof SendDeferredError)) throw error;
        summary.stoppedBy = "limit"; deps.log("Deferred: " + error.message); break;
      }
    }
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
      await deps.markSent(recordId, withSentDate(withResearchRef(freshNotes, research.research.id), deps.now()));
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
 * of lookups. Retry a 503 twice after a pause; any other answer, or a third 503, stops the run as before.
 */
export async function withTransientRetry<T>(call: () => Promise<T>, wait: (ms: number) => Promise<void>, pausesMs = [10_000, 30_000]): Promise<T> {
  for (const pause of pausesMs) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof Error && /HTTP 503\b/.test(error.message))) throw error;
      await wait(pause);
    }
  }
  return call();
}
