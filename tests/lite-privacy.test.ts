import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dryRunConfig, dryRunDeps } from "../src/lite/fixtures.js";
import {
  airtableRetentionWriter, executeLiteRetention, MINIMIZE_CLEAR_FIELDS, minimizedNotes, planLiteRetention, sentDateFromNotes, withSentDate
} from "../src/lite/retention.js";
import { runLiteSend, type LiteQueueRecord } from "../src/lite/send.js";
import { assertLiteTemplateCompliant, LITE_TEMPLATE, LITE_TEMPLATE_VERSION } from "../src/lite/template.js";
import { LITE_TEMPLATE_PROPOSAL } from "../src/lite/template-proposal.js";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const DAY = 86_400_000;
const NOTES = "[GK-LITE] source=brreg orgnr=900000001 orgform=AS nace=96.210 kommune=0301 template=2026-10-14.2";
const row = (id: string, fields: Record<string, unknown>): LiteQueueRecord => ({ id, fields: { "Research Notes": NOTES, ...fields } });
const iso = (ms: number) => new Date(ms).toISOString();

// ---------- Retention plan ----------

test("retention: never-contacted rows older than 90 days are deleted, younger and undated ones kept", () => {
  const plan = planLiteRetention([
    row("recOld", { "Lead Status": "Lite Ready", "First Seen": iso(NOW - 91 * DAY) }),
    row("recNew", { "Lead Status": "Lite Ready", "First Seen": iso(NOW - 89 * DAY) }),
    row("recNoDate", { "Lead Status": "Lite Ready" })
  ], NOW);
  assert.deepEqual(plan.actions, [{ id: "recOld", action: "delete", reason: "NEVER_CONTACTED_EXPIRED" }]);
  assert.deepEqual(plan.undated, ["recNoDate"]);
});

test("retention: a sent row is minimised (never deleted) 90 days after sending, so it is never emailed again", () => {
  const plan = planLiteRetention([
    row("recSentOld", { "Lead Status": "Sent", "Research Notes": withSentDate(`${NOTES} research=x`, NOW - 100 * DAY) }),
    row("recSentNew", { "Lead Status": "Sent", "Research Notes": withSentDate(`${NOTES} research=x`, NOW - 10 * DAY) }),
    row("recSentUndated", { "Lead Status": "Sent" })
  ], NOW);
  assert.deepEqual(plan.actions.map(a => [a.id, a.action, a.reason]), [["recSentOld", "minimize", "SENT_NO_REPLY_EXPIRED"]]);
  assert.deepEqual(plan.undated, ["recSentUndated"]);
});

test("retention: reservations are minimised at once and keep the org number; active sales are kept", () => {
  const plan = planLiteRetention([
    row("recDnc", { "Lead Status": "Sent", "Do Not Contact": true }),
    row("recSupp", { "Lead Status": "Suppressed" }),
    ...["Replied", "Interested", "Meeting", "Offer Sent", "Won", "Lost"].map((s, i) => row(`recKeep${i}`, { "Lead Status": s, "First Seen": iso(NOW - 400 * DAY) })),
    { id: "recAdvanced", fields: { "Lead Status": "Draft Ready", "First Seen": iso(NOW - 400 * DAY) } }
  ], NOW);
  assert.deepEqual(plan.actions.map(a => [a.id, a.action, a.reason]), [["recDnc", "minimize", "RESERVATION"], ["recSupp", "minimize", "RESERVATION"]]);
  const notes = (plan.actions[0] as { notes: string }).notes;
  assert.equal(notes, "[GK-LITE] orgnr=900000001 retention=RESERVATION minimized=2026-10-14");
  assert.equal(plan.keptActive.length, 6);
  assert.equal(planLiteRetention([row("recDnc", { "Do Not Contact": true, "Research Notes": notes })], NOW).alreadyMinimized, 1, "idempotent");
  assert.match(minimizedNotes(NOTES, "RESERVATION", NOW), /orgnr=900000001/, "intake de-duplication still sees the org number");
});

// ---------- Execution gate ----------

