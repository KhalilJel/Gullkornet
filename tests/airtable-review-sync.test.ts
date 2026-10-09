import assert from "node:assert/strict";
import test from "node:test";
import { syncAirtableReviewRecords, type ResearchRecord } from "../src/integrations/airtable-review-sync.js";

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
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({ records: patchBody.records.map((record) => ({ id: record.id, fields: record.fields })) });
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
