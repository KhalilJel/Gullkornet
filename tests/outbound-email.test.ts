import test from "node:test";
import assert from "node:assert/strict";
import { assertLiveSendAllowed, parseSuppressionList, prepareEmail, type OutreachDraft } from "../src/integrations/outbound-email.js";

const drafts: OutreachDraft[] = [{
  companyName: "Example AS",
  emails: [{ email: "post@example.no", sourceUrl: "https://example.no/kontakt" }],
  subject: "Et lite spørsmål til Example AS",
  draftBody: "Hei!\n\nEr det greit at jeg sender en kort idé?\n\nMvh Jelassi"
}];
const approvedEnv = {
  GULLKORNET_ENABLE_LIVE_SEND: "true",
  GULLKORNET_APPROVED_RECIPIENT: "post@example.no",
  GULLKORNET_RECIPIENT_REVIEWED: "true",
  GULLKORNET_SEND_IDEMPOTENCY_KEY: "gullkornet-test-unique-1",
  RESEND_API_KEY: "test"
};

test("prepares one draft using the selected sender", () => {
  const email = prepareEmail(drafts, "POST@example.no");
  assert.equal(email.from, "jelassi@cideamarketing.com");
  assert.equal(email.to, "post@example.no");
  assert.equal(email.subject, "Et lite spørsmål til Example AS");
});

test("refuses to send if recipient has no unique matching draft", () => {
  assert.throws(() => prepareEmail(drafts, "missing@example.no"), /found 0/);
  assert.throws(() => prepareEmail([...drafts, ...drafts], "post@example.no"), /found 2/);
});

test("suppression list ignores blank lines, comments and case", () => {
  const list = parseSuppressionList("# opt-outs\nPOST@example.no\n\nother@example.no ");
  assert.equal(list.has("post@example.no"), true);
  assert.equal(list.has("other@example.no"), true);
});

test("live send requires explicit enablement, exact recipient and human review", () => {
  const email = prepareEmail(drafts, "post@example.no");
  assert.throws(() => assertLiveSendAllowed(email, {}), /disabled/);
  assert.throws(() => assertLiveSendAllowed(email, { ...approvedEnv, GULLKORNET_APPROVED_RECIPIENT: "other@example.no" }), /does not exactly match/);
  assert.throws(() => assertLiveSendAllowed(email, { ...approvedEnv, GULLKORNET_RECIPIENT_REVIEWED: "false" }), /review confirmation missing/);
});

test("live send fails closed for suppressed recipients and missing idempotency keys", () => {
  const email = prepareEmail(drafts, "post@example.no");
  assert.throws(() => assertLiveSendAllowed(email, approvedEnv, new Set(["post@example.no"])), /suppression list/);
  assert.throws(() => assertLiveSendAllowed(email, { ...approvedEnv, GULLKORNET_SEND_IDEMPOTENCY_KEY: "" }), /GULLKORNET_SEND_IDEMPOTENCY_KEY/);
});

test("allows live send checks only when all gates pass and recipient is not suppressed", () => {
  const email = prepareEmail(drafts, "post@example.no");
  assert.doesNotThrow(() => assertLiveSendAllowed(email, approvedEnv, new Set()));
});
