import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_HOP_MS, nextClockEvent, osloInstant, planClockHop } from "../src/lite/clock.js";

const iso = (ms: number) => new Date(ms).toISOString();

test("Oslo wall-clock times map to UTC in summer and winter time, across the 25 October change", () => {
  assert.equal(iso(osloInstant("2026-10-21", "10:40")), "2026-10-21T08:40:00.000Z", "CEST");
  assert.equal(iso(osloInstant("2026-10-24", "10:40")), "2026-10-24T08:40:00.000Z", "last CEST day");
  assert.equal(iso(osloInstant("2026-10-25", "10:40")), "2026-10-25T09:40:00.000Z", "first CET day");
  assert.equal(iso(osloInstant("2026-12-01", "12:10")), "2026-12-01T11:10:00.000Z", "CET");
  assert.equal(iso(osloInstant("2027-03-28", "06:40")), "2027-03-28T04:40:00.000Z", "first CEST day 2027");
});

test("the timetable runs intake, readiness, outreach, reserve and report in order, every day", () => {
  let now = Date.parse("2026-10-20T18:00:00Z");
  const seen: string[] = [];
  for (let i = 0; i < 10; i++) {
    const e = nextClockEvent(now);
    seen.push(`${iso(e.atMs).slice(5, 16)} ${e.action}`);
    now = e.atMs;
  }
  assert.deepEqual(seen, [
    "10-21T04:40 intake", "10-21T06:10 readiness", "10-21T08:40 outreach", "10-21T09:20 reserve", "10-21T10:10 report",
    "10-22T04:40 intake", "10-22T06:10 readiness", "10-22T08:40 outreach", "10-22T09:20 reserve", "10-22T10:10 report"
  ]);
  // 25 October (first CET day): the outreach dispatch moves to 09:40 UTC, still 10:40 Oslo.
  assert.equal(iso(nextClockEvent(Date.parse("2026-10-25T08:00:00Z")).atMs), "2026-10-25T09:40:00.000Z");
});

test("one hop never sleeps past GitHub's job limit; a far event only re-arms, a near one fires", () => {
  const far = planClockHop(Date.parse("2026-10-20T18:00:00Z"));
  assert.deepEqual([far.sleepMs, far.fire], [MAX_HOP_MS, undefined]);
  const near = planClockHop(Date.parse("2026-10-21T08:00:00Z"));
  assert.deepEqual([near.sleepMs, near.fire], [40 * 60_000, "outreach"]);
  // Chain of hops from the report to the next day's intake: every hop <= 5.5 h, none skips an event.
  let now = Date.parse("2026-10-21T10:10:00Z"), hops = 0;
  for (;;) {
    const hop = planClockHop(now);
    assert.ok(hop.sleepMs > 0 && hop.sleepMs <= MAX_HOP_MS);
    now += hop.sleepMs; hops++;
    if (hop.fire) { assert.equal(hop.fire, "intake"); break; }
  }
  assert.equal(iso(now), "2026-10-22T04:40:00.000Z");
  assert.equal(hops, 4);
});

test("the clock workflow re-arms itself with GITHUB_TOKEN, has one lock and dispatches the existing workflows", async () => {
  const wf = await readFile(new URL("../.github/workflows/lite-clock.yml", import.meta.url), "utf8");
  assert.match(wf, /group: gullkornet-lite-clock\n\s+cancel-in-progress: false/);
  assert.match(wf, /actions: write/);
  assert.match(wf, /if: success\(\) \|\| failure\(\)\n[\s\S]*gh workflow run lite-clock.yml --ref main/);
  assert.match(wf, /gh workflow run lite-outreach.yml --ref main -f preview=false -f pilot_send=false/);
  assert.match(wf, /-f one_off_date= ;;/, "never a one-off date");
  assert.doesNotMatch(wf, /secrets\./, "holds no secrets");
  assert.match(wf, /timeout-minutes: 350/);
  const alerts = await readFile(new URL("../.github/workflows/pipeline-failure-alerts.yml", import.meta.url), "utf8");
  assert.match(alerts, /- "Gullkornet Lite Clock"/);
});
