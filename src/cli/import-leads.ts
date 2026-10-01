import { readFile } from "node:fs/promises";
import { JsonLeadStore } from "../storage/lead-store.js";
import { importLeadRecords } from "../domain/intake.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: npm run import:leads -- <path-to-json-file>");
  process.exitCode = 2;
} else {
  try {
    const raw = await readFile(inputPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Input file must contain a JSON array of lead records.");
    }

    const storePath = process.env.LEAD_STORE_PATH?.trim() || "data/leads.json";
    const summary = await importLeadRecords(parsed, new JsonLeadStore(storePath));
    console.log(JSON.stringify({ storePath, ...summary }, null, 2));
    if (summary.rejected > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Lead import failed");
    process.exitCode = 1;
  }
}
