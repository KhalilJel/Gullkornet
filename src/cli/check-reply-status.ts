import { runReplyStatusCheck } from "../integrations/reply-status-check.js";

// npm run check:reply-status
// Read-only: two reply-status lookups, nothing sent or written. Prints only the results,
// never an address or token. The test sender comes from GULLKORNET_REPLY_TEST_SENDER.

async function main(): Promise<void> {
  const report = await runReplyStatusCheck(process.env.GULLKORNET_REPLY_TEST_SENDER ?? "");
  console.log(`Positive control (test sender): ${report.positive}`);
  console.log(`Negative control (unused address): ${report.negative}`);
  console.log(`Reply-status check: ${report.pass ? "PASS" : "FAIL"}`);
  if (!report.pass) process.exitCode = 1;
}

main().catch(() => {
  console.error("Reply-status check: error");
  process.exitCode = 1;
});
