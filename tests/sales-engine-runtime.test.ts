import assert from "node:assert/strict";
import test from "node:test";
import { parseKeeLeadSearch, parseKeeLeadVerification, createAirtableSuppressionChecker, formatWebsiteAuditEvidence } from "../src/integrations/sales-engine-runtime.js";

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
          { fields: { Email: "suppressed@example.no", "Do Not Contact": false, "Lead Status": "Suppressed" } },
          { fields: { Email: "replied@example.no", "Do Not Contact": false, "Lead Status": "Replied" } }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(await checker("stop@example.no"), true);
  assert.equal(await checker("ok@example.no"), false);
  assert.equal(await checker("suppressed@example.no"), true);
  assert.equal(await checker("replied@example.no"), true);
  assert.equal(requests, 1);
});

test("Airtable suppression checker fails closed when configuration is missing", async () => {
  const checker = createAirtableSuppressionChecker({ apiToken: "", baseId: "" });
  await assert.rejects(() => checker("hello@example.no"), /AIRTABLE_SUPPRESSION_NOT_CONFIGURED/);
});

test("rejects non-HTTP schemes and credential-bearing website URLs", () => {
  const leads = parseKeeLeadSearch({
    leads: [
      { company: "FTP Example AS", website: "ftp://example.no", email: "a@example.no" },
      { company: "Credential Example AS", website: "https://user:pass@example.no", email: "b@example.no" },
      { company: "Valid Example AS", website: "www.example.no", email: "c@example.no" }
    ]
  });
  assert.equal(leads.length, 3);
  assert.equal(leads[0]?.website, undefined);
  assert.equal(leads[1]?.website, undefined);
  assert.equal(leads[2]?.website, "https://www.example.no/");
});

test("formats website audit findings with provenance and explicit automated-signal labels", () => {
  const evidence = formatWebsiteAuditEvidence({
    companyName: "Example AS", websiteUrl: "https://example.no", checkedAt: "2026-10-09T10:00:00.000Z",
    status: "AUDITED", httpStatus: 200, finalUrl: "https://example.no/", https: true, title: "Example",
    flags: ["MISSING_META_DESCRIPTION"], note: "Automated signals only"
  });
  assert.ok(evidence.some((item) => item.includes("checked at 2026-10-09T10:00:00.000Z")));
  assert.ok(evidence.some((item) => item.includes("final URL: https://example.no/")));
  assert.ok(evidence.some((item) => item.includes("Automated website signal (requires human verification): MISSING_META_DESCRIPTION")));
});

test("website audit evidence does not invent a final URL or HTTP status when absent", () => {
  const evidence = formatWebsiteAuditEvidence({
    companyName: "Example AS", websiteUrl: "https://example.no", checkedAt: "2026-10-09T10:00:00.000Z",
    status: "FETCH_ERROR", flags: ["FETCH_ERROR"]
  });
  assert.ok(!evidence.some((item) => item.includes("final URL:")));
  assert.ok(!evidence.some((item) => item.includes("HTTP status:")));
  assert.ok(evidence.some((item) => item.includes("status: FETCH_ERROR")));
});

test("suppression lookup fails closed and can retry after a transient persistence error", async () => {
  let requests = 0;
  const checker = createAirtableSuppressionChecker({
    apiToken: "test-token",
    baseId: "app-test",
    tableName: "Leads",
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
      return new Response(JSON.stringify({
        records: [{ fields: { Email: "stop@example.no", "Do Not Contact": true } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  await assert.rejects(() => checker("stop@example.no"), /AIRTABLE_SUPPRESSION_HTTP_503/);
  assert.equal(await checker("stop@example.no"), true);
  assert.equal(requests, 2);
});

