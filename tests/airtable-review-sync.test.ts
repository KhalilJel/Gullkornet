import assert from "node:assert/strict";
import test from "node:test";
import { getStatus, syncAirtableReviewRecords, type ResearchRecord } from "../src/integrations/airtable-review-sync.js";

// Every test in this file uses an injected mock fetch, so no real Airtable write can happen.
// The production write guard blocks pull_request CI runs, so neutralise the CI event for this process only.
delete process.env.GITHUB_EVENT_NAME;
delete process.env.GULLKORNET_AIRTABLE_WRITES;

const options = {
  apiToken: "test-token",
  baseId: "app-test",
  tableName: "Leads",
  now: () => new Date("2026-10-09T18:10:00.000Z")
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function item(overrides: Partial<ResearchRecord> = {}): ResearchRecord {
  return {
    companyName: "Example AS",
    websiteUrl: "https://www.example.no/about",
    city: "Oslo",
    industry: "professional services",
    sourceUrl: "https://source.example/search",
    researchStatus: "RESEARCHED",
    emails: [{ email: "post@example.no", sourceUrl: "https://example.no/kontakt", sourceType: "mailto" }],
    subject: "Dette la vi merke til hos dere",
    draftBody: "Hei! Dette er et testutkast.",
    personalizationEvidence: "Internal evidence; source URL: https://example.no/",
    notes: ["MANUAL REVIEW: confirm details"],
    researchedAt: "2026-10-09T18:00:00.000Z",
    ...overrides
  };
}

test("paginates existing records and deduplicates input before creating", async () => {
  let getCount = 0;
  let postCount = 0;
  const result = await syncAirtableReviewRecords([
    item({ companyName: "Example AS", websiteUrl: "https://www.example.no/" }),
    item({ companyName: "Example Services AS", websiteUrl: "http://example.no/contact", emails: [] })
  ], {
    ...options,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "GET") {
        getCount += 1;
        if (!url.searchParams.has("offset")) return jsonResponse({ records: [], offset: "page-2" });
        return jsonResponse({ records: [] });
      }
      if (init?.method === "POST") {
        postCount += 1;
        const body = JSON.parse(String(init.body));
        return jsonResponse({ records: body.records.map((record: unknown, index: number) => ({ id: "new-" + index, ...(record as object) })) });
      }
      throw new Error("Unexpected method");
    }
  });

  assert.equal(getCount, 2);
  assert.equal(postCount, 1);
  assert.equal(result.inputRecords, 2);
  assert.equal(result.uniqueBusinesses, 1);
  assert.equal(result.created, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
});

test("repeated sync upserts the same business instead of creating a duplicate", async () => {
  const store: Array<{ id: string; fields: Record<string, unknown> }> = [];
  let postCount = 0;
  let patchCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return jsonResponse({ records: store.map((record) => ({ id: record.id, fields: record.fields })) });
    const body = JSON.parse(String(init?.body));
    if (method === "POST") {
      postCount += 1;
      const records = body.records.map((record: { fields: Record<string, unknown> }, index: number) => ({
        id: "rec-" + (store.length + index + 1),
        fields: record.fields
      }));
      store.push(...records);
      return jsonResponse({ records: records.map((record: { id: string; fields: Record<string, unknown> }) => ({ id: record.id, fields: record.fields })) });
    }
    if (method === "PATCH") {
      patchCount += 1;
      const records = body.records.map((record: { id: string; fields: Record<string, unknown> }) => {
        const current = store.find((item) => item.id === record.id);
        if (current) current.fields = { ...current.fields, ...record.fields };
        return { id: record.id, fields: current?.fields ?? record.fields };
      });
      return jsonResponse({ records });
    }
    throw new Error("Unexpected method");
  };

  const first = await syncAirtableReviewRecords([item()], { ...options, fetchImpl });
  const second = await syncAirtableReviewRecords([item({ draftBody: "Updated draft" })], { ...options, fetchImpl });

  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 1);
  assert.equal(postCount, 1);
  assert.equal(patchCount, 1);
  assert.equal(store.length, 1);
});

