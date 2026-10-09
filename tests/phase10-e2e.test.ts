import assert from "node:assert/strict";
import test from "node:test";
import { runSalesEngine, type SalesEngineDependencies } from "../src/integrations/sales-engine.js";
import { createOpenOutSendIngestClient } from "../src/integrations/openoutsend-ingest.js";

function deps(overrides: Partial<SalesEngineDependencies> = {}): SalesEngineDependencies {
  return {
    discover: async () => [{ id: "lead-1", company: "Example AS", email: "hello@example.no" }],
    enrich: async (lead) => ({ location: "Oslo", industry: "professional services", identityVerified: true, ...lead }),
    verifyContact: async () => ({ valid: true }),
    research: async () => ({
      websiteUrl: "https://example.no/",
      evidence: ["Automated website signal (requires human verification): MISSING_META_DESCRIPTION"],
      score: 82,
      requiresHumanReview: false,
      draft: { subject: "En mulighet for Example AS", body: "Jeg la merke til en konkret forbedringsmulighet." }
    }),
    isSuppressed: async () => false,
    ingest: async () => undefined,
    ...overrides
  };
}

test("full orchestration completes in the required order", async () => {
  const events: string[] = [];
  const result = await runSalesEngine(deps({
    discover: async () => { events.push("discover"); return [{ company: "Example AS", email: "hello@example.no" }]; },
    enrich: async (lead) => { events.push("enrich"); return { location: "Oslo", industry: "professional services", identityVerified: true, ...lead }; },
    verifyContact: async () => { events.push("verify"); return { valid: true }; },
    isSuppressed: async () => { events.push("suppress"); return false; },
    research: async () => { events.push("research"); return {
      websiteUrl: "https://example.no/",
      evidence: ["Automated website signal (requires human verification): MISSING_META_DESCRIPTION"],
      score: 82,
      requiresHumanReview: false,
      draft: { subject: "Subject", body: "Body" }
    }; },
    ingest: async () => { events.push("ingest"); }
  }), { dryRun: false });

  assert.deepEqual(events, ["discover", "enrich", "verify", "suppress", "research", "ingest"]);
  assert.equal(result.queued, 1);
  assert.equal(result.reviewRequired.length, 0);
});

test("suppressed leads stop before website research and ingest", async () => {
  const events: string[] = [];
  const result = await runSalesEngine(deps({
    isSuppressed: async () => { events.push("suppress"); return true; },
    research: async () => { events.push("research"); throw new Error("must not research"); },
    ingest: async () => { events.push("ingest"); }
  }), { dryRun: false });

  assert.deepEqual(events, ["suppress"]);
  assert.equal(result.skipped.suppressed, 1);
  assert.equal(result.queued, 0);
});

test("provider failures fail closed and never reach ingest", async () => {
  let ingested = false;
  const result = await runSalesEngine(deps({
    verifyContact: async () => { throw new Error("provider timeout"); },
    ingest: async () => { ingested = true; }
  }), { dryRun: false });

  assert.equal(result.skipped.verification_failed, 1);
  assert.equal(result.queued, 0);
  assert.equal(ingested, false);
});

test("human review is a hard outbound gate", async () => {
  let ingested = false;
  const result = await runSalesEngine(deps({
    research: async () => ({
      evidence: ["Automated website signal (requires human verification): MISSING_META_DESCRIPTION"],
      score: 91,
      requiresHumanReview: true,
      draft: { subject: "Subject", body: "Body" }
    }),
    ingest: async () => { ingested = true; }
  }), { dryRun: false });

  assert.equal(result.reviewRequired.length, 1);
  assert.equal(result.queued, 0);
  assert.equal(ingested, false);
});

test("duplicate discovery records collapse to one logical lead", async () => {
  let ingestedCount = 0;
  const result = await runSalesEngine(deps({
    discover: async () => [
      { id: "a", company: "Example AS", email: "HELLO@example.no" },
      { id: "b", company: "Other AS", email: "hello@example.no" },
      { id: "c", company: "  EXAMPLE   AS ", email: "other@example.no" }
    ],
    ingest: async (leads) => { ingestedCount = leads.length; }
  }), { dryRun: false });

  assert.equal(result.deduplicated, 1);
  assert.equal(result.skipped.duplicate, 2);
  assert.equal(ingestedCount, 1);
});

test("dry run is non-mutating at the outreach boundary", async () => {
  let ingested = false;
  const result = await runSalesEngine(deps({
    ingest: async () => { ingested = true; }
  }), { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.queued, 1);
  assert.equal(ingested, false);
});

test("OpenOutSend adapter rejects any acknowledgement that claims a send", async () => {
  const client = createOpenOutSendIngestClient({
    baseUrl: "https://example.internal",
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({
      accepted: 1,
      mode: "ingest_only",
      send_triggered: true
    }), { status: 200 })
  });

  await assert.rejects(() => client.ingestLeads([
    { lead_id: "lead-1", email: "hello@example.no", company: "Example AS" }
  ]), /OPENOUTSEND_INGEST_UNEXPECTED_RESPONSE/);
});

test("OpenOutSend adapter converts transport timeout into a stable failure", async () => {
  const client = createOpenOutSendIngestClient({
    baseUrl: "https://example.internal",
    token: "test-token",
    timeoutMs: 5,
    fetchImpl: async (_input, init) => {
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
      throw new Error("unreachable");
    }
  });

  await assert.rejects(() => client.ingestLeads([
    { lead_id: "lead-1", email: "hello@example.no", company: "Example AS" }
  ]), /OPENOUTSEND_INGEST_TIMEOUT/);
});

test("OpenOutSend adapter never contacts the network for invalid batches", async () => {
  let called = false;
  const client = createOpenOutSendIngestClient({
    baseUrl: "https://example.internal",
    token: "test-token",
    fetchImpl: async () => { called = true; return new Response("{}", { status: 200 }); }
  });

  await assert.rejects(() => client.ingestLeads([
    { lead_id: "lead-1", email: "invalid", company: "Example AS" }
  ]), /OPENOUTSEND_INGEST_VALID_EMAIL_REQUIRED/);

  assert.equal(called, false);
});

test("failed outbound handoff is surfaced instead of being swallowed", async () => {
  await assert.rejects(
    () => runSalesEngine(deps({
      ingest: async () => { throw new Error("OPENOUTREACH_DOWN"); }
    }), { dryRun: false }),
    /OPENOUTREACH_DOWN/
  );
});
