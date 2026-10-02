import test from "node:test";
import assert from "node:assert/strict";
import { assertLiveSendAllowed, prepareEmail, type OutreachDraft } from "../src/integrations/outbound-email.js";

const drafts: OutreachDraft[] = [{
  companyName: "Example AS",
  emails: [{ email: "post@example.no", sourceUrl: "https://example.no/kontakt" }],
  subject: "Et lite spørsmål til Example AS",
  draftBody: "Hei!\n\nEr det greit at jeg sender en kort idé?\n\nMvh Jelassi"
}];

test("prepares one draft using the selected sender", () => {
  const email = prepareEmail(drafts, "POST@example.no");
  assert.equal(email.from, "jelassi@smartsvar.no");
  assert.equal(email.to, "post@example.no");
  assert.equal(email.subject, "Et lite spørsmål til Example AS");
});

test("refuses to send if recipient has no unique matching draft", () => {
  assert.throws(() => prepareEmail(drafts, "missing@example.no"), /found 0/);
  assert.throws(() => prepareEmail([...drafts, ...drafts], "post@example.no"), /found 2/);
});

test("live send requires explicit enablement, exact recipient and review confirmation", () => {
  const email = prepareEmail(drafts, "post@example.no");
  assert.throws(() => assertLiveSendAllowed(email, {}), /disabled/);
  assert.throws(() => assertLiveSendAllowed(email, {
    GULLKORNET_ENABLE_LIVE_SEND: "true",
    GULLKORNET_APPROVED_RECIPIENT: "other@example.no",
    GULLKORNET_RECIPIENT_REVIEWED: "true",
    RESEND_API_KEY: "test"
  }), /does not exactly match/);
  assert.throws(() => assertLiveSendAllowed(email, {
    GULLKORNET_ENABLE_LIVE_SEND: "true",
    GULLKORNET_APPROVED_RECIPIENT: "post@example.no",
    GULLKORNET_RECIPIENT_REVIEWED: "false",
    RESEND_API_KEY: "test"
  }), /review confirmation missing/);
});

test("allows live send checks only when all explicit gates are satisfied", () => {
  const email = prepareEmail(drafts, "post@example.no");
  assert.doesNotThrow(() => assertLiveSendAllowed(email, {
    GULLKORNET_ENABLE_LIVE_SEND: "true",
    GULLKORNET_APPROVED_RECIPIENT: "post@example.no",
    GULLKORNET_RECIPIENT_REVIEWED: "true",
    RESEND_API_KEY: "test"
  }));
});
