import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySalesEngineFailure,
  salesEngineCompletedEvent,
  salesEngineFailedEvent,
  salesEngineStartedEvent
} from "../src/integrations/sales-engine-observability.js";
import type { SalesEngineResult } from "../src/integrations/sales-engine.js";

const result: SalesEngineResult = {
  discovered: 4,
  deduplicated: 3,
  researched: 2,
  qualified: 0,
  rejected: 1,
  rejectedLeads: [],
  queued: 0,
  reviewRequired: [{ lead: { company: "PRIVATE COMPANY", email: "private@example.com" }, reason: "review" }],
  skipped: { duplicate: 1, suppressed: 1 },
  dryRun: true
};

test("start and completion events contain safe counts and correlation ID only", () => {
  const started = salesEngineStartedEvent({ correlationId: "run-123", dryRun: true, maxLeads: 10 });
  const completed = salesEngineCompletedEvent({
    correlationId: "run-123",
    durationMs: 125,
    result,
    airtableReviewRecords: 1
  });
  const serialized = JSON.stringify({ started, completed });
  assert.equal(started.event, "sales_engine.started");
  assert.equal(completed.event, "sales_engine.completed");
  assert.equal(completed.discovered, 4);
  assert.equal(completed.emailSent, 0);
  assert.equal(serialized.includes("PRIVATE COMPANY"), false);
  assert.equal(serialized.includes("private@example.com"), false);
});

test("failure event emits stable category, never raw exception text", () => {
  const event = salesEngineFailedEvent({
    correlationId: "run-456",
    durationMs: 20,
    error: new Error("AIRTABLE_HTTP_503 private@example.com super-secret-token")
  });
  const serialized = JSON.stringify(event);
  assert.equal(event.failureCategory, "provider_unavailable");
  assert.equal(event.emailSent, 0);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("super-secret-token"), false);
  assert.equal(serialized.includes("AIRTABLE_HTTP_503"), false);
});

test("classifies operational failures into stable categories", () => {
  assert.equal(classifySalesEngineFailure(new Error("KEELEAD_TIMEOUT")), "timeout");
  assert.equal(classifySalesEngineFailure(new Error("AIRTABLE_API_TOKEN_NOT_CONFIGURED")), "configuration");
  assert.equal(classifySalesEngineFailure(new Error("AIRTABLE_REVIEW_QUEUE_SYNC_FAILED")), "persistence");
  assert.equal(classifySalesEngineFailure(new Error("SALES_ENGINE_INVALID_MAX_LEADS")), "validation");
  assert.equal(classifySalesEngineFailure(new Error("unexpected opaque failure")), "unknown");
});
