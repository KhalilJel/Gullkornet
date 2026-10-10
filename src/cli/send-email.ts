import { readFile, writeFile } from "node:fs/promises";
import { fetchAirtableRecipientApproval, markAirtableRecipientSent } from "../integrations/airtable-send-approval.js";
import { assertRecipientHasNotReplied } from "../integrations/reply-status.js";
import { assertLiveSendAllowed, assertProductionKillSwitchEnabled, assertRateLimits, assertRecipientNotAlreadySent, countRecentSends, fetchRecentSendLedger, parseSuppressionList, prepareEmail, sendOneEmail, type OutreachDraft } from "../integrations/outbound-email.js";

const args = process.argv.slice(2);
const sendRequested = args.includes("--send");
const previewFileIndex = args.indexOf("--preview-file");
const previewFilePath = previewFileIndex >= 0 ? args[previewFileIndex + 1] : undefined;

if (previewFileIndex >= 0 && !previewFilePath) {
  throw new Error("--preview-file requires a destination path.");
}
if (sendRequested && previewFilePath) {
  throw new Error("--preview-file is available only in dry-run mode.");
}

const positional = args.filter((arg, index) =>
  arg !== "--send" &&
  (previewFileIndex < 0 || (index !== previewFileIndex && index !== previewFileIndex + 1))
);
const inputPath = positional[0] ?? "data/contact-research-drafts.json";
const recipient = positional[1];

try {
  if (!recipient) {
    throw new Error("Usage: npm run send:email -- <drafts.json> <recipient-email> [--preview-file <local-path>] [--send]. Default is dry-run.");
  }
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Draft input must be a JSON array.");
  const email = prepareEmail(parsed as OutreachDraft[], recipient);

  if (previewFilePath) {
    // Explicit operator-only preview: create a new local file with owner-only permissions.
    // Never print recipient or draft content to stdout/stderr where CI logs may persist it.
    await writeFile(
      previewFilePath,
      `From: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    console.log("GULLKORNET OUTBOUND EMAIL");
    console.log("Mode: DRY RUN — nothing sent");
    console.log("Preview written to the requested local file; content is suppressed from logs.");
  } else {
    console.log("GULLKORNET OUTBOUND EMAIL");
    console.log(`Mode: ${sendRequested ? "LIVE SEND REQUESTED" : "DRY RUN — nothing sent"}`);
    console.log("Recipient and draft content are suppressed from stdout/stderr.");
  }

  if (!sendRequested) {
    console.log("Dry run complete. No suppression list or provider credentials were accessed.");
    process.exit(0);
  }

  // The kill switch is the first live-path gate: if off, no provider/CRM calls occur.
  assertProductionKillSwitchEnabled(process.env);

  let suppressionContents: string;
  try {
    suppressionContents = await readFile("data/suppressed-emails.txt", "utf8");
  } catch {
    throw new Error("Required data/suppressed-emails.txt is missing. Create it before any live send; one email per line, # for comments.");
  }
  const suppressedEmails = parseSuppressionList(suppressionContents);
  const airtableRecordId = await fetchAirtableRecipientApproval(email.to, process.env);
  await assertRecipientHasNotReplied(email.to, process.env);
  assertLiveSendAllowed(email, process.env, suppressedEmails);
  const ledger = await fetchRecentSendLedger(process.env.RESEND_API_KEY!.trim());
  assertRecipientNotAlreadySent(ledger, email.to);
  assertRateLimits(countRecentSends(ledger), process.env);
  const result = await sendOneEmail(
    email,
    process.env.RESEND_API_KEY!.trim(),
    process.env.GULLKORNET_SEND_IDEMPOTENCY_KEY!.trim()
  );
  try {
    await markAirtableRecipientSent(airtableRecordId, process.env);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown Airtable update error";
    throw new Error(`Resend accepted email ID ${result.id}, but Airtable state could not be confirmed. Do not retry until reconciled. Detail: ${reason}`);
  }
  console.log("Resend accepted one email and Airtable is marked Sent.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Outbound email failed.");
  process.exitCode = 1;
}
