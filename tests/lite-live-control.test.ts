import assert from "node:assert/strict";
import test from "node:test";
import { DRY_RUN_RECORDS, dryRunConfig, dryRunDeps } from "../src/lite/fixtures.js";
import { REFRESH_LEAD_MS, runLiteSend, SLOT_PLAN_MARGIN_MS } from "../src/lite/send.js";

const start = Date.parse("2026-10-20T09:00:00Z");
const slot = { kind: "daily" as const, startMs: start, endMs: start + 3600_000 };
const cfg = { ...dryRunConfig(), maxPerRun: 2 };

test("new delivery-health stop after the first acceptance prevents the next claim", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const fetch = run.deps.fetchLedger;
  run.deps.fetchLedger = async () => {
    if (run.outbox.length) throw new Error("Delivery-health stop: unknown bounce");
    return fetch();
  };
  await assert.rejects(runLiteSend(run.deps, cfg, { slot }), /unknown bounce/);
  assert.equal(run.outbox.length, 1);
  assert.equal(run.state.get(DRY_RUN_RECORDS[1].id)?.fields["Lead Status"], "Lite Ready");
});

test("reply check happens after pacing and fails closed on an outage", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  run.deps.assertNotReplied = async () => {
    if (run.outbox.length) {
      // The second send is due half-way through the planned part of the slot; the check runs just before it.
      assert.ok(run.deps.now() >= start + (3600_000 - SLOT_PLAN_MARGIN_MS) / 2 - REFRESH_LEAD_MS);
      throw new Error("HTTP 503");
    }
  };
  await assert.rejects(runLiteSend(run.deps, cfg, { slot }), /503/);
  assert.equal(run.outbox.length, 1);
});

test("reservation created during pacing prevents sending", async () => {
  const run = dryRunDeps(start, DRY_RUN_RECORDS.slice(0, 2));
  const sleep = run.deps.sleep;
  run.deps.sleep = async ms => {
    await sleep(ms);
    run.state.get(DRY_RUN_RECORDS[1].id)!.fields["Do Not Contact"] = true;
  };
  await runLiteSend(run.deps, cfg, { slot });
  assert.equal(run.outbox.length, 1);
});

test("external account sends during pacing consume capacity", async () => {
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
