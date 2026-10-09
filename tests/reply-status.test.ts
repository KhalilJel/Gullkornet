import assert from "node:assert/strict";
import test from "node:test";
import { assertRecipientHasNotReplied } from "../src/integrations/reply-status.js";

const env = {
  OPENOUTREACH_REPLY_STATUS_URL: "https://openoutreach-production-ab8b.up.railway.app/v1/reply-status",
  OPENOUTREACH_INGEST_TOKEN: "test-token"
};

test("reply-status check fails closed when URL or token is missing", async () => {
  await assert.rejects(assertRecipientHasNotReplied("pilot@example.no", {}), /URL and token are required/);
  await assert.rejects(
    assertRecipientHasNotReplied("pilot@example.no", { ...env, OPENOUTREACH_INGEST_TOKEN: "" }),
    /URL and token are required/
  );
});

test("reply-status check requires HTTPS and the exact endpoint path", async () => {
  await assert.rejects(
    assertRecipientHasNotReplied("pilot@example.no", { ...env, OPENOUTREACH_REPLY_STATUS_URL: "http://example.com/v1/reply-status" }),
    /must use HTTPS/
  );
  await assert.rejects(
    assertRecipientHasNotReplied("pilot@example.no", { ...env, OPENOUTREACH_REPLY_STATUS_URL: "https://example.com/health" }),
    /must use HTTPS/
  );
});

test("reply-status allows the send gate to continue only when no reply is found", async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({
      replied: false,
      mode: "read_only_reply_check",
      send_triggered: false
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await assert.doesNotReject(assertRecipientHasNotReplied("Pilot@Example.no", env));
    assert.equal(request?.method, "POST");
    assert.equal(request?.headers.get("authorization"), "Bearer test-token");
    assert.deepEqual(await request?.json(), { email: "pilot@example.no" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reply-status blocks a recipient who has replied", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    replied: true,
    mode: "read_only_reply_check",
    send_triggered: false
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    await assert.rejects(assertRecipientHasNotReplied("pilot@example.no", env), /Recipient has replied/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reply-status provider errors and malformed responses block sending", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    await assert.rejects(assertRecipientHasNotReplied("pilot@example.no", env), /failed with HTTP 503/);

    globalThis.fetch = (async () => new Response(JSON.stringify({
      replied: "no",
      mode: "read_only_reply_check",
      send_triggered: false
    }), { status: 200 })) as typeof fetch;
    await assert.rejects(assertRecipientHasNotReplied("pilot@example.no", env), /invalid reply-status response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
