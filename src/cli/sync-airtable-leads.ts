import "dotenv/config";
import { readFile } from "node:fs/promises";
import { syncAirtableReviewRecords, type ResearchRecord } from "../integrations/airtable-review-sync.js";

const apiToken = process.env.AIRTABLE_API_TOKEN?.trim();
const baseId = process.env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
const tableName = process.env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
const inputPath = process.argv[2] || "data/contact-research-drafts.json";

async function main(): Promise<void> {
  if (!apiToken || !baseId) throw new Error("AIRTABLE_SYNC_NOT_CONFIGURED");

  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("AIRTABLE_SYNC_INPUT_MUST_BE_ARRAY");

  const result = await syncAirtableReviewRecords(parsed as ResearchRecord[], {
    apiToken,
    baseId,
    tableName
  });

  // Do not log mailbox contents, draft bodies, email addresses, or credentials.
  console.log(JSON.stringify({
    baseId,
    tableName,
    ...result,
    emailsSent: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Airtable lead sync failed.");
  process.exitCode = 1;
});
