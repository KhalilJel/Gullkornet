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
  assert.equal(result.subject, "Dette la vi merke til hos dere");
  assert.ok(result.draftBody?.includes("vi fant ingen egen metabeskrivelse på nettsiden"));
  assert.ok(result.draftBody?.includes("En mulig forbedring kan være å"));
  assert.ok(result.draftBody?.includes("Hvis det er interessant, kan jeg sende en kort forklaring på e-post."));
  assert.ok(result.subject?.includes("Dette la vi merke til hos dere"));
  assert.equal(result.personalizationEvidence, "vi fant ingen egen metabeskrivelse på nettsiden");
});

test("generic headings are ignored in favor of a concrete audit finding", () => {
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
  assert.ok(result.draftBody?.includes("vi fant ingen egen metabeskrivelse på nettsiden"));
  assert.ok(!result.draftBody?.includes("regnskapsføring, fakturering, lønnskjøring og årsoppgjør"));
  assert.equal(result.personalizationEvidence, "vi fant ingen egen metabeskrivelse på nettsiden");
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
  assert.ok(result.notes.some((note) => note.includes("no verified actionable audit finding")));
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
  assert.ok(result.draftBody!.includes("vi fant ingen egen metabeskrivelse på nettsiden"));
  assert.ok(result.draftBody!.includes("Hvis det er interessant, kan jeg sende en kort forklaring på e-post."));
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
  assert.ok(result.notes.some((note) => note.includes("No sufficiently strong, actionable website finding")));
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
  assert.ok(result.draftBody!.includes("Hvis det er interessant, kan jeg sende en kort forklaring på e-post."));
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
  assert.ok(result.draftBody?.includes("vi fant ingen egen metabeskrivelse på nettsiden"));
  assert.ok(result.draftBody?.includes("Hvis det er interessant, kan jeg sende en kort forklaring på e-post."));
});

test("does not generate an outreach draft when only a generic page title is available", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
    "Eksempel Regnskap"
  );
  assert.equal(result.draftBody, undefined);
  assert.equal(result.subject, undefined);
  assert.ok(result.notes.some((note) => note.includes("no verified actionable audit finding")));
});


test("uses a relevant meta description as fallback service evidence", () => {
  const result = extractEvidence('<html><head><meta name="description" content="Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo."></head><body><nav>Hjem Kontakt</nav></body></html>');
  assert.equal(result.serviceEvidence, "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.");
});


test("stripHtml excludes navigation noise and decodes HTML entities in service evidence", () => {
  const result = extractEvidence('<html><body><nav>Hjem Kontakt Finn oss 66 96 53 00</nav><main><p>Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.</p></main><footer>Personvern Cookies</footer></body></html>');
  assert.equal(result.serviceEvidence, "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.");
});

test("spaced-letter and navigation headings are not used as outreach evidence", () => {
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
    assert.ok(result.draftBody);
    assert.ok(!result.draftBody?.includes(headline));
    assert.equal(result.personalizationEvidence, "vi fant ingen egen metabeskrivelse på nettsiden");
  }
});


test("rejects website evidence containing template placeholders or markup residue", () => {
  const result = extractEvidence('<html><body><main><p>atilaa - Hjem {{slideNum}} data-cycle-swipe=true > A til Å regnskap AS Sammen skaper vi vekst</p></main></body></html>');
  assert.equal(result.serviceEvidence, undefined);
});

test("does not quote navigation-heavy or markup-contaminated headlines in drafts", () => {
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
    assert.ok(result.draftBody);
    assert.ok(!result.draftBody?.includes(headline));
  }
});


test("rejects spaced-letter navigation residue inside otherwise relevant service evidence", () => {
  const result = extractEvidence('<html><body><h1>C I F E R O A S - F O R S I D E</h1><main><p>C I F E R O A S - F O R S I D E Varjag Regnskap AS endrer nå navn til Cifero AS.</p></main></body></html>');
  assert.equal(result.serviceEvidence, undefined);
});

test("rejects Norwegian skip-to-content phrases from service evidence", () => {
  const result = extractEvidence('<html><body><main><p>Hopp rett til innholdet. Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.</p></main></body></html>');
  assert.equal(result.serviceEvidence, "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.");
});


test("does not generate outreach from weak technical or email-link signals alone", () => {
  for (const flag of ["NOT_HTTPS", "MISSING_VIEWPORT_META", "NO_EMAIL_LINK_DETECTED", "NO_OBVIOUS_ACCOUNTING_SERVICE_TEXT"]) {
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
        flags: [flag],
        metaDescription: undefined
      }
    );
    assert.equal(result.draftBody, undefined, `Unexpected draft for weak signal: ${flag}`);
  }
});

test("draft leads with the exact audit observation rather than a generic headline", () => {
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
      flags: ["NO_OBVIOUS_CONTACT_PATH", "MISSING_META_DESCRIPTION"],
      metaDescription: undefined
    }
  );
  assert.ok(result.draftBody?.includes("vi fant ikke en tydelig kontakt- eller bestillingslenke"));
  assert.ok(result.draftBody?.includes("gjøre veien til kontakt mer synlig og neste steg enklere"));
  assert.ok(!result.draftBody?.includes("Regnskap som gir deg bedre oversikt"));
});
