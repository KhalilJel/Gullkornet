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

test("one-off needs today's Oslo date and gives exactly the next 60 minutes", () => {
  const now = Date.parse("2026-10-19T15:30:00Z"); // 17:30 Oslo
  assert.deepEqual(resolveLiteSlot(now, cfg, "2026-10-19"), { kind: "one_off", startMs: now, endMs: now + 60 * 60_000 });
  assert.throws(() => resolveLiteSlot(now, cfg, "2026-10-18"), /not today/);
  assert.throws(() => resolveLiteSlot(Date.parse("2026-10-19T22:30:00Z"), cfg, "2026-10-19"), /not today/, "00:30 Oslo is the next day");
  assert.throws(() => resolveLiteSlot(now, cfg, "19.10.2026"), /YYYY-MM-DD/);
  assert.equal(resolveLiteSlot(now, cfg), undefined, "without the one-off, 17:30 is no slot");
});

function spread(ledger: SendLedgerEntry[], slot: LiteSlot) {
  const times = ledger.map(e => Date.parse(e.created_at)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return { times, minGap: Math.min(...gaps), maxGap: Math.max(...gaps), inside: times.every(t => t >= slot.startMs && t < slot.endMs) };
}

test("a scheduled run waits for 11:00 and spreads 95 evenly to before 12:00, about every 38 s", async () => {
  const start = Date.parse("2026-10-20T08:35:00Z"); // 10:35 Oslo
  const slot = resolveLiteSlot(start, cfg)!;
  const run = dryRunDeps(start, records(150));
  const summary = await runLiteSend(run.deps, cfg, { slot });
  assert.equal(summary.sent, 95);
  assert.equal(summary.target, 95);
  const s = spread(run.ledger, slot);
  assert.ok(s.inside, "every send inside 11:00-12:00 Oslo");
  assert.equal(s.times[0], slot.startMs, "first send at 11:00");
  assert.ok(s.minGap >= 30_000 && s.maxGap <= 39_000, `gaps ${s.minGap}-${s.maxGap} ms`);
  assert.ok(s.times[94] - slot.startMs < 60 * 60_000);
  assert.equal(new Set(run.outbox.map(o => o.email.to)).size, 95, "no address twice");
});

test("sends already in the last 24 hours are subtracted, not added on top", async () => {
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

test("rolling 24 h: a full one-off at 17:30 leaves nothing for the next day's 11:00 slot", async () => {
  const oneOffStart = Date.parse("2026-10-19T15:30:00Z"); // 17:30 Oslo
  const run = dryRunDeps(oneOffStart, records(250));
  const earlier = [sentAt(Date.parse("2026-10-19T11:41:00Z"), 0), sentAt(Date.parse("2026-10-19T11:42:00Z"), 1)];
  run.deps.fetchLedger = async () => [...earlier, ...run.ledger];
  const oneOff = resolveLiteSlot(oneOffStart, cfg, "2026-10-19")!;
  const first = await runLiteSend(run.deps, cfg, { slot: oneOff });
  assert.equal(first.target, 93, "95 minus the 2 sent at 13:41");
  assert.equal(first.sent, 93);
  assert.ok(spread(run.ledger, oneOff).inside, "within 60 minutes of the start");

  run.advance(Date.parse("2026-10-20T08:35:00Z") - run.deps.now());
  const next = await runLiteSend(run.deps, cfg, { slot: resolveLiteSlot(run.deps.now(), cfg)! });
  assert.equal(next.target, 0);
  assert.equal(next.sent, 0);
  assert.equal(next.stoppedBy, "limit");
  assert.equal(run.outbox.length, 93);
});

test("slow checks cost sends, never the window or the spacing", async () => {
  const start = Date.parse("2026-10-20T09:00:00Z");
  const slot = resolveLiteSlot(start, cfg)!;
  const run = dryRunDeps(start, records(150));
  run.deps.checkFreshness = async () => { run.advance(70_000); return undefined; };
  const summary = await runLiteSend(run.deps, cfg, { slot });
  assert.ok(summary.sent > 40 && summary.sent < 95, `sent ${summary.sent}`);
  assert.equal(summary.stoppedBy, "outside_window");
  const s = spread(run.ledger, slot);
  assert.ok(s.inside && s.minGap >= 30_000);
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
