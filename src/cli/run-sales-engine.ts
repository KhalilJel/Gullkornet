import "dotenv/config";
import { spawn } from "node:child_process";
import { runSalesEngine } from "../integrations/sales-engine.js";
import { persistSalesEngineArtifacts } from "../integrations/sales-engine-orchestration.js";
import { createPhase9SalesEngineDependencies } from "../integrations/sales-engine-runtime.js";

function boundedCount(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : fallback;
}

function syncReviewQueueToAirtable(inputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import", "tsx",
      "src/cli/sync-airtable-leads.ts",
      inputPath
    ], { stdio: "inherit" });

    let settled = false;
    let forceKill: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forceKill.unref();
      if (!settled) {
        settled = true;
        reject(new Error("AIRTABLE_REVIEW_QUEUE_SYNC_TIMEOUT"));
      }
    }, 120_000);

    child.once("error", (error) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error("AIRTABLE_REVIEW_QUEUE_SYNC_FAILED"));
    });
  });
}

async function main(): Promise<void> {
  const dryRun = process.env.GULLKORNET_SALES_ENGINE_DRY_RUN !== "false";
  const maxLeads = boundedCount(process.env.GULLKORNET_SALES_ENGINE_MAX_LEADS, 20);
  const dependencies = createPhase9SalesEngineDependencies();
  const result = await runSalesEngine(dependencies, { dryRun, maxLeads });

  const reviewRecords = result.reviewRequired.map(({ lead, reason, research }) => ({
    companyName: typeof lead.company === "string" ? lead.company : "Unknown business",
    websiteUrl: research?.websiteUrl ?? (typeof lead.website === "string" ? lead.website : undefined),
    city: typeof lead.location === "string" ? lead.location : undefined,
    industry: typeof lead.industry === "string" ? lead.industry : undefined,
    sourceUrl: "https://keelead-production-9f05.up.railway.app/api/leads",
    researchStatus: "REVIEW_REQUIRED",
    emails: typeof lead.email === "string" && lead.email.trim()
      ? [{
          email: lead.email,
          sourceUrl: "https://keelead-production-9f05.up.railway.app/api/enrich",
          sourceType: "KeeLead"
        }]
      : [],
    subject: research?.draft?.subject,
    draftBody: research?.draft?.body,
    personalizationEvidence: research?.evidence?.length
      ? "Automatisk hentet fra nettside/KeeLead, ikke uavhengig verifisert: " + research.evidence.join(" | ")
      : undefined,
    qualificationStatus: research?.qualificationStatus ?? "review_required",
    fitScore: typeof research?.score === "number" ? research.score : undefined,
    qualificationReasons: research?.qualificationReasons ?? research?.scoreReasons ?? [],
    notes: [
      "MANUAL REVIEW: " + reason,
      "Qualification status: " + (research?.qualificationStatus ?? "review_required"),
      "Qualification score: " + (typeof research?.score === "number" ? String(research.score) : "not_scored"),
      ...(research?.qualificationReasons?.length ? ["Qualification reasons: " + research.qualificationReasons.join("; ")] : []),
      "Kontroller at kontaktpersonen og e-postadressen tilhører virksomheten før eventuell kontakt.",
      "Automatiske nettsidesignaler må kontrolleres før de brukes i kundekommunikasjon."
    ],
    researchedAt: new Date().toISOString()
  }));

  // Artifacts are atomically replaced one by one. CRM sync starts only after
  // all three files are safely persisted; sync itself is idempotent and bounded.
  await persistSalesEngineArtifacts({
    reviewQueuePath: "data/sales-engine-review-queue.json",
    reviewQueue: result.reviewRequired,
    draftsPath: "data/contact-research-drafts.json",
    drafts: reviewRecords,
    rejectedPath: "data/sales-engine-rejected.json",
    rejected: result.rejectedLeads
  }, {
    syncReviewQueue: syncReviewQueueToAirtable
  });

  // Do not print emails or full draft content into deployment logs.
  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "queue-ingest",
    discovered: result.discovered,
    deduplicated: result.deduplicated,
    researched: result.researched,
    qualified: result.qualified,
    rejected: result.rejected,
    rejectedArtifactPath: "data/sales-engine-rejected.json",
    eligibleForOpenOutSend: result.queued,
    reviewRequired: result.reviewRequired.length,
    airtableReviewRecords: reviewRecords.length,
    skipped: result.skipped,
    reviewQueuePath: "data/sales-engine-review-queue.json",
    emailSent: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Sales engine failed.");
  process.exitCode = 1;
});
