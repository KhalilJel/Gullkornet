import { Resolver } from "node:dns/promises";
import { fetchRecentSendLedger, sendOneEmail } from "../integrations/outbound-email.js";
import { assertRecipientHasNotReplied, fetchRepliedBatch, REPLY_STATUS_BATCH_MAX } from "../integrations/reply-status.js";
import { countLiteRowsCreatedSince, fetchLiteQueue, fetchLiteRowsByStatus, fetchPilotPreviewRows, lookupLiteRecords, markLiteReady, markLiteSent } from "../lite/airtable-queue.js";
import { parsePilotPreviewIds } from "../lite/pilot-preview.js";
import { assertConfirmedResendSending } from "../lite/resend-pilot.js";
import { exactAddressBlocked, fetchBounceInfo, fetchResendEmailsSince, markDoNotContact, rowStates } from "../lite/delivery-check.js";
import { assessDeliveryHealth, DeliveryStopError, deliveryStopLiftsAt, type BounceInfo } from "../lite/delivery-health.js";
import { airtableConfigFromEnv, LITE_READY_STATUS, LITE_RECHECK_STATUS } from "../lite/intake.js";
import { checkLiteFreshness, type FreshnessReason } from "../lite/freshness.js";
import { dueRechecks, staleUpdate, writeLiteStatus } from "../lite/stale.js";
import { LITE_RESEARCH_MAX_AGE_DAYS, loadResearchIndex } from "../lite/market-research.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";
import { countLedger, loadLiteSendConfig, MAX_SCHEDULED_LEAD_MS, resolveLiteSlot, SLOT_LEAD_MS } from "../lite/schedule.js";
import { runLiteSend, withTransientRetry } from "../lite/send.js";

// npm run send:lite            -> no-op with switch off; otherwise owner-confirmed operation up to 95/day,
//                                 spread evenly over 11:00-12:00 Oslo (a run up to 30 min early waits for it).
//   GULLKORNET_LITE_ONE_OFF_DATE=<today, Oslo> -> owner's one-off: the same, spread over the next 60 minutes.
// npm run send:lite -- --preview [--limit 100] -> read-only: runs every gate over (the first N of) the queue, never sends or writes

// Same bounds as freshness.ts's default resolver; created here so the timing wrapper sees each lookup.
const mxResolver = new Resolver({ timeout: 3000, tries: 2 });

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Per-dependency wall time (counts and seconds only), printed at the end of every run.
const timings = new Map<string, { n: number; total: number; max: number }>();
function timed<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const start = performance.now();
    try {
      return await fn(...args);
    } finally {
      const ms = performance.now() - start;
      const t = timings.get(name) ?? { n: 0, total: 0, max: 0 };
      t.n++; t.total += ms; t.max = Math.max(t.max, ms);
      timings.set(name, t);
    }
  };
}
function timingSummary(): string {
  return [...timings].map(([name, t]) => `${name} n=${t.n} total=${(t.total / 1000).toFixed(1)}s avg=${(t.total / t.n / 1000).toFixed(2)}s max=${(t.max / 1000).toFixed(1)}s`).join("; ");
}

/**
 * Delivery-health stop (delivery-health.ts): a spam complaint or a provider send failure in the last
 * 24 h stops the run; every bounce and every Resend suppression is reserved (Do Not Contact, verified
 * before the run continues) and the run goes on. There is no failure-rate stop (owner, 21.10.2026).
 */
async function enforceDeliveryHealth(apiKey: string, airtable: ReturnType<typeof airtableConfigFromEnv>, env: NodeJS.ProcessEnv) {
  const now = Date.now();
  // Sequential provider reads, at most five per second, below the verified 10 requests/s plan.
  let nextRead = 0;
  const providerFetch: typeof fetch = async (input, init) => {
    if (Date.now() < nextRead) await sleep(nextRead - Date.now());
    nextRead = Date.now() + 200;
    return fetch(input, init);
  };
  const history = await fetchResendEmailsSince(apiKey, now - 30 * 24 * 60 * 60 * 1000, providerFetch);
  const bounces = new Map<string, BounceInfo>();
  for (const e of history) {
    if (e.last_event !== "bounced" || !e.id || now - Date.parse(e.created_at) >= 24 * 60 * 60 * 1000) continue;
    const info = await fetchBounceInfo(apiKey, e.id, providerFetch);
    if (info) bounces.set(e.id, info);
  }
  const verdict = assessDeliveryHealth(history, bounces, now);
  if (!verdict.ok) {
    throw new DeliveryStopError(`Delivery-health stop: ${verdict.reason} Review provider events before continuing.`, deliveryStopLiftsAt(history, bounces, now));
  }
  for (const failure of verdict.recipientScoped) {
    const states = rowStates(await lookupLiteRecords(airtable, failure.recipient), failure.recipient);
    for (const row of states.filter(r => r.exactAddress && !r.doNotContact)) {
      await markDoNotContact(airtable, row.recordId, env);
      console.log(`Reserved ${row.recordId} after a ${failure.event} event (recipient-scoped; Do Not Contact verified).`);
    }
    if (!exactAddressBlocked(rowStates(await lookupLiteRecords(airtable, failure.recipient), failure.recipient))) {
      throw new Error("A failed recipient could not be confirmed reserved. Refusing to send.");
    }
  }
  console.log(`Delivery health: ok (${verdict.recipientScoped.length} recipient-scoped failure(s) in 24 h reserved; ${history.length} emails in 30 days checked).`);
  return history;
}

