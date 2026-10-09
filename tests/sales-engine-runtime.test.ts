import assert from "node:assert/strict";
import test from "node:test";
import { parseKeeLeadSearch, parseKeeLeadVerification, createAirtableSuppressionChecker } from "../src/integrations/sales-engine-runtime.js";

test("normalizes KeeLead search responses and website domains", () => {
  const leads = parseKeeLeadSearch({
    query: "web design Oslo",
    leads: [
      { id: "abc", company: "Example AS", domain: "example.no", email: "HELLO@example.no" },
      { companyName: "Other AS", website: "https://other.no/about" },
      { company: "", email: "ignored@example.no" },
      null
    ]
  });
  assert.equal(leads.length, 2);
  assert.equal(leads[0]?.id, "abc");
  assert.equal(leads[0]?.website, "https://example.no/");
  assert.equal(leads[0]?.email, "hello@example.no");
  assert.equal(leads[1]?.company, "Other AS");
});

test("rejects malformed KeeLead search payloads", () => {
  assert.throws(() => parseKeeLeadSearch({ leads: "not-an-array" }), /KEELEAD_INVALID_SEARCH_RESPONSE/);
});

test("only accepts explicit, non-disposable email verification", () => {
  assert.equal(parseKeeLeadVerification({ results: [{ email: "hello@example.no", status: "valid" }] }, "hello@example.no").valid, true);
  assert.equal(parseKeeLeadVerification({ results: [{ email: "hello@example.no", status: "unknown" }] }, "hello@example.no").valid, false);
  assert.equal(parseKeeLeadVerification({ results: [{ email: "hello@example.no", valid: true, disposable_email: true }] }, "hello@example.no").valid, false);
  assert.equal(parseKeeLeadVerification({ results: [{ email: "other@example.no", status: "valid" }] }, "hello@example.no").valid, false);
});

test("Airtable suppression checker caches and honors Do Not Contact flags", async () => {
  let requests = 0;
  const checker = createAirtableSuppressionChecker({
    apiToken: "test-token",
    baseId: "app-test",
    tableName: "Leads",
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify({
        records: [
          { fields: { Email: "STOP@example.no", "Do Not Contact": true } },
          { fields: { Email: "ok@example.no", "Do Not Contact": false } },
          { fields: { Email: "suppressed@example.no", "Do Not Contact": false, "Lead Status": "Suppressed" } }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(await checker("stop@example.no"), true);
  assert.equal(await checker("ok@example.no"), false);
  assert.equal(await checker("suppressed@example.no"), true);
  assert.equal(requests, 1);
});

test("Airtable suppression checker fails closed when configuration is missing", async () => {
  const checker = createAirtableSuppressionChecker({ apiToken: "", baseId: "" });
  await assert.rejects(() => checker("hello@example.no"), /AIRTABLE_SUPPRESSION_NOT_CONFIGURED/);
});
