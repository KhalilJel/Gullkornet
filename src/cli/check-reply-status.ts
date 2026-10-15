import { fetchRepliedBatch } from "../integrations/reply-status.js";
import { negativeControlAddress, runReplyStatusCheck } from "../integrations/reply-status-check.js";

// npm run check:reply-status
// Read-only: reply-status lookups only, nothing sent or written. Prints only the results,
// never an address or token. The test sender comes from GULLKORNET_REPLY_TEST_SENDER.
// Checks the single lookup (used before each send) and the batch lookup (used by Reply Sync)
// with the same positive and negative controls.

async function main(): Promise<void> {
  const sender = process.env.GULLKORNET_REPLY_TEST_SENDER ?? "";
  const report = await runReplyStatusCheck(sender);
  console.log(`Positive control (test sender): ${report.positive}`);
  console.log(`Negative control (unused address): ${report.negative}`);
  let batchPass = false;
  try {
    const negative = negativeControlAddress();
    const answers = await fetchRepliedBatch([sender, negative]);
    const positive = answers.get(sender.trim().toLowerCase());
    batchPass = positive === true && answers.get(negative) === false;
    console.log(`Batch lookup: positive replied=${positive} negative replied=${answers.get(negative)}`);
  } catch {
    console.log("Batch lookup: error");
  }
  const pass = report.pass && batchPass;
  console.log(`Reply-status check: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exitCode = 1;
}

main().catch(() => {
  console.error("Reply-status check: error");
  process.exitCode = 1;
});
