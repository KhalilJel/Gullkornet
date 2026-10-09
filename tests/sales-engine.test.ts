import assert from "node:assert/strict";
import test from "node:test";
import { runSalesEngine, type SalesEngineDependencies } from "../src/integrations/sales-engine.js";

function deps(overrides: Partial<SalesEngineDependencies> = {}): SalesEngineDependencies {
  return {
    discover: async () => [{ company: "Example AS", email: "hello@example.no" }],
    enrich: async (lead) => ({ location: "Oslo", industry: "professional services", identityVerified: true, ...lead }),
    verifyContact: async () => ({ valid: true }),
    research: async () => ({
      websiteUrl: "https://example.no",
      evidence: ["Automated website signal (requires human verification): MISSING_META_DESCRIPTION"],
      score: 80,
      requiresHumanReview: false,
      draft: { subject: "En mulighet for Example AS", body: "Jeg la merke til at ..." }
    }),
    isSuppressed: async () => false,
    ingest: async () => undefined,
    ...overrides
  };
}

test("dry run prepares a grounded queue without ingesting", async () => {
  let ingested = false;
  const result = await runSalesEngine(deps({ ingest: async () => { ingested = true; } }));
  assert.equal(result.discovered, 1);
  assert.equal(result.queued, 1);
  assert.equal(result.dryRun, true);
  assert.equal(ingested, false);
});

test("deduplicates email addresses case-insensitively", async () => {
  const result = await runSalesEngine(deps({
    discover: async () => [
      { company: "Example AS", email: "hello@example.no" },
      { company: "Other AS", email: "HELLO@example.no" }
    ]
  }));
  assert.equal(result.deduplicated, 1);
  assert.equal(result.skipped.duplicate, 1);
});

test("deduplicates repeated companies even when email differs", async () => {
  const result = await runSalesEngine(deps({
    discover: async () => [
      { company: "Example AS", email: "one@example.no" },
      { company: "  EXAMPLE   AS ", email: "two@example.no" }
    ]
  }));
  assert.equal(result.deduplicated, 1);
  assert.equal(result.skipped.duplicate, 1);
});

test("skips leads without any identity", async () => {
  const result = await runSalesEngine(deps({ discover: async () => [{ website: "https://example.no" }] }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.missing_identity, 1);
});

test("skips a lead without email after enrichment", async () => {
  const result = await runSalesEngine(deps({ enrich: async (lead) => ({ ...lead, email: "" }) }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.missing_email, 1);
});

test("skips malformed email addresses before verification", async () => {
  let verified = false;
  const result = await runSalesEngine(deps({
    discover: async () => [{ company: "Example AS", email: "not-an-email" }],
    verifyContact: async () => { verified = true; return { valid: true }; }
  }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.invalid_email_format, 1);
  assert.equal(verified, false);
});

test("skips contacts rejected by verification", async () => {
  const result = await runSalesEngine(deps({ verifyContact: async () => ({ valid: false }) }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.invalid_contact, 1);
});

test("fails closed when contact verification throws", async () => {
  const result = await runSalesEngine(deps({ verifyContact: async () => { throw new Error("provider unavailable"); } }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.verification_failed, 1);
});

test("checks suppression before research", async () => {
  let researched = false;
  const result = await runSalesEngine(deps({
    isSuppressed: async () => true,
    research: async () => { researched = true; throw new Error("must not research suppressed lead"); }
  }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.suppressed, 1);
  assert.equal(researched, false);
});

test("fails closed when suppression lookup fails", async () => {
  const result = await runSalesEngine(deps({ isSuppressed: async () => { throw new Error("lookup failed"); } }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.suppression_check_failed, 1);
});

test("routes weak evidence to human review", async () => {
  const result = await runSalesEngine(deps({
    research: async () => ({ evidence: [], score: 20, requiresHumanReview: true })
  }));
  assert.equal(result.queued, 0);
  assert.equal(result.reviewRequired.length, 1);
  assert.equal(result.reviewRequired[0]?.reason, "human_review_required");
  assert.equal(result.skipped.human_review_required, 1);
});

test("rejects invalid scores even when evidence and draft exist", async () => {
  const result = await runSalesEngine(deps({
    research: async () => ({
      evidence: ["A sufficiently specific observed website signal."],
      score: 120,
      requiresHumanReview: false,
      draft: { subject: "Subject", body: "Body" }
    })
  }));
  assert.equal(result.queued, 0);
  assert.equal(result.skipped.insufficient_evidence_or_draft, 1);
});

test("ingests only the eligible queue when dry-run is explicitly disabled", async () => {
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

test("surfaces ingestion failure for retry/monitoring", async () => {
  await assert.rejects(
    () => runSalesEngine(deps({ ingest: async () => { throw new Error("OPENOUTREACH_DOWN"); } }), { dryRun: false }),
    /OPENOUTREACH_DOWN/
  );
});

test("bounds max leads", async () => {
  await assert.rejects(() => runSalesEngine(deps(), { maxLeads: 101 }), /SALES_ENGINE_INVALID_MAX_LEADS/);
});

test("deduplicates website domains after normalizing www, case, and URL paths", async () => {
  const result = await runSalesEngine(deps({
    discover: async () => [
      { company: "Example AS", email: "one@example.no", website: "https://www.Example.no/" },
      { company: "Example Services AS", email: "two@example.no", website: "http://example.no/about-us" }
    ]
  }));
  assert.equal(result.deduplicated, 1);
  assert.equal(result.skipped.duplicate, 1);
});

test("does not use malformed or non-HTTP website values as domain identity", async () => {
  const result = await runSalesEngine(deps({
    discover: async () => [
      { company: "First AS", email: "one@first.no", website: "mailto:hello@first.no" },
      { company: "Second AS", email: "two@second.no", website: "not a valid url ://" }
    ]
  }));
  assert.equal(result.deduplicated, 2);
  assert.equal(result.queued, 2);
});
