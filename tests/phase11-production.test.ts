import assert from "node:assert/strict";
import test from "node:test";
import { assertBulkSendDisabledForPhase11, assertLiveSendAllowed, prepareEmail, type OutreachDraft } from "../src/integrations/outbound-email.js";

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
