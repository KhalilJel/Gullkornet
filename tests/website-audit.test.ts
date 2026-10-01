import test from "node:test";
import assert from "node:assert/strict";
import { extractWebsiteSignals, isSafePublicUrl } from "../src/integrations/website-audit.js";

test("extractWebsiteSignals identifies basic website signals", () => {
  const html = `<!doctype html><html><head>
    <title>Eksempel Regnskap</title>
    <meta name="description" content="Regnskap og bokføring for små bedrifter">
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head><body><nav><a href="/kontakt">Kontakt</a><a href="mailto:post@example.no">E-post</a></nav>
  <main><h1>Regnskapstjenester</h1><p>Vi tilbyr bokføring.</p></main></body></html>`;
  const result = extractWebsiteSignals(html);
  assert.equal(result.title, "Eksempel Regnskap");
  assert.equal(result.metaDescription, "Regnskap og bokføring for små bedrifter");
  assert.equal(result.hasViewportMeta, true);
  assert.equal(result.hasContactPath, true);
  assert.equal(result.hasServiceContent, true);
  assert.equal(result.hasEmailLink, true);
  assert.deepEqual(result.flags, []);
});

test("extractWebsiteSignals flags missing metadata and contact signals", () => {
  const result = extractWebsiteSignals("<html><head></head><body><p>Velkommen</p></body></html>");
  assert.equal(result.hasViewportMeta, false);
  assert.equal(result.hasContactPath, false);
  assert.equal(result.hasEmailLink, false);
  assert.ok(result.flags.includes("MISSING_TITLE"));
  assert.ok(result.flags.includes("MISSING_META_DESCRIPTION"));
  assert.ok(result.flags.includes("NO_OBVIOUS_CONTACT_PATH"));
});

test("isSafePublicUrl rejects local and non-web URLs", async () => {
  assert.equal(await isSafePublicUrl("http://localhost:3000"), false);
  assert.equal(await isSafePublicUrl("http://127.0.0.1"), false);
  assert.equal(await isSafePublicUrl("file://example.invalid/page"), false);
  assert.equal(await isSafePublicUrl("https://user:pass@example.com"), false);
  assert.equal(await isSafePublicUrl("http://internal.local"), false);
});
