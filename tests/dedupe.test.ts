import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateLeads, normalizeDomain, normalizeEmail, normalizeOrganizationNumber } from "../src/domain/dedupe.js";
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

test("normalizes organization numbers and ignores invalid values", () => {
  assert.equal(normalizeOrganizationNumber("999 888 777"), "999888777");
  assert.equal(normalizeOrganizationNumber("123"), undefined);
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

test("deduplicates records with the same organization number", () => {
  const first = { ...makeLead("1"), organizationNumber: "999888777" };
  const second = { ...makeLead("2"), organizationNumber: "999 888 777" };
  const result = deduplicateLeads([first, second]);

  assert.deepEqual(result.uniqueLeads.map((lead) => lead.id), ["1"]);
  assert.deepEqual(result.duplicates, [
    { keptLeadId: "1", duplicateLeadId: "2", matchedOn: "organizationNumber" }
  ]);
});
