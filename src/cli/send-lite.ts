import { fetchRecentSendLedger, sendOneEmail } from "../integrations/outbound-email.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import { fetchLiteQueue, lookupLiteRecords, markLiteReady, markLiteSent } from "../lite/airtable-queue.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { checkLiteFreshness } from "../lite/freshness.js";
import { loadResearchIndex } from "../lite/market-research.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";
import { loadLiteSendConfig } from "../lite/schedule.js";
import { runLiteSend, withTransientRetry } from "../lite/send.js";

// npm run send:lite            -> no-op with switch off; otherwise refuses the unsupported Resend outreach use case.
// npm run send:lite -- --preview [--limit 100] -> read-only: runs every gate over (the first N of) the queue, never sends or writes

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const preview = process.argv.includes("--preview");
  const limitIndex = process.argv.indexOf("--limit");
  const previewLimit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : undefined;
  if (previewLimit !== undefined && !(Number.isInteger(previewLimit) && previewLimit > 0)) throw new Error("--limit must be a positive integer.");
  const env = process.env;
  if (!preview && env.GULLKORNET_LITE_ENABLE_LIVE_SEND !== "true") {
    // Checked before any provider or CRM call.
    console.log("Gullkornet Lite: live sending kill switch is off. Nothing sent.");
    return;
  }
  // The current Lite queue is public-source prospecting, without recorded opt-in. Resend's
  // AUP explicitly prohibits this use. A live flag cannot resolve a provider restriction.
  // Refuse before config, credentials, provider/CRM access or claiming a row. No env bypass.
  if (!preview) {
    throw new Error("Lite live sending is blocked: Resend requires opt-in and prohibits cold outreach. Resolve the delivery use case before enabling live sending. See docs/LITE-LEVERANDORKONTROLL-2026-10-15.md.");
  }
  console.log("Technical preview only: counts do not establish opt-in, provider permission or legal readiness. Nothing will be sent or written.");
  const cfg = loadLiteSendConfig(preview && !env.RESEND_DAILY_QUOTA ? { ...env, RESEND_DAILY_QUOTA: "1000" } : env);
  const airtable = airtableConfigFromEnv(env);
  const allowedOrgForms = parseAllowedOrgForms(env.GULLKORNET_LITE_ORG_FORMS);
  const resendKey = env.RESEND_API_KEY?.trim() ?? "";
  if (!preview && !resendKey) throw new Error("RESEND_API_KEY is required for live sending.");

  const research = await loadResearchIndex();

  const summary = await runLiteSend({
    now: () => Date.now(),
    sleep,
    fetchLedger: () => resendKey ? fetchRecentSendLedger(resendKey) : Promise.resolve([]),
    fetchQueue: () => fetchLiteQueue(airtable),
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
  }, cfg, { preview, allowedOrgForms, previewLimit });

  // Counts only: no addresses or company names in logs.
  console.log(`Gullkornet Lite ${preview ? "preview" : "run"}: scanned=${summary.scanned} sent=${summary.sent} ` +
    `eligible=${summary.eligibleInPreview ?? "-"} refused=${summary.skipped.refused} replied=${summary.skipped.replied} ` +
    `recentlySent=${summary.skipped.recentlySent} noResearch=${summary.skipped.noResearch} stale=${summary.skipped.stale} documentedSegments=${research.size} stoppedBy=${summary.stoppedBy}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite send failed.");
  process.exitCode = 1;
});
