import test from "node:test";
import assert from "node:assert/strict";
import { assertAirtableRecipientApproved } from "../src/integrations/airtable-send-approval.js";

const expected = {
  subject: "Et lite spørsmål til Salong AS",
  text: "Hei!\nJeg la merke til frisørtjenester på nettsiden.\nHvis dere ikke ønsker flere e-poster fra oss, svar «nei takk».\nMvh Jelassi"
};
const approved = {
  id: "rec12345678901234",
  fields: {
    Email: "post@salong.no",
    "Lead Status": "Approved",
    "Review Status": "Ready for outreach",
    "Do Not Contact": false,
    "Outreach Subject": expected.subject,
    "Outreach Draft": expected.text,
    "Verified Observation": "Checked the live website on 2026-10-12: services page lists hair coloring."
  }
};

test("requires a unique, approved, human-verified matching Airtable draft", () => {
  assert.equal(assertAirtableRecipientApproved([approved], "post@salong.no", expected), approved.id);
  assert.throws(() => assertAirtableRecipientApproved([], "post@salong.no", expected), /exactly one record/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "Verified Observation": "" } }], "post@salong.no", expected), /human-verified/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "Outreach Draft": "different text" } }], "post@salong.no", expected), /exactly match/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "Do Not Contact": true } }], "post@salong.no", expected), /Do Not Contact/);
  assert.throws(() => assertAirtableRecipientApproved([{ ...approved, fields: { ...approved.fields, "Review Status": "Needs review" } }], "post@salong.no", expected), /Ready for outreach/);
});

test("refuses outreach drafts without an opt-out instruction", () => {
  const noOptOut = { ...approved, fields: { ...approved.fields, "Outreach Draft": "Hei! Vi tilbyr nettsider." } };
  assert.throws(
    () => assertAirtableRecipientApproved([noOptOut], "post@salong.no", { ...expected, text: "Hei! Vi tilbyr nettsider." }),
    /opt-out instruction/
  );
});
