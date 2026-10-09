import { readFile } from "node:fs/promises";
import { assertLiveSendAllowed, assertProductionKillSwitchEnabled, assertRateLimits, countRecentSends, fetchRecentSendLedger, parseSuppressionList, prepareEmail, sendOneEmail, type OutreachDraft } from "../integrations/outbound-email.js";

const args = process.argv.slice(2);
const sendRequested = args.includes("--send");
const positional = args.filter((arg) => arg !== "--send");
const inputPath = positional[0] ?? "data/contact-research-drafts.json";
const recipient = positional[1];

try {
  if (!recipient) throw new Error("Usage: npm run send:email -- <drafts.json> <recipient-email> [--send]. Default is dry-run.");
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Draft input must be a JSON array.");
  const email = prepareEmail(parsed as OutreachDraft[], recipient);
  console.log("GULLKORNET OUTBOUND EMAIL");
  console.log(`Mode: ${sendRequested ? "LIVE SEND REQUESTED" : "DRY RUN — nothing sent"}`);
  console.log(`From: ${email.from}`);
  console.log(`To: ${email.to}`);
  console.log(`Subject: ${email.subject}`);
  console.log("--- BODY ---");
  console.log(email.text);
  console.log("--- END BODY ---");
  if (!sendRequested) {
    console.log("Dry run complete. No suppression list or provider credentials were accessed.");
    process.exit(0);
  }

  let suppressionContents: string;
  try {
    suppressionContents = await readFile("data/suppressed-emails.txt", "utf8");
  } catch {
    throw new Error("Required data/suppressed-emails.txt is missing. Create it before any live send; one email per line, # for comments.");
  }
  const suppressedEmails = parseSuppressionList(suppressionContents);
  assertProductionKillSwitchEnabled(process.env);
  assertLiveSendAllowed(email, process.env, suppressedEmails);
  const ledger = await fetchRecentSendLedger(process.env.RESEND_API_KEY!.trim());
  assertRateLimits(countRecentSends(ledger), process.env);
  const result = await sendOneEmail(
    email,
    process.env.RESEND_API_KEY!.trim(),
    process.env.GULLKORNET_SEND_IDEMPOTENCY_KEY!.trim()
  );
  console.log(`Resend accepted one email. Email ID: ${result.id}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Outbound email failed.");
  process.exitCode = 1;
}
