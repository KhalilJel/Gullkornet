import { createHash } from "node:crypto";
import {
  fetchApprovedOutreachQueue,
  fetchAirtableRecipientApproval,
  markAirtableRecipientSent,
  assertAirtableRecipientApproved,
  type AirtableSendApproval
} from "../integrations/airtable-send-approval.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import {
  assertLiveSendAllowed,
  assertProductionKillSwitchEnabled,
  assertRateLimits,
  assertRecipientNotAlreadySent,
  countRecentSends,
  fetchRecentSendLedger,
  isSharedBusinessInbox,
  prepareEmail,
  sendOneEmail,
  type OutreachDraft
} from "../integrations/outbound-email.js";

function draftFromRecord(record: AirtableSendApproval): { email: string; subject: string; text: string } | undefined {
  const fields = record.fields;
  const email = typeof fields.Email === "string" ? fields.Email.trim().toLowerCase() : "";
  const subject = typeof fields["Outreach Subject"] === "string" ? fields["Outreach Subject"].trim() : "";
  const text = typeof fields["Outreach Draft"] === "string" ? fields["Outreach Draft"].trim() : "";
  if (!email || !subject || !text || !isSharedBusinessInbox(email)) return undefined;
  try {
    assertAirtableRecipientApproved([record], email, { subject, text });
    return { email, subject, text };
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  // A missing or false kill switch prevents any provider or CRM calls.
  assertProductionKillSwitchEnabled(process.env);
  const queue = await fetchApprovedOutreachQueue(process.env);
  let selected: { record: AirtableSendApproval; email: string; subject: string; text: string } | undefined;

  for (const record of queue) {
    const draft = draftFromRecord(record);
    if (!draft) continue;
    const recordId = await fetchAirtableRecipientApproval(
      draft.email,
      { subject: draft.subject, text: draft.text },
      process.env
    );
    try {
      await assertRecipientHasNotReplied(draft.email, process.env);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Recipient has replied")) continue;
      throw error;
    }
    selected = { record: { ...record, id: recordId }, ...draft };
    break;
  }

  if (!selected) {
    console.log("No approved, personalized, human-verified business-inbox draft is eligible today.");
    return;
  }

  const recordId = selected.record.id;
  const draft: OutreachDraft = {
    companyName: "",
    emails: [{ email: selected.email }],
    subject: selected.subject,
    draftBody: selected.text
  };
  const email = prepareEmail([draft], selected.email);
  const ledger = await fetchRecentSendLedger(process.env.RESEND_API_KEY?.trim() ?? "");
  const recent = countRecentSends(ledger);
  const sendKey = "gullkornet-" + createHash("sha256")
    .update([recordId, email.to, email.subject, email.text].join("\n"))
    .digest("hex");
  const sendEnv = {
    ...process.env,
    GULLKORNET_APPROVED_RECIPIENT: email.to,
    GULLKORNET_RECIPIENT_REVIEWED: "true",
    GULLKORNET_SEND_IDEMPOTENCY_KEY: sendKey
  };
  assertRateLimits(recent, sendEnv);
  assertRecipientNotAlreadySent(ledger, email.to);
  // Airtable's false Do Not Contact check and the reply-status service are the
  // persistent suppression sources; no local suppression file is required.
  assertLiveSendAllowed(email, sendEnv, new Set());

  const result = await sendOneEmail(email, process.env.RESEND_API_KEY!.trim(), sendKey);
  try {
    await markAirtableRecipientSent(recordId, process.env);
  } catch {
    throw new Error(`Resend accepted email ID ${result.id}, but Airtable state could not be confirmed. Do not retry until reconciled.`);
  }
  console.log("One approved outreach email was accepted and Airtable is marked Sent.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Automated outreach failed.");
  process.exitCode = 1;
});
