import assert from "node:assert/strict";
import test from "node:test";
import { dryRunDeps } from "../src/lite/fixtures.js";
import { dailyLiteSlot, loadLiteSendConfig, resolveLiteSlot, type LiteSlot } from "../src/lite/schedule.js";
import { runLiteSend, type LiteQueueRecord } from "../src/lite/send.js";
import type { SendLedgerEntry } from "../src/integrations/outbound-email.js";

const cfg = loadLiteSendConfig({ RESEND_DAILY_QUOTA: "100", RESEND_MONTHLY_QUOTA: "3000" });
const record = (i: number): LiteQueueRecord => ({
  id: `recSlot${String(i).padStart(4, "0")}`,
  fields: { Email: `post@slot${i}.example`, "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] source=brreg orgnr=900000001 orgform=AS nace=96.021 kommune=0301" }
});
const records = (n: number) => Array.from({ length: n }, (_, i) => record(i));
const sentAt = (ms: number, i: number): SendLedgerEntry => ({ created_at: new Date(ms).toISOString(), to: [`earlier${i}@x.example`] });

test("cron triggers: summer and winter both reach 11:00 Oslo; the other triggers no-op", () => {
  const triggers = ["08:35", "08:50", "09:35", "09:50", "10:05"];
  const resolve = (day: string) => triggers.map(t => resolveLiteSlot(Date.parse(`${day}T${t}:00Z`), cfg));
  // Tuesday 20 October 2026: CEST, UTC+2.
  const summer = resolve("2026-10-20");
  assert.deepEqual(summer.map(s => s !== undefined), [true, true, true, true, false]);
  assert.ok(summer.every(s => s === undefined || s.startMs === Date.parse("2026-10-20T09:00:00Z")));
  // Monday 2 November 2026: CET, UTC+1.
  const winter = resolve("2026-11-02");
  assert.deepEqual(winter.map(s => s !== undefined), [false, false, true, true, true]);
  assert.ok(winter.every(s => s === undefined || s.startMs === Date.parse("2026-11-02T10:00:00Z")));
  // The changeover days themselves.
  assert.equal(dailyLiteSlot(Date.parse("2026-10-25T09:40:00Z"), cfg).startMs, Date.parse("2026-10-25T10:00:00Z"), "first CET day");
  assert.equal(dailyLiteSlot(Date.parse("2026-03-29T08:40:00Z"), cfg).startMs, Date.parse("2026-03-29T09:00:00Z"), "first CEST day");
  assert.equal(dailyLiteSlot(Date.parse("2026-10-20T09:59:59.500Z"), cfg).endMs, Date.parse("2026-10-20T10:00:00Z"));
});

test("a manual one-off starts at once at any time of day: \"now\" or today's Oslo date", () => {
  const now = Date.parse("2026-10-19T15:30:00Z"); // 17:30 Oslo
  const bound = 90 * 60_000; // only the manual job timeout, not a time-of-day rule
  assert.deepEqual(resolveLiteSlot(now, cfg, "2026-10-19"), { kind: "one_off", startMs: now, endMs: now + bound });
  assert.deepEqual(resolveLiteSlot(now, cfg, "now"), { kind: "one_off", startMs: now, endMs: now + bound });
  const night = Date.parse("2026-10-19T01:30:00Z"); // 03:30 Oslo
  assert.equal(resolveLiteSlot(night, cfg, "now")?.startMs, night, "no time-of-day restriction");
  assert.throws(() => resolveLiteSlot(now, cfg, "2026-10-18"), /not today/);
  assert.throws(() => resolveLiteSlot(Date.parse("2026-10-19T22:30:00Z"), cfg, "2026-10-19"), /not today/, "00:30 Oslo is the next day");
  assert.throws(() => resolveLiteSlot(now, cfg, "19.10.2026"), /YYYY-MM-DD or "now"/);
  assert.equal(resolveLiteSlot(now, cfg), undefined, "without the one-off, 17:30 is no slot");
});