test("refreshed research invalidates a previous AI approval and draft", async () => {
  let patchBody: { records: Array<{ fields: Record<string, unknown> }> } | undefined;
  await syncAirtableReviewRecords([item({ draftBody: "Refreshed draft" })], {
    ...options,
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") return jsonResponse({ records: [{
        id: "rec-existing",
        fields: {
          "Duplicate Key": "example.no",
          "Lead Status": "Draft Ready",
          "AI Decision": "APPROVE",
          "AI Confidence": 0.97,
          "AI Evidence": "Old evidence",
          "AI Evidence URL": "https://example.no/old",
          "AI Draft Subject": "Old subject",
          "AI Draft Body": "Old body"
        }
      }] });
      if (init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({ records: patchBody?.records.map((record) => ({ id: "rec-existing", fields: record.fields })) });
      }
      throw new Error("Unexpected method");
    }
  });

  const fields = patchBody?.records[0]?.fields;
  assert.equal(fields?.["AI Decision"], "NEEDS_REVIEW");
  assert.equal(fields?.["AI Confidence"], 0);
  assert.equal(fields?.["AI Evidence"], null);
  assert.equal(fields?.["AI Evidence URL"], null);
  assert.equal(fields?.["AI Draft Subject"], null);
  assert.equal(fields?.["AI Draft Body"], null);
});

test("preserves sent, replied, suppressed, and do-not-contact states and outreach history", async () => {
  const existing = [
    { id: "sent", fields: { "Duplicate Key": "sent.no", "Lead Status": "Sent", Email: "old@sent.no", "Outreach Subject": "Old sent subject", "Outreach Draft": "Old sent draft", "Research Notes": "sent history" } },
    { id: "replied", fields: { "Duplicate Key": "replied.no", "Lead Status": "Replied", Email: "old@replied.no", "Outreach Subject": "Old reply subject", "Outreach Draft": "Old reply draft" } },
    { id: "suppressed", fields: { "Duplicate Key": "suppressed.no", "Lead Status": "Suppressed", Email: "old@suppressed.no", "Outreach Subject": "Keep this", "Outreach Draft": "Keep this draft" } },
    { id: "dnc", fields: { "Duplicate Key": "dnc.no", "Lead Status": "Do Not Contact", "Do Not Contact": true, Email: "old@dnc.no", "Outreach Subject": "Never overwrite", "Outreach Draft": "Never overwrite draft" } }
  ];
  let patchBody: { records: Array<{ id: string; fields: Record<string, unknown> }> } | undefined;
  const result = await syncAirtableReviewRecords([
    item({ companyName: "Sent Co", websiteUrl: "https://sent.no", emails: [{ email: "new@sent.no", sourceUrl: "https://sent.no/contact" }] }),
    item({ companyName: "Replied Co", websiteUrl: "https://replied.no", emails: [{ email: "new@replied.no", sourceUrl: "https://replied.no/contact" }] }),
    item({ companyName: "Suppressed Co", websiteUrl: "https://suppressed.no", emails: [{ email: "new@suppressed.no", sourceUrl: "https://suppressed.no/contact" }] }),
    item({ companyName: "DNC Co", websiteUrl: "https://dnc.no", emails: [{ email: "new@dnc.no", sourceUrl: "https://dnc.no/contact" }] })
  ], {
    ...options,
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") return jsonResponse({ records: existing });
      if (init?.method === "PATCH") {
        const body: { records: Array<{ id: string; fields: Record<string, unknown> }> } = JSON.parse(String(init.body));
        patchBody = body;
        return jsonResponse({ records: body.records.map((record) => ({ id: record.id, fields: record.fields })) });
      }
      throw new Error("Unexpected method");
    }
  });

  assert.equal(result.updated, 4);
  const byId = new Map(patchBody?.records.map((record) => [record.id, record.fields]));
  for (const [id, status] of [["sent", "Sent"], ["replied", "Replied"], ["suppressed", "Suppressed"], ["dnc", "Do Not Contact"]]) {
    const fields = byId.get(id);
    assert.equal(fields?.["Lead Status"], status);
    assert.equal(fields?.Email, undefined);
    assert.equal(fields?.["Outreach Subject"], undefined);
    assert.equal(fields?.["Outreach Draft"], undefined);
  }
  assert.equal(byId.get("dnc")?.["Do Not Contact"], true);
});

