import assert from "node:assert/strict";
import test from "node:test";
import { fetchPilotPreviewRows } from "../src/lite/airtable-queue.js";
import { parsePilotPreviewIds } from "../src/lite/pilot-preview.js";

test("pilot selection rejects empty, injected, duplicate and oversized selections", () => {
  for (const input of ["", "recA,", "recA,recA", "recA');TRUE()", "recA,recB,recC,recD,recE,recF"]) {
    assert.throws(() => parsePilotPreviewIds(input), /1-5 unique/);
  }
  assert.deepEqual(parsePilotPreviewIds("recB, recA"), ["recB", "recA"]);
});

test("exact preview reads blocked rows too and preserves selected order with no writes", async () => {
  const fetchImpl = (async (input, options) => {
    assert.equal(options?.method ?? "GET", "GET");
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("filterByFormula"), "OR(RECORD_ID()='recB',RECORD_ID()='recA')");
    return Response.json({ records: [
      { id: "recA", fields: { "Lead Status": "Replied", "Do Not Contact": true } },
      { id: "recB", fields: { "Lead Status": "Lite Ready" } }
    ] });
  }) as typeof fetch;
  const rows = await fetchPilotPreviewRows({ apiToken: "fake", baseId: "appFake", tableName: "Leads", fetchImpl }, ["recB", "recA"]);
  assert.deepEqual(rows.map(row => row.id), ["recB", "recA"]);
  assert.equal(rows[1].fields["Do Not Contact"], true);
});

test("missing, unexpected, duplicate or paginated pilot rows fail closed", async () => {
  for (const payload of [
    { records: [] }, { records: [{ id: "recOther", fields: {} }] },
    { records: [{ id: "recA", fields: {} }], offset: "more" },
    { records: [{ id: "recA", fields: {} }, { id: "recA", fields: {} }] }
  ]) {
    const fetchImpl = (async () => Response.json(payload)) as typeof fetch;
    await assert.rejects(fetchPilotPreviewRows({ apiToken: "fake", baseId: "appFake", tableName: "Leads", fetchImpl }, ["recA"]), /No substitution/);
  }
});
