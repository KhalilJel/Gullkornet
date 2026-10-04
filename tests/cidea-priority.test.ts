import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeCidea } from "../src/domain/cidea-priority.js";

test("high priority when multiple concrete website signals exist", () => {
  const result = prioritizeCidea({
    status: "AUDITED",
    https: false,
    title: "",
    metaDescription: "",
    hasViewportMeta: false,
    hasContactPath: false,
    hasEmailLink: false,
    responseTimeMs: 3200
  });

  assert.equal(result.band, "HIGH");
  assert.equal(result.recommendedService, "Combined");
  assert.equal(result.reviewRequired, true);
  assert.ok(result.reasons.length >= 5);
});

test("seo only when only meta description is missing", () => {
  const result = prioritizeCidea({
    status: "AUDITED",
    https: true,
    title: "Regnskap",
    metaDescription: "",
    hasViewportMeta: true,
    hasContactPath: true,
    hasEmailLink: true,
    responseTimeMs: 700
  });

  assert.equal(result.recommendedService, "SEO");
  assert.equal(result.band, "MEDIUM");
});

test("unassessed website always requires review", () => {
  const result = prioritizeCidea({ status: "FETCH_ERROR" });
  assert.equal(result.score, 0);
  assert.equal(result.recommendedService, "Review required");
  assert.equal(result.reviewRequired, true);
});
