import assert from "node:assert/strict";
import test from "node:test";
import { assertConfirmedResendPilot, RESEND_PILOT_IDS } from "../src/lite/resend-pilot.js";
import { loadLiteSendConfig } from "../src/lite/schedule.js";

const cfg = loadLiteSendConfig({ RESEND_DAILY_QUOTA: "100", GULLKORNET_LITE_DAILY_LIMIT: "5", GULLKORNET_LITE_MAX_PER_RUN: "1" });
test("confirmed pilot cannot expand via daily/run limits or PR environment", () => {
  assert.doesNotThrow(() => assertConfirmedResendPilot(cfg, {}));
  assert.throws(() => assertConfirmedResendPilot({ ...cfg, dailyLimit: 95 }, {}), /5\/day/);
  assert.throws(() => assertConfirmedResendPilot({ ...cfg, maxPerRun: 5 }, {}), /1\/run/);
  assert.throws(() => assertConfirmedResendPilot(cfg, { GITHUB_EVENT_NAME: "pull_request" }), /forbidden/);
  assert.equal(RESEND_PILOT_IDS.length, 5);
  assert.equal(new Set(RESEND_PILOT_IDS).size, 5);
  assert.ok(Object.isFrozen(RESEND_PILOT_IDS));
});
