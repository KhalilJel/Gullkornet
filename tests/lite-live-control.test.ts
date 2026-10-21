import assert from "node:assert/strict";
import test from "node:test";
import { DRY_RUN_RECORDS, dryRunConfig, dryRunDeps } from "../src/lite/fixtures.js";
import { runLiteSend, sendWithinRateLimit } from "../src/lite/send.js";

const start = Date.parse("2026-10-20T09:00:00Z");
const slot = { kind: "daily" as const, startMs: start, endMs: start + 3600_000 };
const cfg = { ...dryRunConfig(), maxPerRun: 2 };

test("a new delivery-health stop (complaint, failure or rate) after the first acceptance prevents the next claim", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const fetch = run.deps.fetchLedger;
  run.deps.fetchLedger = async () => {
    if (run.outbox.length) throw new Error("Delivery-health stop: Spam complaint in the last 24 h.");
    return fetch();
  };
  await assert.rejects(runLiteSend(run.deps, cfg, { slot }), /complaint/);
  assert.equal(run.outbox.length, 1);
  assert.equal(run.state.get(DRY_RUN_RECORDS[1].id)?.fields["Lead Status"], "Lite Ready");
});

test("reply check runs right before each claim and fails closed on an outage", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  run.deps.assertNotReplied = async () => {
    if (run.outbox.length) throw new Error("HTTP 503");
  };
  await assert.rejects(runLiteSend(run.deps, cfg, { slot }), /503/);
  assert.equal(run.outbox.length, 1);
});

test("a reservation made after the queue was read prevents sending", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const send = run.deps.send;
  run.deps.send = async (email, key) => {
    const result = await send(email, key);
    run.state.get(DRY_RUN_RECORDS[1].id)!.fields["Do Not Contact"] = true;
    return result;
  };
  await runLiteSend(run.deps, cfg, { slot });
  assert.equal(run.outbox.length, 1);
});

test("external account sends during the run consume capacity", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const fetch = run.deps.fetchLedger;
  run.deps.fetchLedger = async () => [
    ...await fetch(),
    ...(run.outbox.length ? Array.from({ length: 99 }, (_, i) => ({
      created_at: new Date(run.deps.now() - 5000).toISOString(), to: [`post@external${i}.example`]
    })) : [])
  ];
  const result = await runLiteSend(run.deps, cfg, { slot });
  assert.equal(result.sent, 1);
  assert.equal(result.stoppedBy, "limit");
});

test("provider list lag cannot erase locally accepted sends", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  run.deps.fetchLedger = async () => [];
  const result = await runLiteSend(run.deps, { ...cfg, dailyLimit: 1 }, { slot });
  assert.equal(result.sent, 1);
});

test("Resend's rate limit (429) is waited out and the same request repeated; other 4xx are not retried", async () => {
  const email = { from: "a", to: "post@a.example", subject: "s", text: "t" };
  const keys: string[] = [];
  let slept = 0;
  let calls = 0;
  const limited = async (_: unknown, key: string) => {
    keys.push(key);
    if (++calls < 3) throw new Error("Resend send failed (HTTP 429).");
    return { id: "ok" };
  };
  assert.deepEqual(await sendWithinRateLimit(limited, async ms => { slept += ms; }, email, "k1"), { id: "ok" });
  assert.deepEqual(keys, ["k1", "k1", "k1"], "same idempotency key every time");
  assert.ok(slept > 0);
  let rejectedCalls = 0;
  await assert.rejects(sendWithinRateLimit(async () => { rejectedCalls++; throw new Error("Resend send failed (HTTP 422)."); }, async () => undefined, email, "k2"), /422/);
  assert.equal(rejectedCalls, 1);
});

test("a run sends its 95 back to back within the slot, never more than 95 per rolling 24 h", async () => {
  const records = Array.from({ length: 120 }, (_, i) => ({ id: `recFast${i}`, fields: { Email: `post@fast${i}.example`, "Lead Status": "Lite Ready",
    "Research Notes": `[GK-LITE] source=brreg orgnr=${900100000 + i} orgform=AS nace=12.345 kommune=9999` } }));
  const run = dryRunDeps(start, records);
  const result = await runLiteSend(run.deps, { ...dryRunConfig(), dailyLimit: 95, hourlyLimit: 95, maxPerRun: 95 }, { slot });
  assert.equal(result.sent, 95);
  const last = Date.parse(run.ledger[run.ledger.length - 1]!.created_at);
  assert.ok(last - start < 5 * 60_000, "no fixed spacing: 95 in minutes, not an hour");
});

test("Resend's own quota answer wins: the row goes back to the queue and the run stops cleanly", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const logs: string[] = [];
  run.deps.log = m => { logs.push(m); };
  const send = run.deps.send;
  run.deps.send = async (email, key) => {
    if (run.outbox.length >= 1) throw new Error("Resend send failed (HTTP 429 daily_quota_exceeded).");
    return send(email, key);
  };
  const result = await runLiteSend(run.deps, cfg, { slot });
  assert.equal(result.sent, 1);
  assert.equal(result.stoppedBy, "limit");
  assert.equal(run.state.get(DRY_RUN_RECORDS[1].id)?.fields["Lead Status"], "Lite Ready", "put back, nothing lost");
  assert.ok(logs.some(l => /Resend quota reached/.test(l)));
});

test("a quota 429 is not retried as a rate limit, a plain 429 is", async () => {
  const { isQuotaExceeded, isRateLimited, isDefiniteRejection } = await import("../src/lite/send.js");
  const quota = new Error("Resend send failed (HTTP 429 monthly_quota_exceeded).");
  const rate = new Error("Resend send failed (HTTP 429 rate_limit_exceeded).");
  const bare = new Error("Resend send failed (HTTP 429).");
  assert.ok(isQuotaExceeded(quota) && isDefiniteRejection(quota) && !isRateLimited(quota));
  assert.ok(isRateLimited(rate) && !isDefiniteRejection(rate));
  assert.ok(isRateLimited(bare) && !isDefiniteRejection(bare));
  assert.ok(isDefiniteRejection(new Error("Resend send failed (HTTP 422 validation_error).")));
});
