import test from "node:test";
import assert from "node:assert/strict";
import { qualifyLead } from "../src/domain/qualification.js";
import type { Lead } from "../src/domain/lead.js";

const baseLead: Lead = {
  id: "1",
  companyName: "Example AS",
  websiteUrl: "https://example.no",
  contactEmail: "post@example.no",
  city: "Oslo",
  industry: "Restaurant",
  status: "NEW",
  evidence: [
    {
      sourceUrl: "https://example.no",
      observation: "Website is publicly reachable"
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

test("qualifies a lead with sufficient evidence", () => {
  const result = qualifyLead(baseLead);
  assert.equal(result.qualified, true);
  assert.equal(result.fitScore, 100);
});

test("does not qualify a lead without evidence", () => {
  const result = qualifyLead({ ...baseLead, evidence: [] });
  assert.equal(result.qualified, false);
});