function spread(ledger: SendLedgerEntry[], slot: LiteSlot) {
  const times = ledger.map(e => Date.parse(e.created_at)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return { times, minGap: Math.min(...gaps), maxGap: Math.max(...gaps), inside: times.every(t => t >= slot.startMs && t < slot.endMs) };
}

test("a scheduled run waits for 11:00 and sends its 95 at once, without a fixed spacing", async () => {
  const start = Date.parse("2026-10-20T08:35:00Z"); // 10:35 Oslo
  const slot = resolveLiteSlot(start, cfg)!;
  const run = dryRunDeps(start, records(150));
  const summary = await runLiteSend(run.deps, cfg, { slot });
  assert.equal(summary.sent, 95);
  assert.equal(summary.target, 95);
  const s = spread(run.ledger, slot);
  assert.ok(s.inside, "every send inside 11:00-12:00 Oslo");
  assert.equal(s.times[0], slot.startMs, "first send at 11:00");
  assert.ok(s.minGap < 30_000, `no 30 s spacing (min gap ${s.minGap} ms)`);
  assert.ok(s.times[94] - slot.startMs < 5 * 60_000, "95 within minutes");
  assert.equal(new Set(run.outbox.map(o => o.email.to)).size, 95, "no address twice");
});

test("sends earlier the same Oslo day are subtracted from the day's goal, not added on top", async () => {
  const start = Date.parse("2026-10-20T09:00:00Z");
  const slot = resolveLiteSlot(start, cfg)!;
  const run = dryRunDeps(start, records(150));
  const earlier = Array.from({ length: 12 }, (_, i) => sentAt(start - (5 * 60 + i) * 60_000, i));
  run.deps.fetchLedger = async () => [...earlier];
  const summary = await runLiteSend(run.deps, cfg, { slot });
  assert.equal(summary.target, 83);
  assert.equal(summary.sent, 83);
  assert.equal(summary.stoppedBy, "limit");
});

test("calendar day: a full one-off at 17:30 does not reduce the next day's 11:00 slot", async () => {
  const oneOffStart = Date.parse("2026-10-19T15:30:00Z"); // 17:30 Oslo
  const run = dryRunDeps(oneOffStart, records(250));
  const earlier = [sentAt(Date.parse("2026-10-19T11:41:00Z"), 0), sentAt(Date.parse("2026-10-19T11:42:00Z"), 1)];
  run.deps.fetchLedger = async () => [...earlier, ...run.ledger];
  const oneOff = resolveLiteSlot(oneOffStart, cfg, "2026-10-19")!;
  const first = await runLiteSend(run.deps, cfg, { slot: oneOff });
  assert.equal(first.target, 93, "95 minus the 2 sent at 13:41 the same day");
  assert.equal(first.sent, 93);

  run.advance(Date.parse("2026-10-20T08:35:00Z") - run.deps.now());
  const next = await runLiteSend(run.deps, cfg, { slot: resolveLiteSlot(run.deps.now(), cfg)! });
  assert.equal(next.target, 95, "yesterday's sends are not subtracted");
  assert.equal(next.sent, 95);
  assertDailyLimits([...earlier, ...run.ledger]);
});

test("22.10.2026: after 5 + 90 sends on 21.10 the 11:00 slot targets the full 95", async () => {
  const day21 = [
    ...Array.from({ length: 5 }, (_, i) => sentAt(Date.parse("2026-10-21T00:03:37Z") + i * 63_000, i)),
    ...Array.from({ length: 90 }, (_, i) => sentAt(Date.parse("2026-10-21T13:58:38Z") + i * 25_000, 100 + i))
  ];
  const start = Date.parse("2026-10-22T08:40:00Z"); // clock dispatch 10:40 Oslo
  const run = dryRunDeps(start, records(150));
  run.deps.fetchLedger = async () => [...day21, ...run.ledger];
  const summary = await runLiteSend(run.deps, cfg, { slot: resolveLiteSlot(start, cfg)! });
  assert.equal(summary.target, 95);
  assert.equal(summary.sent, 95);
  assert.ok(run.ledger.every(e => Date.parse(e.created_at) >= Date.parse("2026-10-22T09:00:00Z")), "waits for 11:00 Oslo");
  assertDailyLimits([...day21, ...run.ledger]);
});

test("Resend's quotas in their own periods: UTC day and UTC month cap the day's goal", async () => {
  const start = Date.parse("2026-10-22T09:00:00Z");
  // 30 sent at 01:30 Oslo on 22.10 = 23:30 UTC on 21.10: they count for Oslo 22.10, not for UTC 22.10.
  const late = Array.from({ length: 30 }, (_, i) => sentAt(Date.parse("2026-10-21T23:30:00Z") + i * 1000, i));
  const quota = loadLiteSendConfig({ RESEND_DAILY_QUOTA: "100", RESEND_MONTHLY_QUOTA: "3000" });
  const run = dryRunDeps(start, records(150));
  run.deps.fetchLedger = async () => [...late, ...run.ledger];
  assert.equal((await runLiteSend(run.deps, quota, { slot: resolveLiteSlot(start, quota)! })).target, 65, "95 - 30 sent earlier the same Oslo day");
  // A month nearly used up: 2980 in October (UTC) leaves 20.
  const month = Array.from({ length: 2980 }, (_, i) => sentAt(Date.parse("2026-10-01T00:00:00Z") + i * 60_000, i));
  const monthRun = dryRunDeps(start, records(150));
  monthRun.deps.fetchLedger = async () => [...month, ...monthRun.ledger];
  const capped = await runLiteSend(monthRun.deps, quota, { slot: resolveLiteSlot(start, quota)! });
  assert.equal(capped.target, 20);
  assert.equal(capped.sent, 20);
});

test("slow checks cost sends, never the window", async () => {
  const start = Date.parse("2026-10-20T09:00:00Z");
  const slot = resolveLiteSlot(start, cfg)!;
  const run = dryRunDeps(start, records(150));
  run.deps.checkFreshness = async () => { run.advance(70_000); return undefined; };
  const summary = await runLiteSend(run.deps, cfg, { slot });
  assert.ok(summary.sent > 40 && summary.sent < 95, `sent ${summary.sent}`);
  assert.equal(summary.stoppedBy, "outside_window");
  const s = spread(run.ledger, slot);
  assert.ok(s.inside);
});

test("a later trigger in the same slot continues the plan and never exceeds the daily limit", async () => {
  const start = Date.parse("2026-10-20T09:00:00Z");
  const slot = resolveLiteSlot(start, cfg)!;
  const run = dryRunDeps(start, records(60));
  run.deps.fetchLedger = async () => [...run.ledger];
  const first = await runLiteSend(run.deps, cfg, { slot });
  assert.equal(first.sent, 60);
  assert.equal(first.stoppedBy, "queue_empty");
  const later = dryRunDeps(run.deps.now(), records(200));
  later.deps.fetchLedger = async () => [...run.ledger, ...later.ledger];
  const second = await runLiteSend(later.deps, cfg, { slot: resolveLiteSlot(later.deps.now(), cfg)! });
  assert.equal(second.target, 35);
  assert.ok(second.sent <= 35);
  assert.ok(run.ledger.length + later.ledger.length <= 95);
});

// ---------- Steady daily operation (20.10.2026 onwards) ----------
import { DeliveryStopError } from "../src/lite/delivery-health.js";
import { MAX_SCHEDULED_LEAD_MS } from "../src/lite/schedule.js";

/** At most 95 per Oslo calendar day (our goal) and 100 per UTC day (Resend's daily quota). */
function assertDailyLimits(all: SendLedgerEntry[], goal = 95, quota = 100) {
  const byOslo = new Map<string, number>();
  const byUtc = new Map<string, number>();
  for (const e of all) {
    const ts = Date.parse(e.created_at);
    const oslo = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo" }).format(ts);
    byOslo.set(oslo, (byOslo.get(oslo) ?? 0) + 1);
    byUtc.set(e.created_at.slice(0, 10), (byUtc.get(e.created_at.slice(0, 10)) ?? 0) + 1);
  }
  for (const [d, n] of byOslo) assert.ok(n <= goal, `${n} on Oslo day ${d}`);
  for (const [d, n] of byUtc) assert.ok(n <= quota, `${n} on UTC day ${d}`);
}

test("calendar days: 42 sent 20.10 at 13:45 Oslo do not reduce 21.10; a full 95 every day", async () => {
  const one = Array.from({ length: 42 }, (_, i) => sentAt(Date.parse("2026-10-20T11:45:35Z") + i * 37_900, i));
  const run = dryRunDeps(Date.parse("2026-10-21T08:40:00Z"), records(400));
  run.deps.fetchLedger = async () => [...one, ...run.ledger];
  const results: number[] = [];
  for (const day of ["2026-10-21", "2026-10-22", "2026-10-23"]) {
    run.advance(Date.parse(`${day}T08:40:00Z`) - run.deps.now());
    const slot = resolveLiteSlot(run.deps.now(), cfg)!;
    const before = run.ledger.length;
    const summary = await runLiteSend(run.deps, cfg, { slot });
    results.push(run.ledger.length - before);
    assert.ok(run.ledger.slice(before).every(e => Date.parse(e.created_at) >= slot.startMs && Date.parse(e.created_at) < slot.endMs));
    assert.equal(summary.target, 95);
  }
  assert.deepEqual(results, [95, 95, 95]);
  assertDailyLimits([...one, ...run.ledger]);
  assert.equal(new Set(run.outbox.map(o => o.email.to)).size, run.outbox.length, "no address twice");
});

test("yesterday's 95 never hold back today's run, whatever time they were sent", async () => {
  const yesterday = Array.from({ length: 95 }, (_, i) => sentAt(Date.parse("2026-10-21T09:05:00Z") + i * 34_000, i));
  const start = Date.parse("2026-10-22T09:00:00Z");
  const run = dryRunDeps(start, records(150));
  run.deps.fetchLedger = async () => [...yesterday, ...run.ledger];
  const summary = await runLiteSend(run.deps, cfg, { slot: resolveLiteSlot(start, cfg)! });
  assert.equal(summary.target, 95);
  assert.equal(summary.sent, 95);
  assert.ok(Date.parse(run.ledger[94]!.created_at) - start < 5 * 60_000, "no waiting for roll-outs");
  assertDailyLimits([...yesterday, ...run.ledger]);
});

test("a delivery-health stop that lifts inside the slot is waited out; one that outlasts it stops the run", async () => {
  const start = Date.parse("2026-10-21T09:00:00Z");
  const slot = resolveLiteSlot(start, cfg)!;
  const lifts = start + 20 * 60_000;
  const run = dryRunDeps(start, records(150));
  run.deps.fetchLedger = async () => {
    if (run.deps.now() < lifts) throw new DeliveryStopError("Delivery-health stop: Spam complaint in the last 24 h.", lifts);
    return [...run.ledger];
  };
  const summary = await runLiteSend(run.deps, cfg, { slot });
  assert.ok(run.ledger.every(e => Date.parse(e.created_at) > lifts), "nothing sent while the stop held");
  assert.equal(summary.target, 95);
  assert.equal(summary.sent, 95, "the rest of the slot is plenty without a fixed spacing");

  const late = dryRunDeps(start, records(10));
  late.deps.fetchLedger = async () => { throw new DeliveryStopError("Delivery-health stop: complaint.", slot.endMs + 3_600_000); };
  await assert.rejects(runLiteSend(late.deps, cfg, { slot }), /complaint/);
  const unknown = dryRunDeps(start, records(10));
  unknown.deps.fetchLedger = async () => { throw new DeliveryStopError("Delivery-health stop: rate.", undefined); };
  await assert.rejects(runLiteSend(unknown.deps, cfg, { slot }), /rate/);
  assert.equal(late.outbox.length + unknown.outbox.length, 0);
});

test("scheduled runs may arrive up to 285 minutes early and wait; later or earlier arrivals no-op", () => {
  const lead = MAX_SCHEDULED_LEAD_MS;
  assert.ok(resolveLiteSlot(Date.parse("2026-10-21T04:16:00Z"), cfg, undefined, lead), "06:16 Oslo CEST waits");
  assert.equal(resolveLiteSlot(Date.parse("2026-10-21T04:14:00Z"), cfg, undefined, lead), undefined);
  assert.ok(resolveLiteSlot(Date.parse("2026-10-26T05:16:00Z"), cfg, undefined, lead), "06:16 Oslo CET waits");
  assert.equal(resolveLiteSlot(Date.parse("2026-10-26T11:00:00Z"), cfg, undefined, lead), undefined, "12:00 Oslo CET is too late");
  assert.equal(resolveLiteSlot(Date.parse("2026-10-21T04:16:00Z"), cfg), undefined, "manual runs keep the 30-minute lead");
});

test("14 simulated days with varying start (0-25 min late) and check times: 95 every Oslo day, within the daily quota", async () => {
  // Deterministic pseudo-random sequence (seeded), so the test is repeatable.
  let seed = 20261021;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const run = dryRunDeps(Date.parse("2026-10-21T08:30:00Z"), records(1500));
  run.deps.fetchLedger = async () => [...run.ledger];
  // Gate and reply time per prospective send varies between 1 and 30 s, now and then 55 s.
  run.deps.checkFreshness = async () => { run.advance(1_000 + Math.floor(rand() * (rand() < 0.05 ? 55_000 : 29_000))); return undefined; };
  const perDay: number[] = [];
  for (let d = 0; d < 14; d++) {
    const day = new Date(Date.parse("2026-11-02T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10); // CET: slot 10-11 UTC
    const lateMs = d === 4 ? 25 * 60_000 : Math.floor(rand() * 4 * 60_000); // day 5: reserve start at 11:25
    run.advance(Date.parse(`${day}T10:00:00Z`) + lateMs - run.deps.now());
    const slot = resolveLiteSlot(run.deps.now(), cfg)!;
    const before = run.ledger.length;
    await runLiteSend(run.deps, cfg, { slot });
    perDay.push(run.ledger.length - before);
  }
  assertDailyLimits(run.ledger);
  // Without a fixed spacing even the day that starts 25 minutes late reaches 95.
  assert.deepEqual(perDay, Array(14).fill(95), perDay.join(","));
});

test("30 simulated days with gate times as measured in production: 95 every day, late starts included", async () => {
  // Measured 20 Oct 2026 (readiness run 39476610873): Brreg max 0.6 s, DNS max 0.9 s, Airtable 0.2 s.
  // Modelled generously as 0.5-7.5 s per record, 3 % of records 20 s; start 0-4 min late; two days 25 min late.
  let seed = 20261021;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const run = dryRunDeps(Date.parse("2026-11-01T08:30:00Z"), records(3200));
  run.deps.fetchLedger = async () => [...run.ledger];
  run.deps.checkFreshness = async () => { run.advance(500 + Math.floor(rand() * (rand() < 0.03 ? 20_000 : 7_000))); return undefined; };
  const perDay: number[] = [];
  for (let d = 0; d < 30; d++) {
    const day = new Date(Date.parse("2026-11-02T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);
    const late = d === 4 || d === 17 ? 25 * 60_000 : Math.floor(rand() * 4 * 60_000);
    run.advance(Date.parse(`${day}T10:00:00Z`) + late - run.deps.now());
    const before = run.ledger.length;
    await runLiteSend(run.deps, cfg, { slot: resolveLiteSlot(run.deps.now(), cfg)! });
    perDay.push(run.ledger.length - before);
  }
  assertDailyLimits(run.ledger);
  assert.deepEqual(perDay, Array(30).fill(95), perDay.join(","));
});
