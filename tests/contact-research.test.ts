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
  assert.ok(result.subject?.includes("Eksempel Regnskap AS"));
  assert.ok(result.draftBody?.includes("Regnskap som gir deg bedre oversikt"));
  assert.ok(result.draftBody?.includes("konkret idé"));
  assert.ok(result.draftBody?.includes("Skal jeg sende det?"));
  assert.ok(result.subject?.includes("En idé til nettsiden"));
  assert.equal(result.personalizationEvidence, "Regnskap som gir deg bedre oversikt");
});

test("generic headings fall back to a useful service statement", () => {
  const result = createPersonalizedDraft(
    { companyName: "2R Data og Regnskap", websiteUrl: "https://example.no" },
    "En side under bygging",
    "OM OSS",
    "2R Data og Regnskap tilbyr regnskapsføring, fakturering, lønnskjøring og årsoppgjør.",
    {
      companyName: "2R Data og Regnskap",
      websiteUrl: "https://example.no",
      checkedAt: "2026-10-01T00:00:00.000Z",
      status: "AUDITED",
      flags: ["MISSING_META_DESCRIPTION"],
      metaDescription: undefined
    }
  );
  assert.ok(result.draftBody?.includes("beskrivelsen «"));
  assert.ok(result.draftBody?.includes("regnskapsføring, fakturering, lønnskjøring og årsoppgjør"));
  assert.equal(result.personalizationEvidence, "2R Data og Regnskap tilbyr regnskapsføring, fakturering, lønnskjøring og årsoppgjør.");
});

test("company-name headings and navigation-only text do not support a personalized draft", () => {
  const result = createPersonalizedDraft(
    { companyName: "A til Å Regnskap AS", websiteUrl: "https://example.no" },
    "atilaa - Hjem",
    "A til Å Regnskap AS",
    "Hjem Søk Søk Hjem Kort om oss Hvem er regnskapspliktig"
  );
  assert.equal(result.draftBody, undefined);
  assert.equal(result.subject, undefined);
  assert.ok(result.notes.some((note) => note.includes("Only a page title was available")));
});


test("draft avoids repeating long service evidence and uses a concrete, concise improvement", () => {
  const longEvidence = "Vi tilbyr regnskap, lønn, årsoppgjør, fakturering, økonomisk rådgivning og hjelp med skatt for små og mellomstore bedrifter i hele regionen.";
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
    "Eksempel Regnskap",
    "OM OSS",
    longEvidence,
    {
      companyName: "Eksempel Regnskap AS",
      websiteUrl: "https://example.no",
      checkedAt: "2026-10-01T00:00:00.000Z",
      status: "AUDITED",
      flags: ["MISSING_META_DESCRIPTION"],
      metaDescription: undefined
    }
  );
  assert.ok(result.draftBody);
  assert.ok(result.personalizationEvidence!.length <= 110);
  assert.ok(result.draftBody!.includes("gjøre søkeresultatet tydeligere"));
  assert.ok(result.draftBody!.includes("Skal jeg sende det?"));
});


test("does not create a draft when the audit has no actionable finding", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
    "Eksempel Regnskap",
    "Regnskap som gir deg bedre oversikt",
    "Vi hjelper små bedrifter med regnskap og lønn",
    {
      companyName: "Eksempel Regnskap AS",
      websiteUrl: "https://example.no",
      checkedAt: "2026-10-01T00:00:00.000Z",
      status: "AUDITED",
      flags: ["NOT_HTTPS"],
      metaDescription: undefined
    }
  );
  assert.equal(result.draftBody, undefined);
  assert.ok(result.notes.some((note) => note.includes("No actionable website audit finding")));
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
  assert.ok(result.draftBody?.includes("gjøre søkeresultatet tydeligere"));
  assert.ok(result.draftBody?.includes("Skal jeg sende det?"));
});

test("does not generate an outreach draft when only a generic page title is available", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
    "Eksempel Regnskap"
  );
  assert.equal(result.draftBody, undefined);
  assert.equal(result.subject, undefined);
  assert.ok(result.notes.some((note) => note.includes("Only a page title was available")));
});
