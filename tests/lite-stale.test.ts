import assert from "node:assert/strict";
import test from "node:test";
import { dryRunConfig, dryRunDeps } from "../src/lite/fixtures.js";
import { checkLiteFreshness, mailServerStatus } from "../src/lite/freshness.js";
import { planLiteRetention } from "../src/lite/retention.js";
import { runLiteSend, type LiteQueueRecord } from "../src/lite/send.js";
import { dueRechecks, recheckCount, staleUpdate, writeLiteStatus } from "../src/lite/stale.js";

const NOW = Date.parse("2026-10-19T17:00:00Z");
const DAY = 86_400_000;
const NOTES = "[GK-LITE] source=brreg orgnr=900000001 orgform=AS nace=96.021 kommune=0301";
const code = (c: string) => Object.assign(new Error(c), { code: c });

test("MX: a timing-out recipient domain is temporary while the control resolves; a dead resolver still stops the run", async () => {
  const brokenDomain = async (d: string) => { if (d === "a.example") throw code("ETIMEOUT"); return [{ exchange: "mx.c.example", priority: 1 }]; };
  assert.equal(await mailServerStatus("post@a.example", brokenDomain), "temporary");
  assert.equal(await mailServerStatus("post@a.example", async () => { throw code("ENOTFOUND"); }), "none");
  await assert.rejects(mailServerStatus("post@a.example", async () => { throw code("ETIMEOUT"); }), /Refusing to send/);
  const brreg = (async () => new Response(JSON.stringify({ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" },
    epostadresse: "post@a.example", konkurs: false, underAvvikling: false }))) as unknown as typeof fetch;
  const reason = await checkLiteFreshness(NOTES, "post@a.example", undefined, { fetchImpl: brreg, resolveMxImpl: brokenDomain });
  assert.ok(reason === "DNS_TEMPORARY" || reason === "EMAIL_NOT_REGISTERED", String(reason));
});

test("a definite refusal makes the row Lite Stale; a temporary one Lite Recheck with 1, 3, 7 days, then Lite Stale", () => {
  assert.deepEqual(staleUpdate(NOTES, "NO_MAIL_SERVER", NOW), { status: "Lite Stale", notes: `${NOTES} stale=NO_MAIL_SERVER@2026-10-19` });
  const first = staleUpdate(NOTES, "DNS_TEMPORARY", NOW);
  assert.deepEqual(first, { status: "Lite Recheck", notes: `${NOTES} recheck=1 recheck_after=2026-10-20` });
  const second = staleUpdate(first.notes, "DNS_TEMPORARY", NOW);
  assert.equal(second.notes, `${NOTES} recheck=2 recheck_after=2026-10-22`);
  const third = staleUpdate(second.notes, "DNS_TEMPORARY", NOW);
  assert.equal(third.notes, `${NOTES} recheck=3 recheck_after=2026-10-26`);
  assert.deepEqual(staleUpdate(third.notes, "DNS_TEMPORARY", NOW), { status: "Lite Stale", notes: `${NOTES} stale=DNS_TEMPORARY_REPEATED@2026-10-19` });
  assert.equal(recheckCount(third.notes), 3);
  // A row that recovered and later fails for good keeps no stale recheck tokens.
  assert.equal(staleUpdate(second.notes, "UNIT_GONE", NOW).notes, `${NOTES} stale=UNIT_GONE@2026-10-19`);
});

test("only due, non-DNC Lite Recheck rows are released", () => {
  const r = (id: string, f: Record<string, unknown>): LiteQueueRecord => ({ id, fields: { "Lead Status": "Lite Recheck", ...f } });
  const due = dueRechecks([
    r("recDue", { "Research Notes": `${NOTES} recheck=1 recheck_after=2026-10-19` }),
    r("recLater", { "Research Notes": `${NOTES} recheck=1 recheck_after=2026-10-20` }),
    r("recDnc", { "Research Notes": `${NOTES} recheck=1 recheck_after=2026-10-18`, "Do Not Contact": true }),
    r("recNoDate", { "Research Notes": NOTES }),
    { id: "recReady", fields: { "Lead Status": "Lite Ready", "Research Notes": `${NOTES} recheck_after=2026-10-01` } }
  ], NOW);
  assert.deepEqual(due.map(x => x.id), ["recDue"]);
});