async function main(): Promise<void> {
  const preview = process.argv.includes("--preview");
  const idsIndex = process.argv.indexOf("--preview-record-ids");
  if (idsIndex >= 0 && !preview) throw new Error("--preview-record-ids is read-only and requires --preview.");
  const pilotIds = idsIndex >= 0 ? parsePilotPreviewIds(process.argv[idsIndex + 1] ?? "") : undefined;
  const limitIndex = process.argv.indexOf("--limit");
  const previewLimit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : undefined;
  if (previewLimit !== undefined && !(Number.isInteger(previewLimit) && previewLimit > 0)) throw new Error("--limit must be a positive integer.");
  if (pilotIds && previewLimit !== undefined && previewLimit < pilotIds.length) throw new Error("--limit must cover every selected pilot record.");
  // Readiness: a preview that fails (exit 1) unless at least N of the checked rows are eligible now.
  const minIndex = process.argv.indexOf("--min-eligible");
  const minEligible = minIndex >= 0 ? Number(process.argv[minIndex + 1]) : undefined;
  if (minEligible !== undefined && (!preview || !Number.isInteger(minEligible) || minEligible < 1)) throw new Error("--min-eligible needs --preview and a positive integer.");
  const env = process.env;
  if (preview) console.log("Technical preview only: counts do not establish opt-in, provider permission or legal readiness. Nothing will be sent or written.");
  const cfg = loadLiteSendConfig(preview && !env.RESEND_DAILY_QUOTA ? { ...env, RESEND_DAILY_QUOTA: "1000" } : env);
  if (!preview) assertConfirmedResendSending(cfg, env);
  // Scheduled events arrive hours late or not at all, so the workflow lets them start early and wait.
  const leadMinutes = Number(env.GULLKORNET_LITE_MAX_LEAD_MINUTES?.trim() || SLOT_LEAD_MS / 60_000);
  if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes * 60_000 > MAX_SCHEDULED_LEAD_MS) {
    throw new Error(`GULLKORNET_LITE_MAX_LEAD_MINUTES must be 0-${MAX_SCHEDULED_LEAD_MS / 60_000}.`);
  }
  const slot = preview ? undefined : resolveLiteSlot(Date.now(), cfg, env.GULLKORNET_LITE_ONE_OFF_DATE, leadMinutes * 60_000);
  if (!preview && !slot) {
    // Checked before any provider or CRM call: other cron triggers of the day end here.
    console.log(`Gullkornet Lite: not within the ${cfg.startHour}:00-${cfg.endHour}:00 Europe/Oslo slot or its ${leadMinutes}-minute lead. Nothing sent.`);
    return;
  }
  const airtable = airtableConfigFromEnv(env);
  const allowedOrgForms = parseAllowedOrgForms(env.GULLKORNET_LITE_ORG_FORMS);
  const resendKey = env.RESEND_API_KEY?.trim() ?? "";
  if (!preview && !resendKey) throw new Error("RESEND_API_KEY is required for live sending.");

  const research = await loadResearchIndex();
  const previewReplies = new Map<string, boolean>();
  async function preparePreviewReplies(rows: Awaited<ReturnType<typeof fetchLiteQueue>>) {
    if (!preview) return rows;
    const selected = previewLimit === undefined ? rows : rows.slice(0, previewLimit);
    const emails = [...new Set(selected.map(r => String(r.fields.Email ?? "").trim().toLowerCase()).filter(Boolean))];
    for (let i = 0; i < emails.length; i += REPLY_STATUS_BATCH_MAX) {
      const answers = await timed("reply_batch", fetchRepliedBatch)(emails.slice(i, i + REPLY_STATUS_BATCH_MAX), env);
      for (const [email, replied] of answers) previewReplies.set(email, replied);
    }
    return rows;
  }

  const summary = await runLiteSend({
    now: () => Date.now(),
    sleep,
    fetchLedger: timed("delivery_health", async () => {
      if (!preview) return enforceDeliveryHealth(resendKey, airtable, env);
      return resendKey ? fetchRecentSendLedger(resendKey) : [];
    }),
    fetchQueue: async () => {
      if (pilotIds) return preparePreviewReplies(await fetchPilotPreviewRows(airtable, pilotIds));
      if (!preview) {
        // Controlled retry: Lite Recheck rows whose date has come go back to Lite Ready and through every gate again.
        const due = dueRechecks(await fetchLiteRowsByStatus(airtable, LITE_RECHECK_STATUS), Date.now());
        for (const row of due) {
          await writeLiteStatus(airtable, row.id, { status: LITE_READY_STATUS, notes: String(row.fields["Research Notes"] ?? "") }, env);
        }
        if (due.length) console.log(`Released ${due.length} Lite Recheck row(s) for a new check.`);
      }
      // A preview above 300 reads as many queue pages as it needs (up to 3000 rows), so readiness can
      // check every queued row instead of estimating from a sample. Live runs read the oldest 300.
      const pages = preview && previewLimit !== undefined && previewLimit > 300 ? Math.min(30, Math.ceil(previewLimit / 100)) : 3;
      return preparePreviewReplies(await fetchLiteQueue(airtable, pages));
    },
    lookupRecords: timed("airtable_lookup", (email: string) => lookupLiteRecords(airtable, email)),
    assertNotReplied: timed("reply_check", async (email: string) => {
      if (!preview) return withTransientRetry(() => assertRecipientHasNotReplied(email, env), sleep);
      // Only a read-only preview may use this snapshot. Live sends always query afresh.
      const replied = previewReplies.get(email.trim().toLowerCase());
      if (replied === undefined) throw new Error("Preview reply-status batch left out an address.");
      if (replied) throw new Error("Recipient has replied. Follow-up/outreach is blocked.");
    }),
    checkFreshness: (email, notes) => checkLiteFreshness(notes, email, allowedOrgForms, {
      fetchImpl: timed("brreg", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init)),
      resolveMxImpl: timed("dns_mx", (domain: string) => mxResolver.resolveMx(domain))
    }),
    markStale: (recordId, reason, notes) => {
      if (preview) throw new Error("Preview must never write.");
      return writeLiteStatus(airtable, recordId, staleUpdate(notes, reason as FreshnessReason, Date.now()), env);
    },
    send: timed("resend_send", async (email: Parameters<typeof sendOneEmail>[0], key: string) => {
      if (preview) throw new Error("Preview must never send.");
      return sendOneEmail(email, resendKey, key);
    }),
    markSent: timed("airtable_claim", async (recordId: string, researchNotes: string) => {
      if (preview) throw new Error("Preview must never write.");
      return markLiteSent(airtable, recordId, researchNotes, env);
    }),
    markReady: recordId => {
      if (preview) throw new Error("Preview must never write.");
      return markLiteReady(airtable, recordId, env);
    },
    log: message => console.log(message)
  }, cfg, { preview, allowedOrgForms, previewLimit, slot });

  console.log(`Timing: ${timingSummary() || "-"}`);
  // Counts only: no addresses or company names in logs.
  console.log(`Gullkornet Lite ${preview ? "preview" : "run"}: scanned=${summary.scanned} sent=${summary.sent} ` +
    `eligible=${summary.eligibleInPreview ?? "-"} refused=${summary.skipped.refused} replied=${summary.skipped.replied} ` +
    `recentlySent=${summary.skipped.recentlySent} stale=${summary.skipped.stale} documentedSegments=${research.size} ` +
    `target=${summary.target ?? "-"} slot=${slot?.kind ?? "-"} stoppedBy=${summary.stoppedBy}`);

  if (minEligible !== undefined) {
    const ready = (await fetchLiteRowsByStatus(airtable, LITE_READY_STATUS, 30)).filter(r => r.fields["Do Not Contact"] !== true).length;
    const recheck = (await fetchLiteRowsByStatus(airtable, LITE_RECHECK_STATUS, 30)).length;
    const eligible = summary.eligibleInPreview ?? 0;
    const rate = summary.scanned ? eligible / summary.scanned : 0;
    const expiries = [...research.values()].map(r => Date.parse(r.researchedAt) + LITE_RESEARCH_MAX_AGE_DAYS * 86_400_000).filter(Number.isFinite);
    const firstExpiry = expiries.length ? new Date(Math.min(...expiries)).toISOString().slice(0, 10) : "none";
    // Every queued row checked: the count itself, not an estimate from a sample.
    const counted = summary.scanned >= ready;
    const estimate = counted ? eligible : Math.floor(ready * rate);
    // Net supply over the last 24 h: new rows that would qualify at today's rate, minus what the
    // account sent (every send uses one qualified row).
    const added = await countLiteRowsCreatedSince(airtable, 24);
    const sentLastDay = resendKey ? countLedger(await fetchRecentSendLedger(resendKey), Date.now()).lastDay : undefined;
    const netQualified = sentLastDay === undefined ? "-" : String(Math.round(added * rate) - sentLastDay);
    console.log(`Readiness: liteReady=${ready} liteRecheck=${recheck} checked=${summary.scanned} eligible=${eligible} ` +
      `eligibleRate=${(100 * rate).toFixed(0)}% ${counted ? "qualifiedQueueCounted" : "estimatedEligibleQueue"}=${estimate} daysAt95=${(estimate / 95).toFixed(1)} ` +
      `required=${minEligible} firstResearchExpiry=${firstExpiry} addedLast24h=${added} sentLast24h=${sentLastDay ?? "-"} netQualifiedLast24h=${netQualified}`);
    if (eligible < minEligible) {
      console.error(`Readiness failed: ${eligible} eligible of ${summary.scanned} checked, ${minEligible} required (95 + reserve). Refill the Lite Ready queue.`);
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite send failed.");
  process.exitCode = 1;
});
