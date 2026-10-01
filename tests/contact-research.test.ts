import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicEmails, createPersonalizedDraft } from "../src/integrations/contact-research.js";

test("extractPublicEmails finds only publicly visible mailto and text addresses", () => {
  const html = `<html><body>
    <a href="mailto:post@example.no">Send e-post</a>
    <p>Kontakt oss på hei@example.no</p>
    <img src="logo@example.no.png">
  </body></html>`;
  const emails = extractPublicEmails(html, "https://example.no/kontakt");
  assert.deepEqual(emails.map((item) => item.email).sort(), ["hei@example.no", "post@example.no"]);
  assert.ok(emails.every((item) => item.sourceUrl === "https://example.no/kontakt"));
});

test("createPersonalizedDraft uses concrete website evidence and asks permission to share an idea", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no", city: "Oslo" },
    "Eksempel Regnskap",
    "Regnskap som gir deg bedre oversikt",
    "Vi hjelper små bedrifter med regnskap og lønn"
  );
  assert.ok(result.subject?.includes("Eksempel Regnskap AS"));
  assert.ok(result.draftBody?.includes("Regnskap som gir deg bedre oversikt"));
  assert.ok(result.draftBody?.includes("konkret mulighet til å forbedre"));
  assert.ok(result.draftBody?.includes("Skal jeg sende deg ideen?"));
  assert.ok(result.subject?.includes("En idé til nettsiden"));
  assert.equal(result.personalizationEvidence, "Regnskap som gir deg bedre oversikt");
});

test("createPersonalizedDraft does not invent website-specific facts when no evidence exists", () => {
  const result = createPersonalizedDraft({ companyName: "Eksempel AS" });
  assert.equal(result.draftBody, undefined);
  assert.equal(result.subject, undefined);
  assert.ok(result.notes.length > 0);
});

test("createPersonalizedDraft names a concrete improvement from website audit signals", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
    "Eksempel Regnskap",
    "Regnskap for små bedrifter",
    "Vi hjelper små bedrifter med regnskap og lønn",
    {
      companyName: "Eksempel Regnskap AS",
      websiteUrl: "https://example.no",
      checkedAt: "2026-10-01T00:00:00.000Z",
      status: "AUDITED",
      flags: ["MISSING_META_DESCRIPTION"],
      metaDescription: undefined
    }
  );
  assert.ok(result.draftBody?.includes("forbedre hvordan nettsiden presenteres i søkeresultater"));
  assert.ok(result.draftBody?.includes("Skal jeg sende deg ideen?"));
});
