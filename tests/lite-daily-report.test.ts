import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDailyReport } from "../src/lite/daily-report.js";
import { loadLiteSendConfig } from "../src/lite/schedule.js";
import { LITE_TEMPLATE } from "../src/lite/template.js";

const cfg = loadLiteSendConfig({ RESEND_DAILY_QUOTA: "100", RESEND_MONTHLY_QUOTA: "3000" });
const mail = (iso: string, last_event = "delivered", subject: string = LITE_TEMPLATE.subject) => ({ created_at: iso, last_event, subject, to: ["x@y.example"] });
const at = (start: string, n: number, stepMs: number, ev = "delivered") =>
  Array.from({ length: n }, (_, i) => mail(new Date(Date.parse(start) + i * stepMs).toISOString(), ev));

test("calendar-day goal: yesterday's sends are not subtracted, earlier sends the same Oslo day are", () => {
  const history = [...at("2026-10-20T11:45:35Z", 42, 37_900), ...at("2026-10-21T09:00:10Z", 52, 67_000), mail("2026-10-21T09:59:00Z", "bounced")];
  const r = buildDailyReport(history, "2026-10-21", Date.parse("2026-10-21T10:30:00Z"), cfg);
  assert.equal(r.carriedIn, 0, "20.10's 42 belong to another day");
  assert.equal(r.capacity, 95);
  assert.equal(r.accepted, 53);
  assert.deepEqual(r.byEvent, { delivered: 52, bounced: 1 });
  assert.equal(r.status, "shortfall");
  // A one-off at 02:03 Oslo the same day counts against that day's goal.
  const early = buildDailyReport([...at("2026-10-21T00:03:37Z", 5, 60_000), ...at("2026-10-21T09:00:10Z", 90, 30_000)], "2026-10-21", Date.parse("2026-10-21T10:30:00Z"), cfg);
  assert.equal(early.carriedIn, 5);
  assert.equal(early.capacity, 90);
  assert.equal(early.status, "ok");
});

test("a missed start and a shortfall are flagged after the slot; before its end it is pending", () => {
  const none = buildDailyReport([], "2026-10-22", Date.parse("2026-10-22T10:05:00Z"), cfg);
  assert.equal(none.capacity, 95);
  assert.equal(none.status, "missed");
  assert.equal(buildDailyReport([], "2026-10-22", Date.parse("2026-10-22T09:30:00Z"), cfg).status, "pending");
  const part = buildDailyReport(at("2026-10-22T09:00:05Z", 60, 37_900), "2026-10-22", Date.parse("2026-10-22T10:05:00Z"), cfg);
  assert.deepEqual([part.status, part.accepted, part.missing], ["shortfall", 60, 35]);
});

test("winter time moves the slot to 10:00-11:00 UTC; other subjects are not counted as Lite", () => {
  const history = [...at("2026-10-26T10:00:05Z", 95, 37_000), mail("2026-10-26T10:30:00Z", "delivered", "Other subject")];
  const r = buildDailyReport(history, "2026-10-26", Date.parse("2026-10-26T11:10:00Z"), cfg);
  assert.equal(new Date(r.slotStartMs).toISOString(), "2026-10-26T10:00:00.000Z");
  assert.equal(r.accepted, 95);
  assert.equal(r.status, "ok");
});

test("report and readiness workflows are read-only, hold no live switch and raise the pipeline alert", async () => {
  const alerts = await readFile(new URL("../.github/workflows/pipeline-failure-alerts.yml", import.meta.url), "utf8");
  for (const [file, name] of [["lite-daily-report.yml", "Gullkornet Lite Daily Report"], ["lite-readiness.yml", "Gullkornet Lite Readiness"]]) {
    const wf = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    assert.match(wf, new RegExp(`^name: ${name}$`, "m"));
    assert.doesNotMatch(wf, /ENABLE_LIVE_SEND|^  (push|pull_request):/m);
    assert.match(alerts, new RegExp(`- "${name}"`));
  }
  const readiness = await readFile(new URL("../.github/workflows/lite-readiness.yml", import.meta.url), "utf8");
  assert.match(readiness, /send:lite -- --preview --limit "\$LIMIT" --min-eligible "\$MIN_ELIGIBLE"/);
});