test("retries transient read failures but never blindly retries writes", async () => {
  let getCount = 0;
  let postCount = 0;
  const result = await syncAirtableReviewRecords([item()], {
    ...options,
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        getCount += 1;
        if (getCount === 1) return jsonResponse({ error: "temporary" }, 503);
        return jsonResponse({ records: [] });
      }
      if (init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ records: [{ id: "created-1" }] });
      }
      throw new Error("Unexpected method");
    }
  });

  assert.equal(getCount, 2);
  assert.equal(postCount, 1);
  assert.equal(result.created, 1);
});

test("surfaces persistence failure without retrying an ambiguous create", async () => {
  let postCount = 0;
  await assert.rejects(
    () => syncAirtableReviewRecords([item()], {
      ...options,
      fetchImpl: async (_input, init) => {
        if (init?.method === "GET") return jsonResponse({ records: [] });
        if (init?.method === "POST") {
          postCount += 1;
          return jsonResponse({ error: "failed" }, 503);
        }
        throw new Error("Unexpected method");
      }
    }),
    /AIRTABLE_REQUEST_FAILED status=503/
  );
  assert.equal(postCount, 1);
});

test("fails before network access when Airtable credentials are missing", async () => {
  let called = false;
  await assert.rejects(
    () => syncAirtableReviewRecords([item()], {
      ...options,
      apiToken: "",
      fetchImpl: async () => { called = true; return jsonResponse({ records: [] }); }
    }),
    /AIRTABLE_SYNC_NOT_CONFIGURED/
  );
  assert.equal(called, false);
});

// ---- Draft Ready only for a shared business inbox (pilot run 38409346860: a named address became Draft Ready) ----

const ready = (email: string): Partial<ResearchRecord> => ({
  websiteUrl: "https://www.salong.no/", notes: [], emails: [{ email, sourceUrl: "https://www.salong.no/kontakt" }]
});

test("a shared business inbox with a draft is Draft Ready", () => {
  for (const email of ["post@salong.no", "kontakt@salong.no", "info@salong.no", "booking@salong.no"]) {
    assert.equal(getStatus(item(ready(email))), "Draft Ready", email);
  }
});

test("a named or personal address with a draft is Needs Review, never Draft Ready", () => {
  for (const email of ["pia@salong.no", "kari.nordmann@salong.no", "post@gmail.com", "salong@hotmail.com"]) {
    assert.equal(getStatus(item(ready(email))), "Needs Review", email);
  }
});

test("a refresh without a new address still checks the stored address", () => {
  const existing = (email: string) => ({ id: "rec-existing", fields: { "Lead Status": "Draft Ready", Email: email } });
  assert.equal(getStatus(item({ ...ready("post@salong.no"), emails: [] }), existing("pia@salong.no")), "Needs Review");
  assert.equal(getStatus(item({ ...ready("post@salong.no"), emails: [] }), existing("post@salong.no")), "Draft Ready");
});

test("protected, DNC and manual-review rules still take precedence over the inbox check", () => {
  const withStatus = (status: string, dnc = false) => ({ id: "rec-existing", fields: { "Lead Status": status, "Do Not Contact": dnc } });
  assert.equal(getStatus(item(ready("post@salong.no")), withStatus("Draft Ready", true)), "Suppressed");
  assert.equal(getStatus(item(ready("pia@salong.no")), withStatus("Do Not Contact", true)), "Do Not Contact");
  assert.equal(getStatus(item(ready("pia@salong.no")), withStatus("Sent")), "Sent");
  assert.equal(getStatus(item(ready("pia@salong.no")), withStatus("Replied")), "Replied");
  assert.equal(getStatus(item({ ...ready("post@salong.no"), notes: ["MANUAL REVIEW: redirect"] })), "Needs Review");
});

test("a sync writes Needs Review for a named address and Draft Ready for a shared inbox", async () => {
  let created: Array<{ fields: Record<string, unknown> }> = [];
  await syncAirtableReviewRecords([
    item({ ...ready("pia@salong.no"), companyName: "Named Co" }),
    item({ ...ready("post@annen.no"), companyName: "Shared Co", websiteUrl: "https://annen.no/" })
  ], {
    ...options,
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") return jsonResponse({ records: [] });
      const body = JSON.parse(String(init?.body));
      created = body.records;
      return jsonResponse({ records: body.records.map((record: object, index: number) => ({ id: "new-" + index, ...record })) });
    }
  });
  const status = new Map(created.map((record) => [record.fields.Company, record.fields["Lead Status"]]));
  assert.equal(status.get("Named Co"), "Needs Review");
  assert.equal(status.get("Shared Co"), "Draft Ready");
});

