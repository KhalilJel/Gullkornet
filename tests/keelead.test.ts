import assert from "node:assert/strict";
import test from "node:test";
import { createKeeLeadClient } from "../src/integrations/keelead.js";

function mockFetch(response: unknown, status = 200): typeof fetch {
  return async (_input, init) => {
    assert.equal(init?.method, "POST");
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
}

test("KeeLead client calls the lead search API", async () => {
  const client = createKeeLeadClient({
    baseUrl: "http://keelead.test",
    fetchImpl: mockFetch({ leads: [{ company: "Example AS" }] })
  });

  const result = await client.searchLeads({
    query: "web design companies",
    count: 5,
    location: "Oslo"
  });

  assert.deepEqual(result, { leads: [{ company: "Example AS" }] });
});

test("KeeLead client exposes enrichment and verification", async () => {
  const client = createKeeLeadClient({
    baseUrl: "http://keelead.test",
    fetchImpl: mockFetch({ ok: true })
  });

  assert.deepEqual(await client.enrichLead({ company: "Example AS" }), { ok: true });
  assert.deepEqual(await client.verifyEmail({ email: "test@example.com" }), { ok: true });
  assert.deepEqual(await client.researchCompany("example.com"), { ok: true });
  assert.deepEqual(await client.scoreLead({ company: "Example AS" }), { ok: true });
});

test("KeeLead client surfaces provider HTTP errors", async () => {
  const client = createKeeLeadClient({
    baseUrl: "http://keelead.test",
    fetchImpl: mockFetch({ error: "bad request" }, 502)
  });

  await assert.rejects(
    () => client.searchLeads({ query: "test" }),
    /KEELEAD_HTTP_502/
  );
});
