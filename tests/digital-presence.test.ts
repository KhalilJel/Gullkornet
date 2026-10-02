import test from "node:test";
import assert from "node:assert/strict";
import { extractSocialProfiles, researchDigitalPresence } from "../src/integrations/digital-presence.js";

test("extracts supported social links and resolves relative links safely", () => {
  const html = `
    <a href="https://www.instagram.com/example.no/">Instagram</a>
    <a href='https://facebook.com/example'>Facebook</a>
    <a href="https://www.linkedin.com/company/example/">LinkedIn</a>
    <a href="https://example.no/kontakt">Kontakt</a>
    <a href="https://facebook.com/example">Facebook duplicate</a>
    <a href="javascript:alert(1)">Ignore</a>
  `;
  const profiles = extractSocialProfiles(html, "https://example.no");
  assert.deepEqual(profiles.map((item) => item.platform), ["facebook", "instagram", "linkedin"]);
  assert.equal(profiles.filter((item) => item.platform === "facebook").length, 1);
});

test("does not classify a missing Google Places website as proven website absence", async () => {
  const result = await researchDigitalPresence({ companyName: "Eksempel AS", city: "Oslo" });
  assert.equal(result.segment, "NO_WEBSITE_LISTED");
  assert.equal(result.suggestedService, "WEBSITE");
  assert.ok(result.notes.some((note) => note.includes("does not prove")));
  assert.deepEqual(result.socialProfiles, []);
});

test("does not claim social accounts are absent when homepage has no social links", () => {
  const profiles = extractSocialProfiles('<a href="https://example.no/kontakt">Kontakt</a>', "https://example.no");
  assert.deepEqual(profiles, []);
});


test("ignores generic template social profile links", () => {
  const html = `
    <a href="https://facebook.com/yoururl">Facebook template</a>
    <a href="https://www.instagram.com/hjemmesidehuset/">Website vendor profile</a>
    <a href="https://www.instagram.com/realclinic/">Clinic profile</a>
  `;
  const profiles = extractSocialProfiles(html, "https://example.no");
  assert.deepEqual(profiles.map((item) => item.url), ["https://www.instagram.com/realclinic/"]);
});
