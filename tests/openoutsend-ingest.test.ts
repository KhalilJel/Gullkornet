import assert from "node:assert/strict";
import test from "node:test";
import { createOpenOutSendIngestClient } from "../src/integrations/openoutsend-ingest.js";

const lead = { lead_id: "lead-1", email: "hello@example.no", company: "Example AS" };

test("OpenOutSend HTTP adapter posts NDJSON to ingest-only endpoint", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const client = createOpenOutSendIngestClient({
    baseUrl: "https://openoutsend.internal",
    token: "test-token",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ accepted: 1, mode: "ingest_only", send_triggered: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await client.ingestLeads([lead]);
  assert.equal(capturedUrl, "https://openoutsend.internal/v1/leads");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer test-token");
  assert.equal((capturedInit?.headers as Record<string, string>)["Content-Type"], "application/x-ndjson");
  assert.equal(capturedInit?.body, JSON.stringify(lead) + "\n");
  assert.equal(result.send_triggered, false);
});

test("OpenOutSend adapter fails closed when runtime credentials are missing", async () => {
  const client = createOpenOutSendIngestClient({ baseUrl: "", token: "" });
  await assert.rejects(() => client.ingestLeads([lead]), /OPENOUTREACH_INGEST_URL_NOT_CONFIGURED/);
  const clientWithoutToken = createOpenOutSendIngestClient({ baseUrl: "https://example.internal", token: "" });
  await assert.rejects(() => clientWithoutToken.ingestLeads([lead]), /OPENOUTREACH_INGEST_TOKEN_NOT_CONFIGURED/);
});

test("OpenOutSend adapter rejects invalid batches before network access", async () => {
  let called = false;
  const client = createOpenOutSendIngestClient({
    baseUrl: "https://example.internal",
    token: "test-token",
    fetchImpl: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }
  });
  await assert.rejects(() => client.ingestLeads([]), /OPENOUTSEND_INGEST_INVALID_BATCH_SIZE/);
  await assert.rejects(() => client.ingestLeads([{ lead_id: "", email: "hello@example.no" }]), /OPENOUTSEND_INGEST_LEAD_ID_REQUIRED/);
  await assert.rejects(() => client.ingestLeads([{ lead_id: "x", email: "invalid" }]), /OPENOUTSEND_INGEST_VALID_EMAIL_REQUIRED/);
  await assert.rejects(() => client.ingestLeads([lead, lead]), /OPENOUTSEND_INGEST_DUPLICATE_LEAD_ID/);
  assert.equal(called, false);
});

test("OpenOutSend adapter reports remote failures and unexpected acknowledgements", async () => {
  const failed = createOpenOutSendIngestClient({
    baseUrl: "https://example.internal",
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 })
  });
  await assert.rejects(() => failed.ingestLeads([lead]), /OPENOUTSEND_INGEST_HTTP_401/);

  const unexpected = createOpenOutSendIngestClient({
    baseUrl: "https://example.internal",
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ accepted: 0, mode: "ingest_only", send_triggered: false }), { status: 200 })
  });
  await assert.rejects(() => unexpected.ingestLeads([lead]), /OPENOUTSEND_INGEST_UNEXPECTED_RESPONSE/);
});
