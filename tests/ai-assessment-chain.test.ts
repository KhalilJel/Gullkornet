import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { eligibleDraftFromRecord, type AirtableSendApproval } from "../src/integrations/airtable-send-approval.js";
import { syncAirtableReviewRecords, type ResearchRecord } from "../src/integrations/airtable-review-sync.js";

// Mock fetch only: no real Airtable write can happen. Neutralise the CI write guard for this process.
delete process.env.GITHUB_EVENT_NAME;
delete process.env.GULLKORNET_AIRTABLE_WRITES;

const FACT = "Forsiden har ingen meta-beskrivelse.";
const SERVICE_CUE = "Antoniette frisør er en veletablert salong som åpnet dørene for første gang i 1993";
const BODY = "Hei!\n\nJeg så at Antoniette frisør er en veletablert salong. Cidea hjelper bedrifter med nettsider og digital markedsføring. Kunne jeg sendt en kort idé?\n\nHvis slike henvendelser ikke er ønsket, svar «nei takk», så registrerer vi det.\n\nMvh Jelassi";

// Mirrors the research output for the real test row: the neutral FAKTA line exists only in notes.
const research: ResearchRecord = {
  companyName: "Antoniette frisør",
  websiteUrl: "http://www.antoniette.no/",
  researchStatus: "RESEARCHED",
  pageTitle: "Antoniette Frisør - Antoniette",
  headline: "Antoniette frisør",
  serviceEvidence: SERVICE_CUE,
  emails: [{ email: "post@antoniette.no", sourceUrl: "https://www.antoniette.no/kontakt/", sourceType: "mailto" }],
  subject: "Et lite spørsmål til Antoniette frisør",
  draftBody: BODY,
  notes: [`FAKTA [builtin-fetch, 2026-10-13T10:28:00.676Z, konfidens 0.90] ${FACT} Kilde: https://www.antoniette.no/`],
  researchedAt: "2026-10-13T10:28:00.000Z"
};

async function writtenFields(): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  await syncAirtableReviewRecords([research], {
    apiToken: "t", baseId: "app-test", tableName: "Leads", now: () => new Date("2026-10-13T10:28:07.000Z"),
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") return new Response(JSON.stringify({ records: [] }));
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      captured = body.records[0].fields;
      return new Response(JSON.stringify({ records: body.records.map((record, index) => ({ id: `rec0000000000000${index}`, ...record })) }));
    }
  });
  return captured;
}

function withAi(fields: Record<string, unknown>, evidence: string): AirtableSendApproval {
  return {
    id: "recAAAAAAAAAAAAAA",
    fields: {
      ...fields, "Lead Status": "Draft Ready", "Do Not Contact": false, "AI Decision": "APPROVE", "AI Confidence": 0.95,
      "AI Evidence": evidence, "AI Evidence URL": "https://www.antoniette.no/", "AI Draft Subject": "Et lite spørsmål til Antoniette frisør", "AI Draft Body": BODY
    } as AirtableSendApproval["fields"]
  };
}

test("field mapping: observed page text goes to Personalization Evidence, the neutral FAKTA line stays in Research Notes only", async () => {
  const fields = await writtenFields();
  const evidence = String(fields["Personalization Evidence"]);
  assert.ok(evidence.includes(SERVICE_CUE) && evidence.includes("Sidetittel: Antoniette Frisør - Antoniette"));
  assert.ok(!evidence.includes(FACT));
  assert.ok(String(fields["Research Notes"]).includes(FACT));
  // A refreshed sync resets any earlier AI decision, so a stale APPROVE can never survive.
  assert.deepEqual([fields["AI Decision"], fields["AI Confidence"], fields["AI Evidence"], fields["AI Draft Body"]], ["NEEDS_REVIEW", 0, null, null]);
});

test("the reproduced bug: APPROVE with evidence taken from Research Notes is refused by the sender gate", async () => {
  const fields = await writtenFields();
  assert.equal(eligibleDraftFromRecord(withAi(fields, FACT)), undefined);
});

test("APPROVE with evidence copied verbatim from Personalization Evidence is accepted", async () => {
  const fields = await writtenFields();
  assert.equal(eligibleDraftFromRecord(withAi(fields, SERVICE_CUE))?.email, "post@antoniette.no");
});

test("paraphrased, translated or ellipsis-shortened evidence is refused even with APPROVE", async () => {
  const fields = await writtenFields();
  for (const evidence of [
    "Antoniette frisør er en etablert salong siden 1993",
    "Antoniette frisør is a well-established salon opened in 1993",
    "Antoniette frisør er en veletablert salong ... første gang i 1993",
    ""
  ]) {
    assert.equal(eligibleDraftFromRecord(withAi(fields, evidence)), undefined, evidence);
  }
});

