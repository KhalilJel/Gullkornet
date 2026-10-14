import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { negativeControlAddress, replyStatusOf, runReplyStatusCheck } from "../src/integrations/reply-status-check.js";

const env = { OPENOUTREACH_REPLY_STATUS_URL: "https://reply.example/v1/reply-status", OPENOUTREACH_REPLY_STATUS_TOKEN: "token" };

function withFetch(handler: (body: { email: string }) => Response, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => handler(JSON.parse(String(init?.body)))) as typeof fetch;
  return run().finally(() => { globalThis.fetch = original; });
}

const ok = (replied: boolean) => new Response(JSON.stringify({ replied, mode: "read_only_reply_check", send_triggered: false }), { status: 200 });

test("reply-status check maps replied, not replied, outage and missing config", async () => {
  await withFetch(() => ok(true), async () => assert.equal(await replyStatusOf("a@b.no", env), "replied=true"));
  await withFetch(() => ok(false), async () => assert.equal(await replyStatusOf("a@b.no", env), "replied=false"));
  await withFetch(() => new Response("{}", { status: 503 }), async () => assert.equal(await replyStatusOf("a@b.no", env), "error"));
  await withFetch(() => new Response(JSON.stringify({ replied: false }), { status: 200 }), async () => assert.equal(await replyStatusOf("a@b.no", env), "error"));
  assert.equal(await replyStatusOf("a@b.no", {}), "error");
});

test("negative control is a fresh address under the reserved .invalid TLD", () => {
  const a = negativeControlAddress();
  assert.match(a, /^gullkornet-negative-[0-9a-f]{12}@negative-control\.invalid$/);
  assert.notEqual(a, negativeControlAddress());
});

test("check passes only when the test sender replied and the negative control did not", async () => {
  const seen: string[] = [];
  const check = (replies: boolean) => async (recipient: string) => {
    seen.push(recipient);
    return recipient.endsWith(".invalid") ? "replied=false" as const : replies ? "replied=true" as const : "replied=false" as const;
  };
  assert.deepEqual(await runReplyStatusCheck("tester@example.org", check(true)), { positive: "replied=true", negative: "replied=false", pass: true });
  assert.equal((await runReplyStatusCheck("tester@example.org", check(false))).pass, false);
  assert.equal(seen[0], "tester@example.org");
  const missing = await runReplyStatusCheck("  ", check(true));
  assert.equal(missing.positive, "error");
  assert.equal(missing.pass, false);
  assert.equal((await runReplyStatusCheck("tester@example.org", async () => "error")).pass, false);
});

test("reply-status workflow is manual-only, read-only and has no sending or CRM access", async () => {
  const workflow = (await readFile(new URL("../.github/workflows/reply-status-check.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(workflow, /^on:\n  workflow_dispatch:\n\n/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|pull_request_target|schedule|workflow_run):/m);
  assert.match(workflow, /^permissions:\n  contents: read\n\n/m);
  assert.doesNotMatch(workflow, /RESEND_|AIRTABLE_|MIGADU_|ENABLE_LIVE_SEND|send:|secrets: inherit/);
  assert.doesNotMatch(workflow, /@(?!cideamarketing\.com)[a-z0-9-]+\.[a-z]{2,}/i);
  assert.match(workflow, /npm run --silent check:reply-status/);
});
