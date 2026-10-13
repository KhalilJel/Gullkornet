import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { airtableWritesBlocked } from "../src/domain/airtable-write-guard.js";
import { markAirtableRecipientSent } from "../src/integrations/airtable-send-approval.js";
import { syncAirtableReviewRecords } from "../src/integrations/airtable-review-sync.js";

function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("writes are blocked for pull_request events and explicit disable, allowed otherwise", () => {
  assert.equal(airtableWritesBlocked({ GITHUB_EVENT_NAME: "pull_request" }), true);
  assert.equal(airtableWritesBlocked({ GITHUB_EVENT_NAME: "pull_request_target" }), true);
  assert.equal(airtableWritesBlocked({ GULLKORNET_AIRTABLE_WRITES: "disabled" }), true);
  assert.equal(airtableWritesBlocked({ GITHUB_EVENT_NAME: "workflow_dispatch" }), false);
  assert.equal(airtableWritesBlocked({}), false);
});

test("review sync makes no Airtable request of any kind during a pull_request run", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ records: [] }), { status: 200 });
  }) as typeof fetch;
  await withEnv({ GITHUB_EVENT_NAME: "pull_request" }, async () => {
    await assert.rejects(
      syncAirtableReviewRecords([{ companyName: "Example AS", emails: [] }], {
        apiToken: "tok", baseId: "appAAAAAAAAAAAAAA", tableName: "Leads", fetchImpl
      }),
      /AIRTABLE_WRITES_DISABLED/
    );
  });
  assert.deepEqual(calls, []);
});

test("marking a recipient Sent is refused during a pull_request run", async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  try {
    await assert.rejects(
      markAirtableRecipientSent("recAAAAAAAAAAAAAA", {
        GITHUB_EVENT_NAME: "pull_request",
        AIRTABLE_API_TOKEN: "tok",
        GULLKORNET_AIRTABLE_BASE_ID: "appAAAAAAAAAAAAAA"
      }),
      /AIRTABLE_WRITES_DISABLED/
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(called, false);
});

test("every pull_request workflow that has the Airtable token disables Airtable writes and cannot send", async () => {
  const dir = new URL("../.github/workflows/", import.meta.url);
  const offenders: string[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".yml"))) {
    const text = (await readFile(new URL(name, dir), "utf8")).replace(/\r\n/g, "\n");
    if (!/^\s{2}pull_request(_target)?:/m.test(text)) continue;
    assert.doesNotMatch(text, /secrets\.(RESEND_API_KEY|GULLKORNET_ENABLE_LIVE_SEND)|inputs\.sync_to_airtable|send:(email|daily)/, `${name} must not be able to send or sync on PRs`);
    if (/AIRTABLE_API_TOKEN/.test(text) &&
        !/GULLKORNET_AIRTABLE_WRITES: \$\{\{ github\.event_name == 'pull_request' && 'disabled' \|\| 'enabled' \}\}/.test(text)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(offenders, [], "pull_request workflows holding the Airtable token must disable writes");
});

test("no workflow uploads raw prospect contact data or drafts as an artifact", async () => {
  const dir = new URL("../.github/workflows/", import.meta.url);
  const forbidden = /contact-research-drafts\.json|sales-engine-review-queue\.json|sales-engine-rejected\.json|reviewed-queue|outbound-preview|\.stderr\.log|\.stdout\.log|suppressed-emails/;
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".yml"))) {
    const text = (await readFile(new URL(name, dir), "utf8")).replace(/\r\n/g, "\n");
    const steps = text.split(/\n(?=\s+- name:)/).filter((step) => step.includes("actions/upload-artifact"));
    for (const step of steps) {
      const path = step.match(/\n\s+path:\s*(\|\s*\n(?:\s{12,}.+\n?)+|.+)/)?.[1] ?? "";
      assert.doesNotMatch(path, forbidden, `${name} uploads raw prospect data`);
    }
  }
});

test("no workflow receives the OpenOutSend ingest token; reply checks use the read-only token", async () => {
  const dir = new URL("../.github/workflows/", import.meta.url);
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".yml"))) {
    const text = (await readFile(new URL(name, dir), "utf8")).replace(/\r\n/g, "\n");
    assert.doesNotMatch(text, /secrets\.OPENOUTREACH_INGEST_TOKEN/, `${name} must not use the ingest token`);
  }
  const send = (await readFile(new URL("daily-outreach.yml", dir), "utf8")).replace(/\r\n/g, "\n");
  assert.match(send, /OPENOUTREACH_REPLY_STATUS_TOKEN: \$\{\{ secrets\.OPENOUTREACH_REPLY_STATUS_TOKEN \}\}/);
});