test("retention changes nothing without the owner switch, and minimises before deleting", async () => {
  const plan = planLiteRetention([
    row("recOld", { "Lead Status": "Lite Ready", "First Seen": iso(NOW - 120 * DAY) }),
    row("recDnc", { "Do Not Contact": true })
  ], NOW);
  const calls: string[] = [];
  const writer = { deleteRecords: async (ids: string[]) => { calls.push(`delete:${ids.join(",")}`); }, minimizeRecord: async (id: string) => { calls.push(`minimize:${id}`); } };
  await assert.rejects(executeLiteRetention(plan, writer, {}), /Nothing was changed/);
  await assert.rejects(executeLiteRetention(plan, writer, { GULLKORNET_LITE_RETENTION_EXECUTE: "yes" }), /Nothing was changed/);
  await assert.rejects(executeLiteRetention(plan, writer, { GULLKORNET_LITE_RETENTION_EXECUTE: "true", GITHUB_EVENT_NAME: "pull_request" }), /WRITES_DISABLED/);
  assert.deepEqual(calls, []);
  const result = await executeLiteRetention(plan, writer, { GULLKORNET_LITE_RETENTION_EXECUTE: "true" });
  assert.deepEqual(calls, ["minimize:recDnc", "delete:recOld"]);
  assert.deepEqual(result, { deleted: 1, minimized: 1 });
});

test("Airtable writer: minimise keeps Email, Lead Status, DNC and Duplicate Key; delete batches by ID", async () => {
  const requests: Array<{ url: string; method?: string; body?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method, body: init?.body as string | undefined });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const writer = airtableRetentionWriter({ apiToken: "t", baseId: "appAAAAAAAAAAAAAA", tableName: "Leads", fetchImpl });
  await writer.minimizeRecord("recA", "[GK-LITE] orgnr=900000001 retention=RESERVATION minimized=2026-10-14");
  const fields = JSON.parse(requests[0].body!).fields;
  for (const kept of ["Email", "Lead Status", "Do Not Contact", "Duplicate Key"]) assert.equal(kept in fields, false, kept);
  for (const cleared of MINIMIZE_CLEAR_FIELDS) assert.equal(fields[cleared], null, cleared);
  await writer.deleteRecords(["recA", "recB"]);
  assert.equal(requests[1].method, "DELETE");
  assert.match(requests[1].url, /records%5B%5D=recA&records%5B%5D=recB$/);
  await assert.rejects(writer.deleteRecords([]), /Invalid/);
});

// ---------- Sender stamps the send date ----------

test("the sender writes sent=<date> on the claimed row, which retention counts from", async () => {
  const run = dryRunDeps(Date.parse("2026-10-17T08:00:00Z"));
  await runLiteSend(run.deps, dryRunConfig());
  const notes = String(run.state.get("recLiteDry00001")?.fields["Research Notes"]);
  assert.equal(sentDateFromNotes(notes), Date.parse("2026-10-17T00:00:00Z"));
});

// ---------- Template proposal ----------

test("approved template is unchanged; the proposal passes the same guard and is not used by the sender", () => {
  assert.equal(LITE_TEMPLATE_VERSION, "2026-10-14.2");
  assert.equal(LITE_TEMPLATE.subject, "En idé til forbedring hos dere");
  assertLiteTemplateCompliant(LITE_TEMPLATE_PROPOSAL);
  assert.match(LITE_TEMPLATE_PROPOSAL.subject, /^Reklame fra Cidea Marketing/);
  assert.match(LITE_TEMPLATE_PROPOSAL.text, /org\.nr\. 927 394 391/);
  assert.match(LITE_TEMPLATE_PROPOSAL.text, /Enhetsregisteret/);
  assert.ok(LITE_TEMPLATE_PROPOSAL.text.startsWith(LITE_TEMPLATE.text), "approved body kept word for word");
  for (const file of ["src/lite/send.ts", "src/cli/send-lite.ts", "src/lite/template.ts"]) {
    assert.ok(!readFileSync(file, "utf8").includes("template-proposal"), `${file} must not use the proposal`);
  }
});
