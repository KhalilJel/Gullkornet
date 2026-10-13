import assert from "node:assert/strict";
import test from "node:test";
import { assertAirtableRecipientApproved, eligibleDraftFromRecord, SendRefusedError, type AirtableSendApproval } from "../src/integrations/airtable-send-approval.js";
import { assertLiveSendAllowed, assertRateLimits, assertRecipientNotAlreadySent, countRecentSends, prepareEmail } from "../src/integrations/outbound-email.js";
import { previewQueue, selectEligibleDraft, type SelectionDeps } from "../src/integrations/send-selection.js";
import { assertMinimumSpacing, assertWithinSendWindow, SendDeferredError } from "../src/integrations/send-schedule.js";

const SUBJECT = "Dette la vi merke til hos dere";
const BODY = "Hei!\nJeg la merke til frisørtjenestene dere beskriver. Kunne jeg sendt en kort idé? Hvis dette ikke er ønsket, svar nei takk.\nMvh Jelassi";

function record(overrides: Record<string, unknown> = {}, id = "rec12345678901234"): AirtableSendApproval {
  return {
    id,
    fields: {
      Email: "post@salong.no", Website: "https://salong.no/", "Contact Source URL": "https://salong.no/kontakt",
      "Personalization Evidence": "Tjenestetekst: frisørtjenester", "Research Notes": "ok", "Lead Status": "Draft Ready",
      "Do Not Contact": false, "AI Decision": "APPROVE", "AI Confidence": 0.95, "AI Evidence": "Tjenestetekst: frisørtjenester",
      "AI Evidence URL": "https://salong.no/tjenester", "AI Draft Subject": SUBJECT, "AI Draft Body": BODY, ...overrides
    }
  };
}

// Each case must make a single record ineligible for sending.
const REFUSALS: Array<[string, Record<string, unknown>]> = [
  ["Do Not Contact ticked", { "Do Not Contact": true }],
  ["AI Decision NEEDS_REVIEW", { "AI Decision": "NEEDS_REVIEW" }],
  ["AI Decision REJECT", { "AI Decision": "REJECT" }],
  ["AI Decision missing", { "AI Decision": undefined }],
  ["confidence 0.89", { "AI Confidence": 0.89 }],
  ["confidence 0 (reset by research sync)", { "AI Confidence": 0 }],
  ["confidence as text", { "AI Confidence": "0.95" }],
  ["status not Draft Ready", { "Lead Status": "Needs Review" }],
  ["status Replied", { "Lead Status": "Replied" }],
  ["AI evidence missing", { "AI Evidence": undefined }],
  ["AI evidence not in research evidence", { "AI Evidence": "noe annet" }],
  ["AI evidence URL missing", { "AI Evidence URL": undefined }],
  ["AI evidence URL on another site", { "AI Evidence URL": "https://annen.no/side" }],
  ["contact source on another site", { "Contact Source URL": "https://annen.no/kontakt" }],
  ["email domain differs from website", { Email: "post@annen.no" }],
  ["personal Gmail address", { Email: "ola.nordmann@gmail.com" }],
  ["named person on business domain", { Email: "ola.nordmann@salong.no" }],
  ["draft without opt-out", { "AI Draft Body": "Hei! Vi tilbyr nettsider. Mvh Jelassi" }],
  ["strategic account", { "Research Notes": "[GK-ROUTE:STRATEGIC_ACCOUNT]" }]
];

for (const [name, fields] of REFUSALS) {
  test(`sender refuses: ${name}`, () => {
    assert.equal(eligibleDraftFromRecord(record(fields)), undefined);
  });
}

test("a fully approved record is eligible", () => {
  assert.equal(eligibleDraftFromRecord(record())?.email, "post@salong.no");
});

test("policy refusals are SendRefusedError so one bad record cannot block the queue", () => {
  const expected = { subject: SUBJECT, text: BODY };
  assert.throws(() => assertAirtableRecipientApproved([record(), record({}, "rec99999999999999")], "post@salong.no", expected), SendRefusedError);
  assert.throws(() => assertAirtableRecipientApproved([record(), record({ Email: "info@salong.no", "Lead Status": "Sent" }, "rec22222222222222")], "post@salong.no", expected), SendRefusedError);
});

function deps(overrides: Partial<SelectionDeps> = {}): SelectionDeps {
  return {
    lookupApproval: async () => "rec12345678901234",
    assertNotReplied: async () => undefined,
    ...overrides
  };
}

function businessRecord(domain: string, id: string): AirtableSendApproval {
  return record({ Email: `post@${domain}`, Website: `https://${domain}/`, "Contact Source URL": `https://${domain}/k`, "AI Evidence URL": `https://${domain}/t` }, id);
}

