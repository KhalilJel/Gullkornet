import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countRecentSends } from "../src/integrations/outbound-email.js";
import {
  assertMinimumSpacing, assertWithinSendWindow, isWithinSendWindow, osloClock, SEND_SCHEDULE, SendDeferredError
} from "../src/integrations/send-schedule.js";

const at = (iso: string) => Date.parse(iso);

test("send window is Monday-Friday 09:00 inclusive to 15:00 exclusive Europe/Oslo (summer, UTC+2)", () => {
  // 2026-10-13 is a Tuesday; Oslo is on summer time until 2026-10-25.
  assert.equal(isWithinSendWindow(at("2026-10-13T06:59:00Z")), false); // 08:59
  assert.equal(isWithinSendWindow(at("2026-10-13T07:00:00Z")), true);  // 09:00
  assert.equal(isWithinSendWindow(at("2026-10-13T12:59:00Z")), true);  // 14:59
  assert.equal(isWithinSendWindow(at("2026-10-13T13:00:00Z")), false); // 15:00
});

test("send window follows winter time (UTC+1) and skips weekends", () => {
  // 2026-11-03 is a Tuesday on winter time.
  assert.equal(isWithinSendWindow(at("2026-11-03T07:59:00Z")), false); // 08:59
  assert.equal(isWithinSendWindow(at("2026-11-03T08:00:00Z")), true);  // 09:00
  assert.equal(isWithinSendWindow(at("2026-11-03T13:59:00Z")), true);  // 14:59
  assert.equal(isWithinSendWindow(at("2026-11-03T14:00:00Z")), false); // 15:00
  assert.equal(isWithinSendWindow(at("2026-10-17T10:00:00Z")), false); // Saturday
  assert.equal(isWithinSendWindow(at("2026-10-18T10:00:00Z")), false); // Sunday
  assert.equal(isWithinSendWindow(at("2026-10-16T10:00:00Z")), true);  // Friday
  assert.throws(() => assertWithinSendWindow(at("2026-10-17T10:00:00Z")), /Outside the send window/);
});

test("the window is exactly six hours, so five-minute spacing caps a day at 72 sends", () => {
  assert.equal(SEND_SCHEDULE.endHour - SEND_SCHEDULE.startHour, 6);
  assert.equal(SEND_SCHEDULE.minSpacingMs, 5 * 60 * 1000);
  assert.equal(((SEND_SCHEDULE.endHour - SEND_SCHEDULE.startHour) * 60 * 60 * 1000) / SEND_SCHEDULE.minSpacingMs, 72);
});

test("at least five minutes must separate emails; bad ledger data fails closed", () => {
  const now = at("2026-10-13T08:00:00Z");
  assert.doesNotThrow(() => assertMinimumSpacing([], now));
  assert.doesNotThrow(() => assertMinimumSpacing([{ created_at: "2026-10-13T07:55:00Z" }], now));
  assert.throws(() => assertMinimumSpacing([{ created_at: "2026-10-13T07:55:01Z" }], now), SendDeferredError);
  assert.throws(() => assertMinimumSpacing([{ created_at: "2026-10-13T07:00:00Z" }, { created_at: "2026-10-13T07:58:00Z" }], now), /five minutes/);
  assert.throws(() => assertMinimumSpacing([{ created_at: "2026-10-13T08:01:00Z" }], now), /future-dated/);
  assert.throws(() => assertMinimumSpacing([{ created_at: "garbage" }], now), /invalid timestamp/);
});

test("the daily count follows the Oslo calendar day across midnight", () => {
  // 22:30Z on 10-12 is 00:30 on 10-13 in Oslo; 21:30Z on 10-12 is 23:30 on 10-12.
  const now = at("2026-10-13T08:00:00Z");
  const counts = countRecentSends([
    { created_at: "2026-10-12T22:30:00Z" },
    { created_at: "2026-10-12T21:30:00Z" },
    { created_at: "2026-10-13T07:00:00Z" }
  ], now);
  assert.equal(counts.today, 2);
  assert.equal(counts.lastDay, 3);
  assert.equal(osloClock(at("2026-10-12T22:30:00Z")).date, "2026-10-13");
});

test("the sending workflow runs every five minutes on weekdays and sends one email per run", async () => {
  const workflow = (await readFile(new URL("../.github/workflows/daily-outreach.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(workflow, /cron: "\*\/5 7-14 \* \* 1-5"/);
  assert.match(workflow, /MAX_EMAILS_PER_RUN: "1"/);
  assert.match(workflow, /GULLKORNET_DAILY_SEND_LIMIT: "100"/);
  assert.equal((workflow.match(/cron:/g) ?? []).length, 1);
});
