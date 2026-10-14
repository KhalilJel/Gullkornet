import { markAirtableRecipientSent } from "../integrations/airtable-send-approval.js";
import { fetchRecentSendLedger, sendOneEmail } from "../integrations/outbound-email.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import { fetchLiteQueue, lookupLiteRecords } from "../lite/airtable-queue.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";
import { loadLiteSendConfig } from "../lite/schedule.js";
import { runLiteSend } from "../lite/send.js";

// npm run send:lite            -> live run (no-op unless GULLKORNET_LITE_ENABLE_LIVE_SEND=true)
// npm run send:lite -- --preview -> read-only: runs every gate over the queue, never sends or writes

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

  const summary = await runLiteSend({
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    fetchLedger: () => resendKey ? fetchRecentSendLedger(resendKey) : Promise.resolve([]),
    fetchQueue: () => fetchLiteQueue(airtable),
    lookupRecords: email => lookupLiteRecords(airtable, email),
    assertNotReplied: email => assertRecipientHasNotReplied(email, env),
    send: (email, key) => {
      if (preview) throw new Error("Preview must never send.");
      return sendOneEmail(email, resendKey, key);
    },
    markSent: recordId => {
      if (preview) throw new Error("Preview must never write.");
      return markAirtableRecipientSent(recordId, env);
    },
    log: message => console.log(message)
  }, cfg, { preview, allowedOrgForms });

  // Counts only: no addresses or company names in logs.
  console.log(`Gullkornet Lite ${preview ? "preview" : "run"}: scanned=${summary.scanned} sent=${summary.sent} ` +
    `eligible=${summary.eligibleInPreview ?? "-"} refused=${summary.skipped.refused} replied=${summary.skipped.replied} ` +
    `recentlySent=${summary.skipped.recentlySent} stoppedBy=${summary.stoppedBy}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite send failed.");
  process.exitCode = 1;
});
