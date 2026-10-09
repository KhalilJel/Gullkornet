import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLeadQualification } from "../src/integrations/qualification.js";

const goodInput = {
  company: "Example AS",
  website: "https://example.no",
  location: "Bærum, Norway",
  industry: "professional services",
  identityVerified: true,
  evidence: [
    "Automated website signal (requires human verification): MISSING_META_DESCRIPTION",
    "Automated website signal (requires human verification): MISSING_VIEWPORT_META"
  ]
};

test("qualifies an evidenced target-area lead with explainable reasons", () => {
  const result = evaluateLeadQualification(goodInput);
  assert.equal(result.status, "qualified");
  assert.equal(result.score, 90);
  assert.ok(result.reasons.some((reason) => reason.includes("target geography")));
  assert.ok(result.reasons.some((reason) => reason.includes("MISSING_META_DESCRIPTION")));
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("routes missing or weak evidence to human review", () => {
  const result = evaluateLeadQualification({ ...goodInput, evidence: [] });
  assert.equal(result.status, "review_required");
  assert.ok(result.reviewReasons.some((reason) => reason.includes("Evidence is missing or too weak")));
});

test("rejects a lead outside the configured target geography", () => {
  const result = evaluateLeadQualification({ ...goodInput, location: "Trondheim, Norway" });
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("target geographies")));
});

test("rejects direct competitors rather than prioritizing them as prospects", () => {
  const result = evaluateLeadQualification({ ...goodInput, industry: "digital marketing agency" });
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("direct competitor")));
});

test("rejects a researched lead with no supported opportunity signal", () => {
  const result = evaluateLeadQualification({
    ...goodInput,
    evidence: ["The homepage describes the company's services and contact details."]
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("No supported website/digital-presence opportunity")));
});

test("uncertain identity is routed to review even with otherwise strong evidence", () => {
  const result = evaluateLeadQualification({ ...goodInput, identityVerified: false });
  assert.equal(result.status, "review_required");
  assert.ok(result.reviewReasons.some((reason) => reason.includes("not been explicitly verified")));
});

test("unknown geography or industry requires review instead of guessing", () => {
  const result = evaluateLeadQualification({ ...goodInput, location: undefined, industry: undefined });
  assert.equal(result.status, "review_required");
  assert.ok(result.reviewReasons.some((reason) => reason.includes("Geography is unknown")));
  assert.ok(result.reviewReasons.some((reason) => reason.includes("Industry is unknown")));
});

test("suppression always overrides positive qualification signals", () => {
  const result = evaluateLeadQualification({ ...goodInput, suppressed: true });
  assert.equal(result.status, "suppressed");
  assert.equal(result.score, 0);
});
