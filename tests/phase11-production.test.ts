import assert from "node:assert/strict";
import test from "node:test";
import { assertBulkSendDisabledForPhase11, assertLiveSendAllowed, assertProductionKillSwitchEnabled, assertRateLimits, countRecentSends, PHASE11_RATE_LIMITS, prepareEmail, type OutreachDraft } from "../src/integrations/outbound-email.js";

const draft: OutreachDraft[] = [{
  companyName: "Phase 11 Pilot AS",
  emails: [{ email: "pilot@example.no" }],
  subject: "Dette la vi merke til hos dere",
  draftBody: "Hei!\n\nDette er en kontrollert Phase 11 pilotmelding.\n\nMvh Jelassi"
}];

const baseEnv = {
  GULLKORNET_ENABLE_LIVE_SEND: "true",
  GULLKORNET_APPROVED_RECIPIENT: "pilot@example.no",
  GULLKORNET_RECIPIENT_REVIEWED: "true",
  GULLKORNET_SEND_IDEMPOTENCY_KEY: "phase11-pilot-idempotency",
  RESEND_API_KEY: "test"
};

test("Phase 11 pilot requires every production gate", () => {
  const email = prepareEmail(draft, "pilot@example.no");
  assert.doesNotThrow(() => assertLiveSendAllowed(email, baseEnv, new Set()));
  for (const [key, value] of [
    ["GULLKORNET_ENABLE_LIVE_SEND", "false"],
    ["GULLKORNET_APPROVED_RECIPIENT", "other@example.no"],
    ["GULLKORNET_RECIPIENT_REVIEWED", "false"],
    ["GULLKORNET_SEND_IDEMPOTENCY_KEY", ""],
    ["RESEND_API_KEY", ""]
  ] as const) {
    assert.throws(() => assertLiveSendAllowed(email, { ...baseEnv, [key]: value }));
  }
});

test("Phase 11 pilot cannot send a suppressed recipient", () => {
  const email = prepareEmail(draft, "pilot@example.no");
  assert.throws(() => assertLiveSendAllowed(email, baseEnv, new Set(["pilot@example.no"])), /suppression list/);
});

test("Phase 11 pilot cannot change sender", () => {
  const email = prepareEmail(draft, "pilot@example.no", "attacker@example.no");
  assert.throws(() => assertLiveSendAllowed(email, baseEnv), /Sender must remain/);
});


test("Phase 11 keeps legacy batch outreach disabled even when live-send env is enabled", () => {
  assert.throws(
    () => assertBulkSendDisabledForPhase11(),
    /Bulk outreach is disabled during Phase 11/
  );
});


test("Phase 11 kill switch fails closed unless explicitly enabled", () => {
  assert.throws(() => assertProductionKillSwitchEnabled({}), /kill switch is active/);
  assert.throws(() => assertProductionKillSwitchEnabled({ GULLKORNET_ENABLE_LIVE_SEND: "false" }), /kill switch is active/);
  assert.doesNotThrow(() => assertProductionKillSwitchEnabled({ GULLKORNET_ENABLE_LIVE_SEND: "true" }));
});

test("Phase 11 rate caps are locked to 3 per run, 3 per hour, 10 per day", () => {
  assert.deepEqual(PHASE11_RATE_LIMITS, { maxPerRun: 3, maxPerHour: 3, maxPerDay: 10 });
  assert.doesNotThrow(() => assertRateLimits({ lastHour: 2, lastDay: 9 }, { MAX_EMAILS_PER_RUN: "3" }));
  assert.throws(() => assertRateLimits({ lastHour: 3, lastDay: 3 }, { MAX_EMAILS_PER_RUN: "3" }), /Hourly production rate limit/);
  assert.throws(() => assertRateLimits({ lastHour: 0, lastDay: 10 }, { MAX_EMAILS_PER_RUN: "3" }), /Daily production rate limit/);
  assert.throws(() => assertRateLimits({ lastHour: 0, lastDay: 0 }, { MAX_EMAILS_PER_RUN: "4" }), /MAX_EMAILS_PER_RUN/);
});

test("Phase 11 counts send history based on created_at and fails closed on corrupt timestamps", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");
  const counts = countRecentSends([
    { created_at: "2026-10-09T11:30:00Z" },
    { created_at: "2026-10-09T11:30:00Z" },
    { created_at: "2026-10-08T18:00:00Z" },
    { created_at: "2026-10-08T11:00:00Z" }
  ], now);
  assert.deepEqual(counts, { lastHour: 2, lastDay: 3 });
  assert.throws(() => countRecentSends([{ created_at: "not-a-date" }], now), /invalid timestamp/);
});
