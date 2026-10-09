import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { runSalesEngine } from "../integrations/sales-engine.js";
import { createPhase9SalesEngineDependencies } from "../integrations/sales-engine-runtime.js";

function boundedCount(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : fallback;
}

async function main(): Promise<void> {
  const dryRun = process.env.GULLKORNET_SALES_ENGINE_DRY_RUN !== "false";
  const maxLeads = boundedCount(process.env.GULLKORNET_SALES_ENGINE_MAX_LEADS, 20);
  const dependencies = createPhase9SalesEngineDependencies();
  const result = await runSalesEngine(dependencies, { dryRun, maxLeads });

  await mkdir("data", { recursive: true });
  await writeFile(
    "data/sales-engine-review-queue.json",
    JSON.stringify(result.reviewRequired, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );

  // Do not print emails or full draft content into deployment logs.
  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "queue-ingest",
    discovered: result.discovered,
    deduplicated: result.deduplicated,
    researched: result.researched,
    eligibleForOpenOutSend: result.queued,
    reviewRequired: result.reviewRequired.length,
    skipped: result.skipped,
    reviewQueuePath: "data/sales-engine-review-queue.json",
    emailSent: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Sales engine failed.");
  process.exitCode = 1;
});
