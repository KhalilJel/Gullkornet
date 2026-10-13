import test from "node:test";
import assert from "node:assert/strict";
import { approvalLookupFormula, assertAirtableRecipientApproved } from "../src/integrations/airtable-send-approval.js";

const expected = {
  subject: "Dette la vi merke til hos dere",
  text: "Hei!\nJeg la merke til frisørtjenestene dere beskriver. Cidea kan hjelpe med nettsider og digital markedsføring. Kunne jeg sendt en kort idé? Hvis dette ikke er ønsket, svar nei takk.\nMvh Jelassi"
};
const approved = {
  id: "rec12345678901234",
  fields: {
    Email: "post@salong.no",
    Website: "https://salong.no/",
    "Contact Source URL": "https://salong.no/kontakt",
    "Personalization Evidence": "Tjenestetekst: frisørtjenester",
    "Lead Status": "Draft Ready",
    "Do Not Contact": false,
    "AI Decision": "APPROVE",
    "AI Confidence": 0.95,
    "AI Evidence": "Tjenestetekst: frisørtjenester",
    "AI Evidence URL": "https://salong.no/tjenester",
    "AI Draft Subject": expected.subject,
    "AI Draft Body": expected.text
  }
};

test("requires one unique AI-approved Airtable draft with matching evidence", () => {
  assert.equal(assertAirtableRecipientApproved([approved], "post@salong.no", expected), approved.id);
  assert.throws(() => assertAirtableRecipientApproved([], "post@salong.no", expected), /exactly one record/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "AI Evidence": "different evidence" } }], "post@salong.no", expected), /match the public-site research evidence/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "AI Confidence": 0.89 } }], "post@salong.no", expected), /at least 0.90/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "AI Draft Body": "different text" } }], "post@salong.no", expected), /exactly match/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "Do Not Contact": true } }], "post@salong.no", expected), /Do Not Contact/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "AI Decision": "NEEDS_REVIEW" } }], "post@salong.no", expected), /AI Decision must be APPROVE/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "AI Evidence URL": "https://other.no/evidence" } }], "post@salong.no", expected), /official website/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, Email: "person@gmail.com" } }], "person@gmail.com", expected), /email domain must match/);
});

test("refuses outreach drafts without an opt-out instruction", () => {
  const text = "Hei! Jeg la merke til frisørtjenester på nettsiden.";
  const noOptOut = { ...approved, fields: { ...approved.fields, "AI Draft Body": text } };
  assert.throws(
    () => assertAirtableRecipientApproved([noOptOut], "post@salong.no", { ...expected, text }),
    /opt-out instruction/
  );
});

test("matches the recipient regardless of case and surrounding whitespace", () => {
  const messy = { ...approved, fields: { ...approved.fields, Email: "  Post@Salong.NO " } };
  assert.equal(assertAirtableRecipientApproved([messy], " POST@salong.no ", expected), approved.id);
  assert.equal(
    approvalLookupFormula("  Post@Salong.NO "),
    'AND(OR(LOWER(TRIM({Email})) = "post@salong.no", RIGHT(LOWER(TRIM({Email})), 10) = "@salong.no"), OR({Do Not Contact} = 0, {Do Not Contact} = 1))'
  );
});

test("a suppressed duplicate of the same address makes the approval fail closed", () => {
  const suppressedDuplicate = {
    id: "recDuplicate000001",
    fields: { Email: "POST@salong.no ", "Lead Status": "Suppressed", "Do Not Contact": true }
  };
  assert.throws(() => assertAirtableRecipientApproved([approved, suppressedDuplicate], "post@salong.no", expected), /exactly one record/);
  // The lookup itself must not hide Do Not Contact rows.
  // The Do Not Contact reference is a field-existence tripwire that matches both values.
  assert.match(approvalLookupFormula("post@salong.no"), /OR\(\{Do Not Contact\} = 0, \{Do Not Contact\} = 1\)\)$/);
});

test("refuses when another address at the same business is contacted, replied, or suppressed", () => {
  for (const sibling of [
    { "Lead Status": "Sent" },
    { "Lead Status": "Replied" },
    { "Lead Status": "Contacted" },
    { "Lead Status": "Suppressed" },
    { "Lead Status": "Do Not Contact" },
    { "Lead Status": "Follow-up" },
    { "Lead Status": "Meeting" },
    { "Lead Status": "Won" },
    { "Lead Status": "Lost" },
    { "Lead Status": "Draft Ready", "Do Not Contact": true }
  ]) {
    const record = { id: "recSibling00000001", fields: { Email: "Kontakt@Salong.no", ...sibling } };
    assert.throws(
      () => assertAirtableRecipientApproved([approved, record], "post@salong.no", expected),
      /same business domain/,
      JSON.stringify(sibling)
    );
  }
  const untouched = { id: "recSibling00000002", fields: { Email: "kontakt@salong.no", "Lead Status": "Draft Ready", "Do Not Contact": false } };
  assert.equal(assertAirtableRecipientApproved([approved, untouched], "post@salong.no", expected), approved.id);
});

test("business-domain matching never widens to freemail or CIDEA's own domain", () => {
  assert.equal(approvalLookupFormula("owner@gmail.com"), 'AND(LOWER(TRIM({Email})) = "owner@gmail.com", OR({Do Not Contact} = 0, {Do Not Contact} = 1))');
  assert.equal(approvalLookupFormula("someone@online.no"), 'AND(LOWER(TRIM({Email})) = "someone@online.no", OR({Do Not Contact} = 0, {Do Not Contact} = 1))');
  assert.equal(approvalLookupFormula("hello@cideamarketing.com"), 'AND(LOWER(TRIM({Email})) = "hello@cideamarketing.com", OR({Do Not Contact} = 0, {Do Not Contact} = 1))');
});

test("an unchecked Do Not Contact box (omitted by the Airtable API) is accepted; any other non-false value is refused", () => {
  const { "Do Not Contact": _omitted, ...withoutDnc } = approved.fields;
  assert.equal(assertAirtableRecipientApproved([{ ...approved, fields: withoutDnc }], "post@salong.no", expected), approved.id);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...withoutDnc, "Do Not Contact": "no" } }], "post@salong.no", expected), /Do Not Contact/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...withoutDnc, "Do Not Contact": null } }], "post@salong.no", expected), /Do Not Contact/);
});
