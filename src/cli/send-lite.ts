import { fetchRecentSendLedger, sendOneEmail } from "../integrations/outbound-email.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import { fetchLiteQueue, lookupLiteRecords, markLiteReady, markLiteSent } from "../lite/airtable-queue.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { loadResearchIndex } from "../lite/market-research.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";
import { loadLiteSendConfig } from "../lite/schedule.js";
import { runLiteSend, withTransientRetry } from "../lite/send.js";

// npm run send:lite            -> live run (no-op unless GULLKORNET_LITE_ENABLE_LIVE_SEND=true)
// npm run send:lite -- --preview -> read-only: runs every gate over the queue, never sends or writes

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const preview = process.argv.includes("--preview");
  const env = process.env;
  if (!preview && env.GULLKORNET_LITE_ENABLE_LIVE_SEND !== "true") {
    // Checked before any provider or CRM call.
    console.log("Gullkornet Lite: live sending kill switch is off. Nothing sent.");
    return;
  }
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
  }, cfg, { preview, allowedOrgForms });

  // Counts only: no addresses or company names in logs.
  console.log(`Gullkornet Lite ${preview ? "preview" : "run"}: scanned=${summary.scanned} sent=${summary.sent} ` +
    `eligible=${summary.eligibleInPreview ?? "-"} refused=${summary.skipped.refused} replied=${summary.skipped.replied} ` +
    `recentlySent=${summary.skipped.recentlySent} noResearch=${summary.skipped.noResearch} documentedSegments=${research.size} stoppedBy=${summary.stoppedBy}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite send failed.");
  process.exitCode = 1;
});
