import assert from "node:assert/strict";
import test from "node:test";
import { countLiteRowsCreatedSince } from "../src/lite/airtable-queue.js";

test("new Lite rows are counted over all pages with a created-time formula", async () => {
  const urls: string[] = [];
  const pages = [{ records: [{ id: "rec1", fields: {} }, { id: "rec2", fields: {} }], offset: "o1" }, { records: [{ id: "rec3", fields: {} }] }];
  const fetchImpl = (async (url: URL) => { urls.push(String(url)); return new Response(JSON.stringify(pages[urls.length - 1])); }) as unknown as typeof fetch;
  const cfg = { apiToken: "t", baseId: "appX", tableName: "Leads", fetchImpl };
  assert.equal(await countLiteRowsCreatedSince(cfg, 24), 3);
  assert.match(new URL(urls[0]!).searchParams.get("filterByFormula")!, /CREATED_TIME\(\), DATEADD\(NOW\(\), -24, 'hours'\)/);
  assert.match(urls[1]!, /offset=o1/);
  await assert.rejects(countLiteRowsCreatedSince(cfg, 0), /hours/);
});