test("the live runner takes refused rows out of the queue; preview never writes", async () => {
  const rows: LiteQueueRecord[] = [
    { id: "recA", fields: { Email: "post@a.example", "Lead Status": "Lite Ready", "Research Notes": NOTES } },
    { id: "recB", fields: { Email: "post@b.example", "Lead Status": "Lite Ready", "Research Notes": NOTES } }
  ];
  const marked: Array<[string, string]> = [];
  const live = dryRunDeps(Date.parse("2026-10-17T08:00:00Z"), rows);
  live.deps.checkFreshness = async email => email.startsWith("post@a") ? "NO_MAIL_SERVER" : undefined;
  live.deps.markStale = async (id, reason) => { marked.push([id, reason]); };
  const summary = await runLiteSend(live.deps, dryRunConfig());
  assert.equal(summary.sent, 1);
  assert.deepEqual(marked, [["recA", "NO_MAIL_SERVER"]]);

  const preview = dryRunDeps(Date.parse("2026-10-17T08:00:00Z"), rows);
  preview.deps.checkFreshness = async () => "NO_MAIL_SERVER";
  preview.deps.markStale = async () => { throw new Error("preview wrote"); };
  assert.equal((await runLiteSend(preview.deps, dryRunConfig(), { preview: true })).skipped.stale, 2);

  // A failed write is logged and the run goes on.
  const flaky = dryRunDeps(Date.parse("2026-10-17T08:00:00Z"), rows);
  flaky.deps.checkFreshness = async email => email.startsWith("post@a") ? "NO_MAIL_SERVER" : undefined;
  flaky.deps.markStale = async () => { throw new Error("HTTP 503"); };
  assert.equal((await runLiteSend(flaky.deps, dryRunConfig())).sent, 1);
});

test("stale and recheck rows are deleted after 90 days like any never-contacted row", () => {
  const firstSeen = new Date(NOW - 91 * DAY).toISOString();
  const plan = planLiteRetention([
    { id: "recS", fields: { "Lead Status": "Lite Stale", "Research Notes": `${NOTES} stale=NO_MAIL_SERVER@2026-07-01`, "First Seen": firstSeen } },
    { id: "recR", fields: { "Lead Status": "Lite Recheck", "Research Notes": `${NOTES} recheck=1 recheck_after=2026-07-02`, "First Seen": firstSeen } },
    { id: "recNew", fields: { "Lead Status": "Lite Stale", "Research Notes": NOTES, "First Seen": new Date(NOW - 5 * DAY).toISOString() } }
  ], NOW);
  assert.deepEqual(plan.actions.map(a => [a.id, a.action]), [["recS", "delete"], ["recR", "delete"]]);
});

test("status write is verified, limited to Lite statuses and refused from pull-request runs", async () => {
  const update = { status: "Lite Stale", notes: `${NOTES} stale=UNIT_GONE@2026-10-19` };
  const cfg = { apiToken: "t", baseId: "appAAAAAAAAAAAAAA", tableName: "Leads",
    fetchImpl: (async () => new Response(JSON.stringify({ id: "recA", fields: { "Lead Status": update.status, "Research Notes": update.notes } }))) as typeof fetch };
  await writeLiteStatus(cfg, "recA", update, {});
  await assert.rejects(writeLiteStatus(cfg, "recA", update, { GITHUB_EVENT_NAME: "pull_request" }), /DISABLED/);
  await assert.rejects(writeLiteStatus(cfg, "recA", { ...update, status: "Sent" }, {}), /Unexpected/);
  await assert.rejects(writeLiteStatus({ ...cfg, fetchImpl: (async () => new Response("{}")) as typeof fetch }, "recA", update, {}), /verified/);
});
