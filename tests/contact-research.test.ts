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

test("creates an interest-first draft without requiring a concrete website finding", () => {
  const result = createPersonalizedDraft({ companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" });
  assert.equal(result.subject, "Dette la vi merke til hos dere");
  assert.ok(result.draftBody?.includes("Vi kom over bedriften deres og la merke til noen interessante ting vi gjerne ville dele med dere."));
  assert.ok(result.draftBody?.includes("Vi har et par konkrete ideer vi gjerne vil vise dere, og tenkte derfor å høre om det kunne være interessant for dere å ta en titt."));
  assert.ok(result.draftBody?.includes("Mvh Jelassi"));
});

test("website audit signals stay internal and are not stated as customer-facing facts", () => {
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
  assert.ok(!result.draftBody!.includes("metabeskrivelse"));
  assert.ok(!result.draftBody!.includes("En mulig forbedring kan være"));
  assert.ok(!result.draftBody!.includes("øke inntektene"));
  assert.ok(result.notes.some((note) => note.includes("internal research context")));
});

test("does not quote generic headings or long service evidence in outreach", () => {
  const result = createPersonalizedDraft(
    { companyName: "A til Å Regnskap AS", websiteUrl: "https://example.no" },
    "atilaa - Hjem",
    "A til Å Regnskap AS",
    "Vi tilbyr regnskap, lønn, årsoppgjør, fakturering, økonomisk rådgivning og hjelp med skatt for små og mellomstore bedrifter i hele regionen."
  );
  assert.ok(result.draftBody);
  assert.ok(!result.draftBody!.includes("A til Å Regnskap AS Hopp rett"));
  assert.ok(!result.draftBody!.includes("årsoppgjør, fakturering"));
  assert.ok(!result.draftBody!.includes("atilaa - Hjem"));
});

test("uses only supported observed service cues in the draft opener", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel Regnskap AS", websiteUrl: "https://example.no" },
    "Eksempel Regnskap",
    "Regnskap for små bedrifter",
    "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo."
  );
  assert.ok(result.draftBody?.includes("Vi har et par konkrete ideer vi gjerne vil vise dere, og tenkte derfor å høre om det kunne være interessant for dere å ta en titt."));
  assert.ok(result.personalizationEvidence?.includes("approved general Cidea outreach template"));
  assert.equal(result.subject, "Dette la vi merke til hos dere");
});

test("falls back to a general opener when no supported service cue is found", () => {
  const result = createPersonalizedDraft(
    { companyName: "Eksempel AS", websiteUrl: "https://example.no" },
    "Velkommen",
    "Vi hjelper kundene våre",
    "Vi tilbyr fleksible løsninger tilpasset kundene."
  );
  assert.ok(result.draftBody?.includes("Vi kom over bedriften deres og la merke til noen interessante ting vi gjerne ville dele med dere."));
});

test("extracts relevant service evidence while ignoring navigation noise", () => {
  const result = extractEvidence('<html><body><nav>Hjem Kontakt Finn oss 66 96 53 00</nav><main><p>Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.</p></main><footer>Personvern Cookies</footer></body></html>');
  assert.equal(result.serviceEvidence, "Vi tilbyr regnskap, lønn og årsoppgjør for små bedrifter i Oslo.");
});

test("rejects spaced-letter navigation residue inside otherwise relevant service evidence", () => {
  const result = extractEvidence('<html><body><h1>C I F E R O A S - F O R S I D E</h1><main><p>C I F E R O A S - F O R S I D E Varjag Regnskap AS endrer nå navn til Cifero AS.</p></main></body></html>');
  assert.equal(result.serviceEvidence, undefined);
});


test("decodes URL-encoded whitespace and characters in public mailto addresses", () => {
  const html = '<a href="mailto:%20fay.skogstad%40adamogeva.no">Send e-post</a>';
  const emails = extractPublicEmails(html, "https://example.no/kontakt");
  assert.deepEqual(emails.map((item) => item.email), ["fay.skogstad@adamogeva.no"]);
});


test("filters technical Sentry and Wix telemetry addresses from public email results", () => {
  const html = `<p>Contact post@example.no</p>
    <p>/8c4075d5481d476e945486754f783364@sentry.io</p>
    <p>/18d2f96d279149989b95faf0a4b41882@sentry-next.wixpress.com</p>
    <p>/79baaa8e09c746d2b7401643b99792e0@sentry.wixpress.com</p>`;
  const emails = extractPublicEmails(html, "https://example.no/kontakt");
  assert.deepEqual(emails.map((item) => item.email), ["post@example.no"]);
});


test("filters obvious placeholder inboxes while retaining real public addresses", () => {
  const html = `<p>post@bekkestuatannlegesenter.no</p>
    <p>info@website.com</p>
    <p>hello@example.com</p>
    <p>kontakt@clinic-example.no</p>`;
  const emails = extractPublicEmails(html, "https://bekkestuatannlegesenter.no");
  assert.deepEqual(emails.map((item) => item.email).sort(), [
    "kontakt@clinic-example.no",
    "post@bekkestuatannlegesenter.no"
  ]);
});