// ---- Opt-in: create only Draft Ready rows (Airtable record capacity) ----

async function syncCapture(records: ResearchRecord[], existing: Array<{ id: string; fields: Record<string, unknown> }>, createOnlyDraftReady?: boolean) {
  const posted: Array<Record<string, unknown>> = [];
  const patched: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const result = await syncAirtableReviewRecords(records, {
    ...options,
    createOnlyDraftReady,
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") return jsonResponse({ records: existing });
      const body = JSON.parse(String(init?.body));
      if (init?.method === "POST") posted.push(...body.records.map((r: { fields: Record<string, unknown> }) => r.fields));
      if (init?.method === "PATCH") patched.push(...body.records);
      return jsonResponse({ records: body.records.map((r: object, i: number) => ({ id: "rec-" + i, ...r })) });
    }
  });
  return { result, posted, patched };
}

const pilotMix = (): ResearchRecord[] => [
  item({ ...ready("post@salong.no"), companyName: "Ready Co" }),
  item({ ...ready("pia@annen.no"), companyName: "Named Co", websiteUrl: "https://annen.no/" }),
  item({ companyName: "No Mail Co", websiteUrl: "https://nomail.no/", emails: [], notes: [] }),
  item({ companyName: "No Site Co", websiteUrl: undefined, emails: [], notes: [], researchStatus: "NO_WEBSITE" })
];

test("default sync still creates every researched business", async () => {
  const { result, posted } = await syncCapture(pilotMix(), []);
  assert.equal(posted.length, 4);
  assert.equal(result.notCreated, 0);
});

test("createOnlyDraftReady creates only Draft Ready businesses and reports the rest as notCreated", async () => {
  const { result, posted } = await syncCapture(pilotMix(), [], true);
  assert.deepEqual(posted.map((f) => [f.Company, f["Lead Status"]]), [["Ready Co", "Draft Ready"]]);
  assert.equal(result.notCreated, 3);
});

test("createOnlyDraftReady never skips updates: existing, DNC and protected rows are refreshed as before", async () => {
  const existing = [
    { id: "recNamed", fields: { "Duplicate Key": "annen.no", "Lead Status": "Draft Ready", Email: "pia@annen.no" } },
    { id: "recDnc", fields: { "Duplicate Key": "nomail.no", "Lead Status": "Do Not Contact", "Do Not Contact": true } }
  ];
  const { patched, posted } = await syncCapture(pilotMix(), existing, true);
  const byId = new Map(patched.map((r) => [r.id, r.fields]));
  assert.equal(byId.get("recNamed")?.["Lead Status"], "Needs Review"); // a named address is downgraded, not left Draft Ready
  assert.equal(byId.get("recDnc")?.["Lead Status"], "Do Not Contact");
  assert.equal(byId.get("recDnc")?.["Do Not Contact"], true);
  assert.deepEqual(posted.map((f) => f.Company), ["Ready Co"]);
});

// ---- One address, one row (pilot run 38441671019: elafrisor.no and bitina.no shared an address) ----

const shared = (company: string, site: string, email: string): ResearchRecord =>
  item({ companyName: company, websiteUrl: `https://${site}/`, notes: [], emails: [{ email, sourceUrl: `https://${site}/kontakt` }] });

test("no new row for an address an existing row on another domain already holds; that row is not written", async () => {
  const existing = [{ id: "recBitina", fields: { "Duplicate Key": "bitina.no", Company: "Bitina Frisør", Website: "https://bitina.no/", "Lead Status": "Needs Review", Email: " POST@elafrisor.no " } }];
  const { result, posted, patched } = await syncCapture([shared("Ela Frisør", "elafrisor.no", "post@elafrisor.no")], existing);
  assert.equal(posted.length, 0);
  assert.equal(patched.length, 0);
  assert.equal(result.duplicateEmail, 1);
  assert.equal(result.created, 0);
});

test("a protected older row with the same address is never overwritten or downgraded", async () => {
  for (const fields of [
    { "Lead Status": "Sent" }, { "Lead Status": "Replied" }, { "Lead Status": "Do Not Contact", "Do Not Contact": true }, { "Lead Status": "Suppressed" }
  ]) {
    const existing = [{ id: "recOld", fields: { "Duplicate Key": "gammel.no", Email: "post@ny.no", ...fields } }];
    const { posted, patched, result } = await syncCapture([shared("Ny AS", "ny.no", "post@ny.no")], existing, true);
    assert.equal(posted.length, 0, JSON.stringify(fields));
    assert.equal(patched.length, 0, JSON.stringify(fields));
    assert.equal(result.duplicateEmail, 1);
  }
});

