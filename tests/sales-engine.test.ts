import assert from "node:assert/strict";
import test from "node:test";
import { runSalesEngine, type SalesEngineDependencies } from "../src/integrations/sales-engine.js";

function deps(overrides: Partial<SalesEngineDependencies> = {}): SalesEngineDependencies {
  return {
    discover: async () => [{ company: "Example AS", email: "hello@example.no" }],
    enrich: async (lead) => lead,
    verifyContact: async () => ({ valid: true }),
    research: async () => ({
      websiteUrl: "https://example.no",
      evidence: ["The homepage has no visible service pricing section."],
      score: 80,
      requiresHumanReview: false,
      draft: { subject: "En mulighet for Example AS", body: "Jeg la merke til at ..." }
    }),
    isSuppressed: async () => false,
    ingest: async () => undefined,
    ...overrides
  };
}

test("sales engine prepares a grounded queue in dry-run mode without ingesting", async () => {
  let ingested = false;
  const result = await runSalesEngine(deps({ ingest: async () => { ingested = true; } }));
  assert.equal(result.discovered, 1);
  assert.equal(result.queued, 1);
  assert.equal(result.dryRun, true);
  assert.equal(ingested, false);
});

test("sales engine deduplicates email addresses case-insensitively", async () => {
  const result = await runSalesEngine(deps({
    discover: async () => [
      { company: "Example AS", email: "hello@example.no" },
      { company: "Example Duplicate", email: "HELLO@example.no" }
    ]
  }));
  assert.equal(result.deduplicated, 1);
  assert.equal(result.skipped.duplicate, 1);
});

test("sales engine excludes suppressed contacts before research", async () => {
  let researched = false;
  const result = await runSalesEngine(deps({
    isSuppressed: async () => true,
    research: async () => { researched = true; throw new Error("must not research suppressed lead"); }
  }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.suppressed, 1);
  assert.equal(researched, false);
});

test("sales engine excludes invalid contacts", async () => {
  const result = await runSalesEngine(deps({ verifyContact: async () => ({ valid: false }) }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.invalid_contact, 1);
});

test("sales engine sends weak evidence to human review rather than queueing", async () => {
  const result = await runSalesEngine(deps({
    research: async () => ({
      evidence: [],
      score: 20,
      requiresHumanReview: true
    })
  }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.insufficient_evidence_or_draft, 1);
});

test("sales engine ingests only the prepared queue when explicitly not dry-run", async () => {
  let ingestedCount = 0;
  const result = await runSalesEngine(deps({
    discover: async () => [
      { company: "Example AS", email: "hello@example.no" },
      { company: "Suppressed AS", email: "no@example.no" }
    ],
    isSuppressed: async (email) => email === "no@example.no",
    ingest: async (leads) => { ingestedCount = leads.length; }
  }), { dryRun: false, maxLeads: 10 });
  assert.equal(result.queued, 1);
  assert.equal(ingestedCount, 1);
});

test("sales engine bounds max leads", async () => {
  await assert.rejects(() => runSalesEngine(deps(), { maxLeads: 101 }), /SALES_ENGINE_INVALID_MAX_LEADS/);
});
