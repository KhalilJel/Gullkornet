import test from "node:test";
import assert from "node:assert/strict";
import { qualifyLead } from "../src/domain/qualification.js";
import type { Lead } from "../src/domain/lead.js";

const baseLead: Lead = {
  id: "1",
  companyName: "Example Regnskap AS",
  websiteUrl: "https://example.no",
  contactEmail: "post@example.no",
  city: "Oslo",
  industry: "Regnskapsbyrå",
  websiteIssue: "WEAK_CONTACT_PATH",
  status: "NEW",
  evidence: [
    {
      sourceUrl: "https://example.no",
      observation: "The homepage does not show a clear enquiry route."
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

test("qualifies a target-area accounting lead with documented opportunity", () => {
  const result = qualifyLead(baseLead);
  assert.equal(result.qualified, true);
  assert.equal(result.fitScore, 100);
  assert.equal(result.missingRequirements.length, 0);
});

test("does not qualify a lead without evidence", () => {
  const result = qualifyLead({ ...baseLead, evidence: [] });
  assert.equal(result.qualified, false);
  assert.ok(result.missingRequirements.includes("Add a source URL and a concrete observation"));
});

test("does not qualify an otherwise complete lead outside the pilot area", () => {
  const result = qualifyLead({ ...baseLead, city: "Bergen" });
  assert.equal(result.qualified, false);
});

test("does not qualify a lead without a specific website opportunity", () => {
  const result = qualifyLead({ ...baseLead, websiteIssue: "NONE" });
  assert.equal(result.qualified, false);
});

test("does not qualify a lead outside the target industry", () => {
  const result = qualifyLead({ ...baseLead, industry: "Restaurant" });
  assert.equal(result.qualified, false);
});