test("two new businesses with one address in the same run create only one row", async () => {
  const { posted, result } = await syncCapture([shared("Bitina Frisør", "bitina.no", "post@elafrisor.no"), shared("Ela Frisør", "elafrisor.no", "post@elafrisor.no")], []);
  assert.equal(posted.length, 1);
  assert.equal(result.duplicateEmail, 1);
});

test("a refreshed row never takes an address another row holds, and is not upgraded to Draft Ready", async () => {
  const existing = [
    { id: "recA", fields: { "Duplicate Key": "a.no", Company: "A AS", "Lead Status": "Needs Review" } },
    { id: "recB", fields: { "Duplicate Key": "b.no", Company: "B AS", "Lead Status": "Sent", Email: "post@b.no" } }
  ];
  const { patched, result } = await syncCapture([shared("A AS", "a.no", "post@b.no")], existing);
  assert.deepEqual(patched.map((r) => r.id), ["recA"]);
  assert.equal(patched[0].fields.Email, undefined);
  assert.notEqual(patched[0].fields["Lead Status"], "Draft Ready");
  assert.equal(result.duplicateEmail, 1);
});

test("different addresses are unaffected and a row refreshing its own address is updated as before", async () => {
  const existing = [{ id: "recOwn", fields: { "Duplicate Key": "salong.no", Email: "post@salong.no", "Lead Status": "Draft Ready" } }];
  const { posted, patched, result } = await syncCapture([item(ready("post@salong.no")), shared("Annen AS", "annen.no", "post@annen.no")], existing);
  assert.equal(patched[0].fields.Email, "post@salong.no");
  assert.deepEqual(posted.map((f) => f.Company), ["Annen AS"]);
  assert.equal(result.duplicateEmail, 0);
});

// ---- Protected rows keep their history: identity fields and status are never rewritten ----

const PROTECTED_STATUSES = ["Sent", "Replied", "Approved", "Follow-up", "Contacted", "Meeting", "Won", "Lost", "Suppressed", "Do Not Contact"];
const HISTORY = {
  Company: "Original AS", Website: "https://www.original.no/", City: "Bergen", Industry: "frisør",
  Email: "post@original.no", "Outreach Subject": "Old subject", "Outreach Draft": "Old draft", "First Seen": "2026-09-01T00:00:00.000Z"
};
const refreshed = () => item({ companyName: "Nytt Navn AS", websiteUrl: "https://original.no/ny-side", city: "Oslo", industry: "salong", notes: [],
  emails: [{ email: "post@original.no", sourceUrl: "https://original.no/kontakt" }] });
const ALLOWED_ON_PROTECTED = new Set(["Lead Status", "Last Seen", "Do Not Contact", "Duplicate Key"]);

test("every protected status keeps its status and identity; only Last Seen is refreshed", async () => {
  for (const status of PROTECTED_STATUSES) {
    for (const dnc of [false, true]) {
      const existing = [{ id: "recP", fields: { ...HISTORY, "Duplicate Key": "original.no", "Lead Status": status, ...(dnc ? { "Do Not Contact": true } : {}) } }];
      const { patched, posted } = await syncCapture([refreshed()], existing);
      const label = `${status}${dnc ? " + DNC" : ""}`;
      assert.equal(posted.length, 0, label);
      const fields = patched[0].fields;
      assert.equal(fields["Lead Status"], status, label); // e.g. Replied + DNC stays Replied, never Suppressed
      assert.ok(fields["Last Seen"], label);
      for (const name of Object.keys(fields)) assert.ok(ALLOWED_ON_PROTECTED.has(name), `${label}: wrote ${name}`);
      assert.equal("Duplicate Key" in fields, false, `${label}: an existing key is not rewritten`);
      assert.equal(fields["Do Not Contact"], dnc ? true : undefined, label);
    }
  }
});

