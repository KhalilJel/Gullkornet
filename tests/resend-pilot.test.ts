import assert from "node:assert/strict";
import test from "node:test";
import { assertConfirmedResendSending, assertResendDeliveryHealthy, RESEND_PILOT_IDS } from "../src/lite/resend-pilot.js";
import { loadLiteSendConfig } from "../src/lite/schedule.js";

const cfg = loadLiteSendConfig({ RESEND_DAILY_QUOTA: "100", GULLKORNET_LITE_DAILY_LIMIT: "5", GULLKORNET_LITE_MAX_PER_RUN: "1" });
test("confirmed operation enforces daily/run/time/spacing limits and refuses PR environments", () => {
  assert.doesNotThrow(() => assertConfirmedResendSending(cfg, {}));
  assert.doesNotThrow(() => assertConfirmedResendSending({ ...cfg, dailyLimit: 95, maxPerRun: 2 }, {}));
  assert.throws(() => assertConfirmedResendSending({ ...cfg, dailyLimit: 96 }, {}), /95\/day/);
  assert.throws(() => assertConfirmedResendSending({ ...cfg, maxPerRun: 3 }, {}), /2\/run/);
  assert.throws(() => assertConfirmedResendSending({ ...cfg, minSpacingMs: 20_000 }, {}), /spacing/);
  assert.throws(() => assertConfirmedResendSending({ ...cfg, startHour: 6 }, {}), /08-20/);
  assert.throws(() => assertConfirmedResendSending(cfg, { GITHUB_EVENT_NAME: "pull_request" }), /forbidden/);
  assert.equal(RESEND_PILOT_IDS.length, 5);
  assert.equal(new Set(RESEND_PILOT_IDS).size, 5);
  assert.ok(Object.isFrozen(RESEND_PILOT_IDS));
});

test("recent bounce or complaint stops sending, delivered mail and expired events do not", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  for (const last_event of ["bounced", "complained", "failed", "suppressed"]) {
    assert.throws(() => assertResendDeliveryHealthy([{ created_at: "2026-10-16T11:00:00Z", last_event }], now), /paused/);
  }
  assert.doesNotThrow(() => assertResendDeliveryHealthy([{ created_at: "2026-10-16T11:00:00Z", last_event: "delivered" }], now));
  assert.doesNotThrow(() => assertResendDeliveryHealthy([{ created_at: "2026-10-14T11:00:00Z", last_event: "bounced" }], now));
});
