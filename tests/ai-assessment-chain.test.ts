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