test("a DNC-flagged row that is not yet contacted is still marked Suppressed and keeps its identity", async () => {
  const existing = [{ id: "recD", fields: { ...HISTORY, "Duplicate Key": "original.no", "Lead Status": "Draft Ready", "Do Not Contact": true } }];
  const { patched } = await syncCapture([refreshed()], existing);
  assert.equal(patched[0].fields["Lead Status"], "Suppressed");
  assert.equal(patched[0].fields["Do Not Contact"], true);
  for (const name of ["Company", "Website", "City", "Industry", "Email", "Outreach Draft", "AI Decision"]) assert.equal(name in patched[0].fields, false, name);
});

test("a protected legacy row without a Duplicate Key only gets the key filled in", async () => {
  const existing = [{ id: "recL", fields: { ...HISTORY, "Lead Status": "Replied" } }];
  const { patched } = await syncCapture([refreshed()], existing);
  assert.equal(patched[0].fields["Duplicate Key"], "original.no");
  assert.equal(patched[0].fields.Company, undefined);
  assert.equal(patched[0].fields.Website, undefined);
});

test("a protected row without First Seen does not get one from a later research run", async () => {
  const { "First Seen": _omitted, ...withoutFirstSeen } = HISTORY;
  for (const status of PROTECTED_STATUSES) {
    const existing = [{ id: "recF", fields: { ...withoutFirstSeen, "Duplicate Key": "original.no", "Lead Status": status } }];
    const { patched } = await syncCapture([refreshed()], existing);
    const fields = patched[0].fields;
    assert.equal("First Seen" in fields, false, status);
    for (const name of Object.keys(fields)) assert.ok(ALLOWED_ON_PROTECTED.has(name), `${status}: wrote ${name}`);
    assert.equal(fields["Lead Status"], status);
  }
  // DNC flag on a not-yet-contacted row: same rule.
  const dnc = [{ id: "recF2", fields: { ...withoutFirstSeen, "Duplicate Key": "original.no", "Lead Status": "Draft Ready", "Do Not Contact": true } }];
  const fields = (await syncCapture([refreshed()], dnc)).patched[0].fields;
  assert.deepEqual(Object.keys(fields).sort(), ["Do Not Contact", "Last Seen", "Lead Status"]);
});

test("new rows and unprotected rows without First Seen still get it", async () => {
  const created = (await syncCapture([refreshed()], [])).posted[0];
  assert.equal(created["First Seen"], "2026-10-09T18:00:00.000Z");
  const { "First Seen": _omitted, ...withoutFirstSeen } = HISTORY;
  const existing = [{ id: "recU2", fields: { ...withoutFirstSeen, "Duplicate Key": "original.no", "Lead Status": "Needs Review" } }];
  assert.equal((await syncCapture([refreshed()], existing)).patched[0].fields["First Seen"], "2026-10-09T18:00:00.000Z");
});

test("unprotected rows are refreshed exactly as before", async () => {
  const existing = [{ id: "recU", fields: { ...HISTORY, "Duplicate Key": "original.no", "Lead Status": "Needs Review" } }];
  const { patched } = await syncCapture([refreshed()], existing);
  const fields = patched[0].fields;
  assert.deepEqual([fields.Company, fields.Website, fields.City, fields.Industry, fields["Duplicate Key"]], ["Nytt Navn AS", "https://original.no/ny-side", "Oslo", "salong", "original.no"]);
  assert.equal(fields["AI Decision"], "NEEDS_REVIEW");
  assert.equal(fields["First Seen"], undefined); // kept
});

test("matches legacy CRM rows without a Duplicate Key using the website domain", async () => {
  let postCount = 0;
  let patchCount = 0;
  const result = await syncAirtableReviewRecords([item({ websiteUrl: "https://www.example.no/new-path" })], {
    ...options,
    fetchImpl: async (_input, init) => {
      if (init?.method === "GET") {
        return jsonResponse({ records: [{
          id: "legacy",
          fields: { Company: "Example AS", Website: "https://example.no/old-path", "Lead Status": "Needs Review" }
        }] });
      }
      if (init?.method === "POST") {
        postCount += 1;
        return jsonResponse({ records: [] });
      }
      if (init?.method === "PATCH") {
        patchCount += 1;
        const body = JSON.parse(String(init.body));
        assert.equal(body.records[0].id, "legacy");
        return jsonResponse({ records: [{ id: "legacy", fields: body.records[0].fields }] });
      }
      throw new Error("Unexpected method");
    }
  });

  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(postCount, 0);
  assert.equal(patchCount, 1);
});

