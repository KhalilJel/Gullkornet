import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_ROUTER_POLICY } from "../src/integrations/research-router.js";
import { runSmoke } from "../src/integrations/smoke-core.js";

const LONG = "x".repeat(500);

test("smoke passes with at least one firecrawl:ok and reports no content", async () => {
  let n = 0;
  const report = await runSmoke(["https://a.example/", "https://b.example/"], {
    firecrawl: async (url) => { n += 1; if (n === 1) throw new Error("FIRECRAWL_HTTP_401"); return { url, markdown: LONG }; }
  }, { ...DEFAULT_ROUTER_POLICY, timeoutMs: 1000 });
  assert.equal(report.passed, true);
  assert.equal(report.counts["firecrawl:ok"], 1);
  assert.ok(report.lines.every((line) => !line.includes("xxxx")));
});

test("smoke fails when Firecrawl never succeeds", async () => {
  const report = await runSmoke(["https://a.example/"], { firecrawl: async () => { throw new Error("FIRECRAWL_HTTP_401"); } }, DEFAULT_ROUTER_POLICY);
  assert.equal(report.passed, false);
});

test("smoke workflow is manual-only and exposes only the Firecrawl secret", async () => {
  const wf = (await readFile(new URL("../.github/workflows/agent-smoke.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(wf, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(wf, /^  (schedule|push|pull_request|workflow_run):/m);
  const secrets = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).filter((s) => s !== "GITHUB_TOKEN");
  assert.deepEqual([...new Set(secrets)], ["FIRECRAWL_API_KEY"]);
  assert.doesNotMatch(wf, /AIRTABLE|RESEND|OPENOUTREACH|GULLKORNET_ENABLE_LIVE_SEND/);
});
