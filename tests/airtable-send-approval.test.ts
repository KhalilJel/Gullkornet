import test from "node:test";
import assert from "node:assert/strict";
import { assertAirtableRecipientApproved } from "../src/integrations/airtable-send-approval.js";

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
