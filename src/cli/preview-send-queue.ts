import "dotenv/config";
import { fetchAirtableRecipientApproval, fetchApprovedOutreachQueue } from "../integrations/airtable-send-approval.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import { previewQueue } from "../integrations/send-selection.js";

// Read-only: counts how many AI-approved Airtable drafts would pass every per-record send gate
// right now. It does not read or need the kill switch, Resend or any send credential, and it
// writes nothing. Output is counts only. Requires AIRTABLE_API_TOKEN and
// GULLKORNET_AIRTABLE_BASE_ID; the reply check runs only if the reply-status variables are set.
const replyCheck = Boolean(process.env.OPENOUTREACH_REPLY_STATUS_URL?.trim() && process.env.OPENOUTREACH_REPLY_STATUS_TOKEN?.trim());

try {
  const queue = await fetchApprovedOutreachQueue(process.env);
  const result = await previewQueue(queue, {
    lookupApproval: (address, draft) => fetchAirtableRecipientApproval(address, draft, process.env),
    assertNotReplied: replyCheck ? (address) => assertRecipientHasNotReplied(address, process.env) : async () => undefined
  });
  console.log(JSON.stringify({ ...result, replyCheckIncluded: replyCheck, sent: 0, writes: 0 }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/[^A-Za-z0-9_ .,:()-]/g, "").slice(0, 120) : "Preview failed.");
  process.exitCode = 1;
}