test("selection skips a refused record and a replied recipient and picks the next eligible one", async () => {
  const queue = [businessRecord("a.no", "rec1AAAAAAAAAAAAA"), businessRecord("b.no", "rec1BBBBBBBBBBBBB"), businessRecord("c.no", "rec1CCCCCCCCCCCCC"), record({ Email: "gmail.person@gmail.com" }, "rec1DDDDDDDDDDDDD")];
  const outcome = await selectEligibleDraft(queue, deps({
    lookupApproval: async (email) => { if (email === "post@a.no") throw new SendRefusedError("duplicate"); return "rec1OK00000000000"; },
    assertNotReplied: async (email) => { if (email === "post@b.no") throw new Error("Recipient has replied. Follow-up/outreach is blocked."); }
  }));
  assert.equal(outcome.selected?.email, "post@c.no");
  assert.deepEqual(outcome.skipped, { not_eligible: 0, refused: 1, replied: 1 });
});

test("an outage in the Airtable lookup or the reply service stops the run instead of being read as allowed", async () => {
  await assert.rejects(selectEligibleDraft([record()], deps({ lookupApproval: async () => { throw new Error("Airtable approval check failed with HTTP 503. Refusing to send."); } })), /HTTP 503/);
  await assert.rejects(selectEligibleDraft([record()], deps({ assertNotReplied: async () => { throw new Error("OpenOutSend reply-status check failed with HTTP 503. Refusing to send."); } })), /HTTP 503/);
});

test("preview counts every record without stopping and cannot send", async () => {
  const queue = [record(), record({ "AI Confidence": 0.5 }, "rec33333333333333"), record({ Email: "x@gmail.com" }, "rec44444444444444")];
  const result = await previewQueue(queue, deps());
  assert.deepEqual([result.scanned, result.eligible, result.skipped.not_eligible], [3, 1, 2]);
});

const sendEnv = { GULLKORNET_ENABLE_LIVE_SEND: "true", GULLKORNET_APPROVED_RECIPIENT: "post@salong.no", GULLKORNET_RECIPIENT_REVIEWED: "true", RESEND_API_KEY: "re_test", GULLKORNET_SEND_IDEMPOTENCY_KEY: "k" } as NodeJS.ProcessEnv;

test("final send gate: kill switch, role inbox, approved recipient, sender and suppression", () => {
  const email = prepareEmail([{ companyName: "", emails: [{ email: "post@salong.no" }], subject: SUBJECT, draftBody: BODY }], "post@salong.no");
  assert.doesNotThrow(() => assertLiveSendAllowed(email, sendEnv, new Set()));
  assert.throws(() => assertLiveSendAllowed(email, { ...sendEnv, GULLKORNET_ENABLE_LIVE_SEND: "false" }, new Set()));
  assert.throws(() => assertLiveSendAllowed(email, { ...sendEnv, GULLKORNET_ENABLE_LIVE_SEND: undefined }, new Set()));
  assert.throws(() => assertLiveSendAllowed(email, { ...sendEnv, GULLKORNET_APPROVED_RECIPIENT: "info@salong.no" }, new Set()));
  assert.throws(() => assertLiveSendAllowed(email, sendEnv, new Set(["post@salong.no"])));
  assert.throws(() => assertLiveSendAllowed({ ...email, to: "ola@gmail.com" }, sendEnv, new Set()));
  assert.throws(() => assertLiveSendAllowed({ ...email, from: "someone@else.com" }, sendEnv, new Set()));
});

test("limits: 12/hour, 100/day ceiling, one per run, five-minute spacing, one message per recipient", () => {
  const now = Date.parse("2026-10-14T08:00:00Z"); // Wednesday 10:00 Oslo
  assert.throws(() => assertRateLimits({ lastHour: 12, lastDay: 12, today: 12 }, {}), SendDeferredError);
  assert.throws(() => assertRateLimits({ lastHour: 0, lastDay: 100, today: 100 }, {}), SendDeferredError);
  assert.throws(() => assertRateLimits({ lastHour: 0, lastDay: 0, today: 0 }, { GULLKORNET_DAILY_SEND_LIMIT: "101" }), /between 1 and 100/);
  assert.throws(() => assertRateLimits({ lastHour: 0, lastDay: 0, today: 0 }, { MAX_EMAILS_PER_RUN: "2" }), /MAX_EMAILS_PER_RUN/);
  assert.doesNotThrow(() => assertRateLimits({ lastHour: 11, lastDay: 40, today: 40 }, { GULLKORNET_DAILY_SEND_LIMIT: "100" }));
  assert.throws(() => assertMinimumSpacing([{ created_at: new Date(now - 4 * 60_000).toISOString() }], now), SendDeferredError);
  assert.doesNotThrow(() => assertMinimumSpacing([{ created_at: new Date(now - 5 * 60_000).toISOString() }], now));
  const ledger = [{ created_at: new Date(now - 3 * 3600_000).toISOString(), to: ["Post@Salong.no "] }];
  assert.throws(() => assertRecipientNotAlreadySent(ledger, "post@salong.no", now), /already appears/);
  assert.equal(countRecentSends(ledger, now).lastHour, 0);
});

test("window: Saturday and 15:00 Oslo are refused, Wednesday 09:00 is allowed", () => {
  assert.throws(() => assertWithinSendWindow(Date.parse("2026-10-17T08:00:00Z")));
  assert.throws(() => assertWithinSendWindow(Date.parse("2026-10-14T13:00:00Z")));
  assert.doesNotThrow(() => assertWithinSendWindow(Date.parse("2026-10-14T07:00:00Z")));
});
