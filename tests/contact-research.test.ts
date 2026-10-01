import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicEmails, createPersonalizedDraft, extractEvidence } from "../src/integrations/contact-research.js";

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
  assert.ok(result.draftBody?.includes("liten idé til en mulig forbedring"));
  assert.ok(result.draftBody?.includes("Er du åpen for at jeg sender over ideen i en kort melding?"));
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
  assert.ok(result.draftBody!.includes("mulig forbedring"));
  assert.ok(result.draftBody!.includes("Er du åpen for at jeg sender over ideen i en kort melding?"));
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


test("interest-first draft avoids a sales pitch or unsupported outcome claims", () => {
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
      flags: ["MISSING_META_DESCRIPTION"],
      metaDescription: undefined
    }
  );
  assert.ok(result.draftBody);
  assert.ok(result.draftBody!.includes("Er du åpen for at jeg sender over ideen i en kort melding?"));
  assert.ok(!result.draftBody!.includes("øke inntektene"));
  assert.ok(!result.draftBody!.includes("flere kunder"));
  assert.ok(!result.draftBody!.includes("bestille et møte"));
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
  assert.ok(result.draftBody?.includes("mulig forbedring"));
  assert.ok(result.draftBody?.includes("Er du åpen for at jeg sender over ideen i en kort melding?"));
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


test("uses a relevant meta description as fallback service evidence", () => {
  const result = extractEvidence('<html><head><meta name="description" content="Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo."></head><body><nav>Hjem Kontakt</nav></body></html>');
  assert.equal(result.serviceEvidence, "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.");
});


test("stripHtml excludes navigation noise and decodes HTML entities in service evidence", () => {
  const result = extractEvidence('<html><body><nav>Hjem Kontakt Finn oss 66 96 53 00</nav><main><p>Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.</p></main><footer>Personvern Cookies</footer></body></html>');
  assert.equal(result.serviceEvidence, "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.");
});

test("spaced-letter and navigation headings do not create personalized drafts", () => {
  for (const headline of ["C I F E R O A S - F O R S I D E", "Skip to content 66 96 53 00 post@example.no Finn oss Ansatte"]) {
    const result = createPersonalizedDraft(
      { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
      "Eksempel",
      headline,
      undefined,
      {
        companyName: "Eksempel Regnskap AS",
        websiteUrl: "https://example.no",
        checkedAt: "2026-10-01T00:00:00.000Z",
        status: "AUDITED",
        flags: ["MISSING_META_DESCRIPTION"],
        metaDescription: undefined
      }
    );
    assert.equal(result.draftBody, undefined);
    assert.equal(result.subject, undefined);
  }
});


test("rejects website evidence containing template placeholders or markup residue", () => {
  const result = extractEvidence('<html><body><main><p>atilaa - Hjem {{slideNum}} data-cycle-swipe=true > A til Å regnskap AS Sammen skaper vi vekst</p></main></body></html>');
  assert.equal(result.serviceEvidence, undefined);
});

test("does not create drafts from navigation-heavy or markup-contaminated headlines", () => {
  for (const headline of [
    "A til Å regnskap AS Hopp rett til innholdet",
    "atilaa - Hjem {{slideNum}} data-cycle-swipe=true >",
    "Hjem - Regnskap Group AS - Profesjonell Regnskapsføring"
  ]) {
    const result = createPersonalizedDraft(
      { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
      "Eksempel",
      headline,
      undefined,
      {
        companyName: "Eksempel Regnskap AS",
        websiteUrl: "https://example.no",
        checkedAt: "2026-10-01T00:00:00.000Z",
        status: "AUDITED",
        flags: ["MISSING_META_DESCRIPTION"],
        metaDescription: undefined
      }
    );
    assert.equal(result.draftBody, undefined);
    assert.equal(result.subject, undefined);
  }
});
