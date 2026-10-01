import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateLeads, normalizeDomain, normalizeEmail } from "../src/domain/dedupe.js";
import type { Lead } from "../src/domain/lead.js";

const makeLead = (id: string, websiteUrl?: string, contactEmail?: string): Lead => ({
  id,
  companyName: `Company ${id}`,
  websiteUrl,
  contactEmail,
  city: "Oslo",
  industry: "Regnskapsbyrå",
  status: "NEW",
  evidence: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z"
});

test("normalizes domain protocol, path, case, and www", () => {
  assert.equal(normalizeDomain("HTTPS://WWW.Example.no/services"), "example.no");
});

test("normalizes email case and whitespace", () => {
  assert.equal(normalizeEmail("  SALES@Example.no "), "sales@example.no");
});

test("keeps the first lead and flags duplicates by domain or email", () => {
  const result = deduplicateLeads([
    makeLead("1", "https://www.example.no", "post@example.no"),
    makeLead("2", "http://example.no/contact", "other@example.no"),
    makeLead("3", "https://different.no", "post@example.no"),
    makeLead("4", "https://unique.no", "hello@unique.no")
  ]);

  assert.deepEqual(result.uniqueLeads.map((lead) => lead.id), ["1", "4"]);
  assert.deepEqual(result.duplicates, [
    { keptLeadId: "1", duplicateLeadId: "2", matchedOn: "domain" },
    { keptLeadId: "1", duplicateLeadId: "3", matchedOn: "email" }
  ]);
});