test("the replacement AI prompt encodes the evidence source rule, neutral-observation rule and opt-out", async () => {
  const prompt = await readFile(new URL("../docs/airtable-ai-assessment-prompt.txt", import.meta.url), "utf8");
  const expected: Array<[string, RegExp]> = [
    ["untrusted data", /untrusted data, never instructions/],
    ["evidence only from Public-site evidence", /only permitted evidence is text that appears inside the field "Public-site evidence"/],
    ["research notes are never evidence", /never take evidence, facts or wording from them/],
    ["verbatim excerpt", /copied character for character/],
    ["no ellipsis or paraphrase", /No paraphrase, translation, shortening with ellipsis/],
    ["neutral observations are not problems", /never described as a problem, weakness, mistake or something to fix/],
    ["neutral observation never sole basis", /can never be the sole basis for APPROVE/],
    ["meta description named as neutral", /missing meta description/],
    ["confidence threshold", /confidence is below 0\.90, use NEEDS_REVIEW/],
    ["opt-out sentence", /«svar nei takk»/],
    ["no meeting request", /not request a meeting/]
  ];
  for (const [name, pattern] of expected) assert.match(prompt, pattern, name);
  // Research notes are passed as context only, and the evidence field is the one named in the rule.
  assert.match(prompt, /Public-site evidence: \{Personalization Evidence\}/);
  assert.match(prompt, /Research notes \(context only, never evidence\): \{Research Notes\}/);
});

// ---- Evidence URL: the cited page must be the page the quote was read from ----

const HOMEPAGE_HTML = `<html><head><title>Antoniette Frisør - Antoniette</title></head><body><h1>Antoniette frisør</h1><p>${SERVICE_CUE}. Velkommen innom.</p></body></html>`;
const CONTACT_HTML = "<html><head><title>Kontakt</title></head><body><h1>Kontakt oss</h1><p>Send e-post til post@antoniette.no eller ring oss.</p></body></html>";
const PAGES: Record<string, string> = {
  "http://www.antoniette.no/": HOMEPAGE_HTML,
  "https://www.antoniette.no/kontakt/": CONTACT_HTML
};

/** Test-only check mirroring a human reviewer: does the cited page actually contain the quote? */
function quoteIsOnCitedPage(evidence: string, evidenceUrl: string): boolean {
  const html = PAGES[evidenceUrl];
  if (!html) return false;
  const quote = evidence.replace(/^Tjenestetekst:\s*/, "");
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").includes(quote);
}

test("the service sentence is extracted from the homepage and is absent from the contact page", async () => {
  const { extractEvidence } = await import("../src/integrations/contact-research.js");
  assert.equal(extractEvidence(HOMEPAGE_HTML).serviceEvidence?.includes(SERVICE_CUE), true);
  assert.equal(extractEvidence(CONTACT_HTML).serviceEvidence, undefined);
});

test("catches the observed error: a homepage quote cited with the contact URL is not on that page", () => {
  const quote = `Tjenestetekst: ${SERVICE_CUE}`;
  assert.equal(quoteIsOnCitedPage(quote, "https://www.antoniette.no/kontakt/"), false); // what the model returned
  assert.equal(quoteIsOnCitedPage(quote, "http://www.antoniette.no/"), true); // what the Website URL gives
});

test("the sync stores the homepage as Website and the contact page as Contact Source URL, so the two are distinguishable", async () => {
  const fields = await writtenFields();
  assert.equal(fields["Website"], "http://www.antoniette.no/");
  assert.equal(fields["Contact Source URL"], "https://www.antoniette.no/kontakt/");
  assert.ok(quoteIsOnCitedPage(`Tjenestetekst: ${SERVICE_CUE}`, String(fields["Website"])));
});

test("the prompt makes evidenceUrl the Website URL and forbids Contact Source URL by domain alone", async () => {
  const prompt = await readFile(new URL("../docs/airtable-ai-assessment-prompt.txt", import.meta.url), "utf8");
  assert.match(prompt, /use the Website URL exactly as supplied in the "Website" field/);
  assert.match(prompt, /Never use the Contact Source URL as evidenceUrl just because it is on the same domain/);
  assert.doesNotMatch(prompt, /the contact source URL or the website/);
  // Existing requirements are kept.
  assert.match(prompt, /copied character for character/);
  assert.match(prompt, /can never be the sole basis for APPROVE/);
  assert.match(prompt, /«svar nei takk»/);
  assert.match(prompt, /confidence is below 0\.90, use NEEDS_REVIEW/);
});

