import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchDeps } from "../src/integrations/research-deps.js";

test("no configuration: no providers and visible OFF notices", () => {
  const { deps, notices } = buildResearchDeps({});
  assert.deepEqual(Object.keys(deps.providers), []);
  assert.equal(notices.filter((n) => n.includes("OFF")).length, 2);
});

test("gateway needs both URL and token; partial or invalid config stays off and says why", () => {
  for (const env of [{ AGENT_GATEWAY_URL: "https://g.example.com" }, { AGENT_GATEWAY_TOKEN: "x".repeat(30) }]) {
    const { deps, notices } = buildResearchDeps(env);
    assert.equal(deps.providers.jev, undefined);
    assert.ok(notices.some((n) => n.includes("incomplete configuration")));
  }
  const invalid = buildResearchDeps({ AGENT_GATEWAY_URL: "http://g.example.com", AGENT_GATEWAY_TOKEN: "x".repeat(30) });
  assert.equal(invalid.deps.providers.browserUse, undefined);
  assert.ok(invalid.notices.some((n) => n.includes("MUST_BE_HTTPS")));
});

test("complete config wires Firecrawl and both browser paths; notices never contain secrets", () => {
  const token = "s".repeat(30);
  const { deps, notices } = buildResearchDeps({ FIRECRAWL_API_KEY: "fc-secret-value", AGENT_GATEWAY_URL: "https://g.example.com", AGENT_GATEWAY_TOKEN: token });
  assert.ok(deps.providers.firecrawl && deps.providers.jev && deps.providers.browserUse);
  assert.ok(notices.every((n) => !n.includes(token) && !n.includes("fc-secret-value") && !n.includes("g.example.com")));
});
