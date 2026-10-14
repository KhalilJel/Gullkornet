import { fetchRecipientReplied } from "../integrations/reply-status.js";
import { fetchLiteRowsByStatus, markLiteReplied } from "../lite/airtable-queue.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { runLiteReplySync } from "../lite/replies.js";
import { withTransientRetry } from "../lite/send.js";

// npm run lite:replies
// Moves sent Lite rows whose business has answered to Lead Status "Replied". Sends nothing.
// Logs counts only: no addresses or company names.

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const airtable = airtableConfigFromEnv(process.env);
  const summary = await runLiteReplySync({
    fetchSent: () => fetchLiteRowsByStatus(airtable, "Sent"),
    hasReplied: email => withTransientRetry(() => fetchRecipientReplied(email, process.env), sleep),
    markReplied: recordId => markLiteReplied(airtable, recordId, process.env)
  });
  console.log(`Gullkornet Lite reply sync: checked=${summary.checked} replied=${summary.replied} noEmail=${summary.noEmail}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite reply sync failed.");
  process.exitCode = 1;
});