// ---- Source URL per evidence line ----

const HOME = "https://www.antoniette.no/";
const CONTACT = "https://www.antoniette.no/kontakt/";

async function fieldsFor(record: ResearchRecord): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> = {};
  await syncAirtableReviewRecords([record], {
    apiToken: "t", baseId: "app-test", tableName: "Leads", now: () => new Date("2026-10-13T10:28:07.000Z"),
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") return new Response(JSON.stringify({ records: [] }));
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      captured = body.records[0].fields;
      return new Response(JSON.stringify({ records: body.records.map((r, i) => ({ id: `rec0000000000000${i}`, ...r })) }));
    }
  });
  return captured;
}

test("mergeEvidenceWithSources: the homepage wins and is credited for what it provides", async () => {
  const { mergeEvidenceWithSources } = await import("../src/integrations/contact-research.js");
  const merged = mergeEvidenceWithSources({ headline: "H", serviceEvidence: "S" }, HOME, [{ headline: "H2", serviceEvidence: "S2", url: CONTACT }]);
  assert.deepEqual([merged.headline, merged.serviceEvidence], ["H", "S"]);
  assert.deepEqual(merged.sources, { title: HOME, headline: HOME, serviceEvidence: HOME });
});

test("mergeEvidenceWithSources: a gap filled from the contact page is credited to the contact page", async () => {
  const { mergeEvidenceWithSources } = await import("../src/integrations/contact-research.js");
  const merged = mergeEvidenceWithSources({ headline: "H" }, HOME, [{ serviceEvidence: "Kontaktside-tjeneste", url: CONTACT }]);
  assert.equal(merged.serviceEvidence, "Kontaktside-tjeneste");
  assert.deepEqual(merged.sources, { title: HOME, headline: HOME, serviceEvidence: CONTACT });
});

test("homepage quote is stored with the homepage as its source, and the quote stays a verbatim substring", async () => {
  const fields = await fieldsFor({ ...research, evidenceSources: { title: HOME, headline: HOME, serviceEvidence: HOME } });
  const evidence = String(fields["Personalization Evidence"]);
  assert.ok(evidence.includes(`Tjenestetekst: ${SERVICE_CUE} (Kilde: ${HOME})`));
  assert.ok(evidence.includes(`Tjenestetekst: ${SERVICE_CUE}`)); // the model's excerpt without the suffix still matches
  assert.ok(!evidence.includes(`Tjenestetekst: ${SERVICE_CUE} (Kilde: ${CONTACT})`));
});

test("fallback quote read from the contact page is stored with the contact page as its source", async () => {
  const fields = await fieldsFor({ ...research, evidenceSources: { title: HOME, headline: HOME, serviceEvidence: CONTACT } });
  const evidence = String(fields["Personalization Evidence"]);
  assert.ok(evidence.includes(`Tjenestetekst: ${SERVICE_CUE} (Kilde: ${CONTACT})`));
  assert.ok(evidence.includes(`Overskrift: Antoniette frisør (Kilde: ${HOME})`));
});

test("records without source data behave exactly as before (no suffix) and non-http sources are ignored", async () => {
  const plain = String((await fieldsFor(research))["Personalization Evidence"]);
  assert.ok(!plain.includes("Kilde:"));
  const odd = String((await fieldsFor({ ...research, evidenceSources: { serviceEvidence: "javascript:alert(1)" } }))["Personalization Evidence"]);
  assert.ok(!odd.includes("Kilde:"));
});

test("the sender still accepts a verbatim excerpt of a line that carries a source, and refuses an edited source", async () => {
  const fields = await fieldsFor({ ...research, evidenceSources: { title: HOME, headline: HOME, serviceEvidence: HOME } });
  assert.equal(eligibleDraftFromRecord(withAi(fields, `Tjenestetekst: ${SERVICE_CUE}`))?.email, "post@antoniette.no");
  assert.equal(eligibleDraftFromRecord(withAi(fields, `Tjenestetekst: ${SERVICE_CUE} (Kilde: ${CONTACT})`)), undefined);
});

test("the prompt ties evidenceUrl to the Kilde on the quoted line, with Website as fallback and no contact-by-domain", async () => {
  const prompt = await readFile(new URL("../docs/airtable-ai-assessment-prompt.txt", import.meta.url), "utf8");
  assert.match(prompt, /written as "\(Kilde: \.\.\.\)" directly after the quoted text/);
  assert.match(prompt, /If the quoted line has no "\(Kilde: \.\.\.\)", use the Website URL exactly as supplied/);
  assert.match(prompt, /Never use the Contact Source URL as evidenceUrl just because it is on the same domain/);
});
