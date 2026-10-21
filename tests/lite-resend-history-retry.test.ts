import assert from "node:assert/strict";
import test from "node:test";
import { fetchResendEmailsSince, RESEND_READ_PAUSES_MS } from "../src/lite/delivery-check.js";
import { DRY_RUN_RECORDS, dryRunConfig, dryRunDeps } from "../src/lite/fixtures.js";
import { runLiteSend, withTransientRetry } from "../src/lite/send.js";

const page = (entries: Array<{ id: string; created_at: string; to?: string[] }>) => new Response(JSON.stringify({ data: entries, has_more: false }));
const networkError = () => new TypeError("fetch failed");

test("the Resend history read retries a network error and a 5xx with increasing pauses, then uses the fresh answer", async () => {
  assert.ok(RESEND_READ_PAUSES_MS.every((p, i) => i === 0 || p > RESEND_READ_PAUSES_MS[i - 1]!), "increasing pauses");
  let calls = 0;
  const flaky = (async () => {
    calls++;
    if (calls === 1) throw networkError();
    if (calls === 2) return new Response("", { status: 503 });
    return page([{ id: "e1", created_at: "2026-10-21T14:00:00Z", to: ["post@a.example"] }]);
  }) as unknown as typeof fetch;
  const history = await fetchResendEmailsSince("key", Date.parse("2026-10-21T00:00:00Z"), flaky, 30, [1, 1, 1]);
  assert.equal(calls, 3);
  assert.deepEqual(history.map(e => e.id), ["e1"]);
});

test("a lasting failure still throws after the bounded retries (nothing decided on missing history)", async () => {
  let calls = 0;
  const down = (async () => { calls++; throw networkError(); }) as unknown as typeof fetch;
  await assert.rejects(fetchResendEmailsSince("key", 0, down, 30, [1, 1, 1]), /fetch failed/);
  assert.equal(calls, 4, "first try plus three retries");
});

test("after a recovered history read, quota and duplicate checks use the fresh data; a lasting outage stops with the accepted count", async () => {
  const start = Date.parse("2026-10-21T09:00:00Z");
  const slot = { kind: "daily" as const, startMs: start, endMs: start + 3_600_000 };
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const logs: string[] = [];
  run.deps.log = m => { logs.push(m); };
  // Every history read fails once (network), then answers with the ledger plus 94 external sends
  // that appeared meanwhile: the fresh count leaves room for only one Lite send.
  let reads = 0;
  run.deps.fetchLedger = () => fetchResendEmailsSince("key", start - 86_400_000, (async () => {
    reads++;
    if (reads % 2 === 1) throw networkError();
    const external = Array.from({ length: 94 }, (_, i) => ({ id: `x${i}`, created_at: new Date(start - 60_000).toISOString(), to: [`post@ext${i}.example`] }));
    return page([...run.ledger.map((e, i) => ({ id: `l${i}`, ...e })), ...external]);
  }) as unknown as typeof fetch, 30, [1]);
  const summary = await runLiteSend(run.deps, { ...dryRunConfig(), dailyLimit: 95, hourlyLimit: 95 }, { slot });
  assert.equal(summary.sent, 1, "95 - 94 external = 1");
  assert.equal(summary.stoppedBy, "limit");

  const broken = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const brokenLogs: string[] = [];
  broken.deps.log = m => { brokenLogs.push(m); };
  let ok = true;
  broken.deps.fetchLedger = () => fetchResendEmailsSince("key", 0, (async () => {
    if (ok) return page([]);
    throw networkError();
  }) as unknown as typeof fetch, 30, [1, 1]);
  const send = broken.deps.send;
  broken.deps.send = async (email, key) => { const r = await send(email, key); ok = false; return r; };
  await assert.rejects(runLiteSend(broken.deps, dryRunConfig(), { slot }), /fetch failed/);
  assert.equal(broken.outbox.length, 1);
  assert.ok(brokenLogs.some(l => /^Run stopped after 1 accepted: fetch failed/.test(l)), brokenLogs.join("\n"));
});

test("the reply check retries a network error as well as a 503", async () => {
  let calls = 0;
  const result = await withTransientRetry(async () => { if (++calls === 1) throw networkError(); return "ok"; }, async () => undefined);
  assert.equal(result, "ok");
  await assert.rejects(withTransientRetry(async () => { throw new Error("HTTP 401"); }, async () => undefined), /401/);
});
