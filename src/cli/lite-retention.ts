import { fetchAllTableRows } from "../lite/airtable-queue.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { airtableRetentionWriter, executeLiteRetention, planLiteRetention, retentionExecutionAllowed } from "../lite/retention.js";

// npm run lite:retention               -> dry-run: prints the plan (record IDs and counts), changes nothing
// npm run lite:retention -- --execute  -> applies it, only when GULLKORNET_LITE_RETENTION_EXECUTE=true
// Rules: src/lite/retention.ts and docs/LITE-LAGRING-OG-SLETTING.md.

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const cfg = airtableConfigFromEnv(process.env);
  const plan = planLiteRetention(await fetchAllTableRows(cfg), Date.now());
  const deletes = plan.actions.filter(a => a.action === "delete");
  const minimizes = plan.actions.filter(a => a.action === "minimize");
  console.log(`Gullkornet Lite retention ${execute ? "EXECUTE" : "dry-run"}: delete=${deletes.length} minimize=${minimizes.length} ` +
    `keptActive=${plan.keptActive.length} undated=${plan.undated.length} alreadyMinimized=${plan.alreadyMinimized}`);
  for (const action of plan.actions) console.log(`  ${action.id}: ${action.action} (${action.reason})`);
  if (plan.undated.length) console.log(`  undated (never touched): ${plan.undated.join(", ")}`);
  if (!execute) return;
  if (!retentionExecutionAllowed()) throw new Error("GULLKORNET_LITE_RETENTION_EXECUTE is not true. Nothing was changed.");
  const result = await executeLiteRetention(plan, airtableRetentionWriter(cfg));
  console.log(`Applied: deleted=${result.deleted} minimized=${result.minimized}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite retention failed.");
  process.exitCode = 1;
});
