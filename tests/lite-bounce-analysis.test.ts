import assert from "node:assert/strict";
import test from "node:test";
import { analyzeBounces, bounceFeatures, mxFamily } from "../src/lite/bounce-analysis.js";

test("bounce features are coarse and carry no address or domain", () => {
  const f = bounceFeatures("Post@Example.no", "[GK-LITE] source=website orgnr=1", "https://www.example.no/", ["mx1.domeneshop.no"]);
  assert.deepEqual(f, { localPart: "role", domainMatchesWebsite: "yes", freemail: "no", source: "website", mxProvider: "domeneshop" });
  assert.equal(bounceFeatures("ola.nordmann@gmail.com", "", undefined, []).localPart, "personal");
  assert.equal(bounceFeatures("ola.nordmann@gmail.com", "", undefined, []).freemail, "yes");
  assert.equal(bounceFeatures("ola.nordmann@gmail.com", "", undefined, []).domainMatchesWebsite, "no_website");
  assert.equal(bounceFeatures("x@other.no", "", "example.no", undefined).domainMatchesWebsite, "no");
  assert.equal(mxFamily(undefined), "lookup_failed");
  assert.equal(mxFamily(["example-no.mail.protection.outlook.com"]), "microsoft");
  assert.equal(mxFamily(["aspmx.l.google.com."]), "google");
  for (const value of Object.values(f)) assert.doesNotMatch(value, /example|@/);
});

test("analysis reports failure rate per feature value", () => {
  const role = bounceFeatures("post@a.no", "source=brreg", "a.no", ["mx.one.com"]);
  const personal = bounceFeatures("kari.hansen@b.no", "source=website", "c.no", ["mx.one.com"]);
  const lines = analyzeBounces([{ features: role, failed: false }, { features: role, failed: false }, { features: personal, failed: true }]);
  const local = lines.filter(l => l.feature === "localPart");
  assert.deepEqual(local.map(l => [l.value, l.sent, l.failed]), [["personal", 1, 1], ["role", 2, 0]]);
  assert.equal(lines.find(l => l.feature === "mxProvider")?.rate, 1 / 3);
});
