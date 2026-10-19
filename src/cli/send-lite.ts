import { fetchRecentSendLedger, sendOneEmail } from "../integrations/outbound-email.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import { fetchLiteQueue, fetchPilotPreviewRows, lookupLiteRecords, markLiteReady, markLiteSent } from "../lite/airtable-queue.js";
import { parsePilotPreviewIds } from "../lite/pilot-preview.js";
import { assertConfirmedResendSending, assertResendDeliveryHealthy } from "../lite/resend-pilot.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { checkLiteFreshness } from "../lite/freshness.js";
import { loadResearchIndex } from "../lite/market-research.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";
import { loadLiteSendConfig, resolveLiteSlot } from "../lite/schedule.js";
import { runLiteSend, withTransientRetry } from "../lite/send.js";

// npm run send:lite            -> no-op with switch off; otherwise owner-confirmed operation up to 95/day,
//                                 spread evenly over 11:00-12:00 Oslo (a run up to 30 min early waits for it).
//   GULLKORNET_LITE_ONE_OFF_DATE=<today, Oslo> -> owner's one-off: the same, spread over the next 60 minutes.
// npm run send:lite -- --preview [--limit 100] -> read-only: runs every gate over (the first N of) the queue, never sends or writes

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const preview = process.argv.includes("--preview");
  const idsIndex = process.argv.indexOf("--preview-record-ids");
  if (idsIndex >= 0 && !preview) throw new Error("--preview-record-ids is read-only and requires --preview.");
  const pilotIds = idsIndex >= 0 ? parsePilotPreviewIds(process.argv[idsIndex + 1] ?? "") : undefined;
  const limitIndex = process.argv.indexOf("--limit");
  const previewLimit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : undefined;
  if (previewLimit !== undefined && !(Number.isInteger(previewLimit) && previewLimit > 0)) throw new Error("--limit must be a positive integer.");
  if (pilotIds && previewLimit !== undefined && previewLimit < pilotIds.length) throw new Error("--limit must cover every selected pilot record.");
  const env = process.env;
  if (!preview && env.GULLKORNET_LITE_ENABLE_LIVE_SEND !== "true") {
    // Checked before any provider or CRM call.
    console.log("Gullkornet Lite: live sending kill switch is off. Nothing sent.");
    return;
  }
  if (preview) console.log("Technical preview only: counts do not establish opt-in, provider permission or legal readiness. Nothing will be sent or written.");
  const cfg = loadLiteSendConfig(preview && !env.RESEND_DAILY_QUOTA ? { ...env, RESEND_DAILY_QUOTA: "1000" } : env);
  if (!preview) assertConfirmedResendSending(cfg, env);
  const slot = preview ? undefined : resolveLiteSlot(Date.now(), cfg, env.GULLKORNET_LITE_ONE_OFF_DATE);
  if (!preview && !slot) {
    // Checked before any provider or CRM call: other cron triggers of the day end here.
    console.log(`Gullkornet Lite: not within the ${cfg.startHour}:00-${cfg.endHour}:00 Europe/Oslo slot or its 30-minute lead. Nothing sent.`);
    return;
  }
  const airtable = airtableConfigFromEnv(env);
  const allowedOrgForms = parseAllowedOrgForms(env.GULLKORNET_LITE_ORG_FORMS);
  const resendKey = env.RESEND_API_KEY?.trim() ?? "";
  if (!preview && !resendKey) throw new Error("RESEND_API_KEY is required for live sending.");

  const research = await loadResearchIndex();

  const summary = await runLiteSend({
    now: () => Date.now(),
    sleep,
    fetchLedger: async () => {
      const entries = resendKey ? await fetchRecentSendLedger(resendKey) : [];
      if (!preview) assertResendDeliveryHealthy(entries, Date.now());
      return entries;
    },
    fetchQueue: () => pilotIds ? fetchPilotPreviewRows(airtable, pilotIds) : fetchLiteQueue(airtable),
    lookupRecords: email => lookupLiteRecords(airtable, email),
    assertNotReplied: email => withTransientRetry(() => assertRecipientHasNotReplied(email, env), sleep),
    findResearch: segment => research.get(segment.key),
    checkFreshness: (email, notes) => checkLiteFreshness(notes, email, allowedOrgForms),
    send: (email, key) => {
      if (preview) throw new Error("Preview must never send.");
      return sendOneEmail(email, resendKey, key);
    },
    markSent: (recordId, researchNotes) => {
      if (preview) throw new Error("Preview must never write.");
      return markLiteSent(airtable, recordId, researchNotes, env);
    },
    markReady: recordId => {
      if (preview) throw new Error("Preview must never write.");
      return markLiteReady(airtable, recordId, env);
    },
    log: message => console.log(message)
  }, cfg, { preview, allowedOrgForms, previewLimit, slot });

  // Counts only: no addresses or company names in logs.
  console.log(`Gullkornet Lite ${preview ? "preview" : "run"}: scanned=${summary.scanned} sent=${summary.sent} ` +
    `eligible=${summary.eligibleInPreview ?? "-"} refused=${summary.skipped.refused} replied=${summary.skipped.replied} ` +
    `recentlySent=${summary.skipped.recentlySent} noResearch=${summary.skipped.noResearch} stale=${summary.skipped.stale} documentedSegments=${research.size} ` +
    `target=${summary.target ?? "-"} slot=${slot?.kind ?? "-"} stoppedBy=${summary.stoppedBy}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite send failed.");
  process.exitCode = 1;
});
