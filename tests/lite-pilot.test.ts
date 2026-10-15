import assert from "node:assert/strict";
import test from "node:test";
import { auditLiteRows } from "../src/lite/audit.js";
import { dryRunConfig, dryRunDeps, dryRunResearch } from "../src/lite/fixtures.js";
import { checkBrregStillValid, checkLiteFreshness, hasMailServer } from "../src/lite/freshness.js";
import { runLiteReplySync } from "../src/lite/replies.js";
import { assertLiteRecipientApproved, LiteRefusedError, runLiteSend, type LiteQueueRecord } from "../src/lite/send.js";

const SATURDAY_10_OSLO = Date.parse("2026-10-17T08:00:00Z");
const NOTES = "[GK-LITE] source=brreg orgnr=900000001 orgform=AS nace=96.021 kommune=0301";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const unit = (extra: Record<string, unknown> = {}) => ({
  organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" }, epostadresse: "post@a.example", ...extra
});
const brreg = (body: unknown, status = 200) => (async () => json(body, status)) as unknown as typeof fetch;
const row = (id: string, fields: Record<string, unknown>): LiteQueueRecord => ({
  id, fields: { "Lead Status": "Lite Ready", "Research Notes": NOTES, ...fields }
});

// ---------- Send-time freshness ----------

test("Brreg re-check refuses deleted, inactive, re-formed or re-addressed companies", async () => {
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg(unit())), undefined);
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg({}, 410)), "UNIT_GONE");
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg({}, 404)), "UNIT_GONE");
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg(unit({ slettedato: "2026-10-01" }))), "UNIT_GONE");
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg(unit({ konkurs: true }))), "UNIT_INACTIVE");
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg(unit({ underAvvikling: true }))), "UNIT_INACTIVE");
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg(unit({ organisasjonsform: { kode: "ENK" } }))), "ORG_FORM_CHANGED");
  assert.equal(await checkBrregStillValid(NOTES, "post@a.example", undefined, brreg(unit({ epostadresse: "kontakt@a.example" }))), "EMAIL_NOT_REGISTERED");
  assert.equal(await checkBrregStillValid("[GK-LITE] source=brreg orgform=AS", "post@a.example", undefined, brreg(unit())), "NO_ORGNR");
  // Places leads got their address from the website, not Brreg: only the company is re-checked.
  const places = NOTES.replace("source=brreg", "source=places");
  assert.equal(await checkBrregStillValid(places, "post@a.example", undefined, brreg(unit({ epostadresse: undefined }))), undefined);
});

test("a Brreg outage is never read as 'still valid'", async () => {
  await assert.rejects(checkBrregStillValid(NOTES, "post@a.example", undefined, brreg({}, 503)), /Refusing to send/);
});

test("MX check: no domain, no MX or null MX refuses; a DNS outage throws", async () => {
  const fail = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(await hasMailServer("post@a.example", async () => [{ exchange: "mx.a.example", priority: 10 }]), true);
  assert.equal(await hasMailServer("post@a.example", async () => [{ exchange: ".", priority: 0 }]), false);
  assert.equal(await hasMailServer("post@a.example", async () => []), false);
  assert.equal(await hasMailServer("post@a.example", fail("ENOTFOUND")), false);
  assert.equal(await hasMailServer("post@a.example", fail("ENODATA")), false);
  await assert.rejects(hasMailServer("post@a.example", fail("ETIMEOUT")), /Refusing to send/, "resolver down: control fails too");
  // A broken recipient domain (SERVFAIL) while the control domain resolves: skip the row, keep the run going.
  const brokenDomain = async (domain: string) => {
    if (domain === "a.example") throw Object.assign(new Error("ESERVFAIL"), { code: "ESERVFAIL" });
    return [{ exchange: "mx.control.example", priority: 10 }];
  };
  assert.equal(await hasMailServer("post@a.example", brokenDomain), false);
  assert.equal(await checkLiteFreshness(NOTES, "post@a.example", undefined, {
    fetchImpl: brreg(unit()), resolveMxImpl: async () => []
  }), "NO_MAIL_SERVER");
});

test("the sender skips stale rows and stops when the freshness check is unavailable", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [row("recA", { Email: "post@a.example" }), row("recB", { Email: "post@b.example" })]);
  run.deps.checkFreshness = async email => email === "post@a.example" ? "UNIT_INACTIVE" : undefined;
  const summary = await runLiteSend(run.deps, dryRunConfig());
  assert.equal(summary.skipped.stale, 1);
  assert.deepEqual(run.outbox.map(o => o.email.to), ["post@b.example"]);
  assert.equal(run.state.get("recA")?.fields["Lead Status"], "Lite Ready", "a stale row is not claimed");

  const outage = dryRunDeps(SATURDAY_10_OSLO, [row("recA", { Email: "post@a.example" })]);
  outage.deps.checkFreshness = async () => { throw new Error("Brreg lookup failed (HTTP 503). Refusing to send."); };
  await assert.rejects(runLiteSend(outage.deps, dryRunConfig()), /503/);
  assert.equal(outage.outbox.length, 0);
});

test("preview counts stale rows too and sends nothing", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [row("recA", { Email: "post@a.example" }), row("recB", { Email: "post@b.example" })]);
  run.deps.checkFreshness = async email => email === "post@a.example" ? "NO_MAIL_SERVER" : undefined;
  const summary = await runLiteSend(run.deps, dryRunConfig(), { preview: true });
  assert.equal(summary.skipped.stale, 1);
  assert.equal(summary.eligibleInPreview, 1);
  assert.equal(run.outbox.length, 0);
});

test("pilot: a daily limit of 5 sends at most 5 in a day, whatever the queue", async () => {
  const records = Array.from({ length: 12 }, (_, i) => row(`recP${i}`, { Email: `post@p${i}.example`, "Research Notes": NOTES.replace("900000001", String(900000100 + i)) }));
  const run = dryRunDeps(SATURDAY_10_OSLO, records);
  const cfg = { ...dryRunConfig(), dailyLimit: 5 };
  for (let i = 0; i < 20; i++) { await runLiteSend(run.deps, cfg); run.advance(10 * 60_000); }
  assert.equal(run.outbox.length, 5);
});

// ---------- Sales statuses block every address at the business ----------

test("Interested and Offer Sent block other addresses at the same business", () => {
  const ready = row("recOk1", { Email: "post@a.example" });
  for (const status of ["Interested", "Offer Sent", "Meeting", "Won", "Lost", "Replied"]) {
    assert.throws(() => assertLiteRecipientApproved([ready, row("recOther", { Email: "info@a.example", "Lead Status": status })], "post@a.example"), LiteRefusedError, status);
  }
});

// ---------- Reply sync ----------

test("reply sync looks addresses up in batches, moves answered rows to Replied and stops on an outage", async () => {
  const rows = Array.from({ length: 450 }, (_, i) => row(`rec${i}`, { Email: `post@b${i}.example`, "Lead Status": "Sent" }));
  rows.push(row("recNoEmail", { "Lead Status": "Sent" }));
  const marked: string[] = [];
  const batchSizes: number[] = [];
  const summary = await runLiteReplySync({
    fetchSent: async () => rows,
    hasRepliedBatch: async emails => { batchSizes.push(emails.length); return new Map(emails.map(e => [e, e === "post@b7.example"])); },
    markReplied: async id => { marked.push(id); }
  });
  assert.deepEqual(summary, { checked: 450, replied: 1, noEmail: 1, batches: 3 });
  assert.deepEqual(batchSizes, [200, 200, 50]);
  assert.deepEqual(marked, ["rec7"]);

  const partial: string[] = [];
  await assert.rejects(runLiteReplySync({
    fetchSent: async () => rows,
    hasRepliedBatch: async () => { throw new Error("OpenOutSend reply-status batch failed with HTTP 503."); },
    markReplied: async id => { partial.push(id); }
  }), /503/);
  assert.equal(partial.length, 0);
  await assert.rejects(runLiteReplySync({
    fetchSent: async () => rows.slice(0, 2),
    hasRepliedBatch: async () => new Map([["post@b0.example", false]]),
    markReplied: async () => undefined
  }), /left out/);
});

test("batch reply client fails closed on an incomplete or invalid answer", async () => {
  const { fetchRepliedBatch } = await import("../src/integrations/reply-status.js");
  const env = { OPENOUTREACH_REPLY_STATUS_URL: "https://r.example/v1/reply-status", OPENOUTREACH_REPLY_STATUS_TOKEN: "t" };
  const answer = (body: unknown, status = 200) => (async () => json(body, status)) as unknown as typeof fetch;
  const ok = await fetchRepliedBatch(["Post@A.example", "post@b.example"], env,
    answer({ replied_by_email: { "post@a.example": true, "post@b.example": false }, mode: "read_only_reply_check", send_triggered: false }));
  assert.deepEqual([...ok], [["post@a.example", true], ["post@b.example", false]]);
  await assert.rejects(fetchRepliedBatch(["post@a.example", "post@b.example"], env,
    answer({ replied_by_email: { "post@a.example": false }, mode: "read_only_reply_check", send_triggered: false })), /left out/);
  await assert.rejects(fetchRepliedBatch(["post@a.example"], env,
    answer({ replied_by_email: { "post@a.example": false }, mode: "x", send_triggered: false })), /invalid/);
  await assert.rejects(fetchRepliedBatch(["post@a.example"], env, answer({}, 503)), /503/);
  await assert.rejects(fetchRepliedBatch(["post@a.example"], { ...env, OPENOUTREACH_REPLY_STATUS_URL: "http://r.example/v1/reply-status" }, answer({})), /HTTPS/);
});

test("preview limit: a large queue is checked oldest-first up to the limit, nothing sent", async () => {
  const records = Array.from({ length: 150 }, (_, i) => row(`recQ${i}`, { Email: `post@q${i}.example` }));
  const run = dryRunDeps(SATURDAY_10_OSLO, records);
  const summary = await runLiteSend(run.deps, dryRunConfig(), { preview: true, previewLimit: 100 });
  assert.equal(summary.scanned, 100);
  assert.equal(summary.eligibleInPreview, 100);
  assert.equal(run.outbox.length, 0);
});

test("capacity: 100/day passes config only when the monthly quota covers 31 days", async () => {
  const { loadLiteSendConfig, theoreticalDailyCapacity } = await import("../src/lite/schedule.js");
  const base = { GULLKORNET_LITE_DAILY_LIMIT: "100", GULLKORNET_LITE_HOURLY_LIMIT: "15", GULLKORNET_LITE_MAX_PER_RUN: "5", RESEND_DAILY_QUOTA: "100" };
  assert.throws(() => loadLiteSendConfig({ ...base, RESEND_MONTHLY_QUOTA: "3000" }), /x 31 exceeds RESEND_MONTHLY_QUOTA/);
  const cfg = loadLiteSendConfig({ ...base, RESEND_MONTHLY_QUOTA: "50000" });
  assert.equal(theoreticalDailyCapacity(cfg), 100);
  // Today's plan allows at most 96/day (96 x 31 = 2976 <= 3000).
  assert.equal(theoreticalDailyCapacity(loadLiteSendConfig({ ...base, GULLKORNET_LITE_DAILY_LIMIT: "96", RESEND_MONTHLY_QUOTA: "3000" })), 96);
});

test("capacity: 100 sends in one day across 10-minute runs, never twice to a business, none outside 08-20", async () => {
  const records = Array.from({ length: 140 }, (_, i) => row(`recC${i}`, { Email: `post@c${i}.example`, "Research Notes": NOTES.replace("900000001", String(900001000 + i)) }));
  const start = Date.parse("2026-10-17T05:00:00Z"); // 07:00 Oslo
  const run = dryRunDeps(start, records);
  const cfg = { ...dryRunConfig(), dailyLimit: 100, hourlyLimit: 15, maxPerRun: 5, resendDailyQuota: 100 };
  for (let tick = 0; tick < 6 * 16; tick++) { await runLiteSend(run.deps, cfg); run.advance(10 * 60_000); }
  assert.equal(run.outbox.length, 100);
  assert.equal(new Set(run.outbox.map(o => o.email.to)).size, 100, "one email per business");
  assert.equal(new Set(run.outbox.map(o => o.key)).size, 100, "unique idempotency keys");
  const hours = run.ledger.map(e => new Date(e.created_at).getUTCHours() + 2);
  assert.ok(hours.every(h => h >= 8 && h < 20), "inside the Oslo window");
  const sentRows = [...run.state.values()].filter(r => r.fields["Lead Status"] === "Sent");
  assert.equal(sentRows.length, 100);
});

// ---------- Audit ----------

test("audit flags policy, duplicates, research and freshness issues without exposing addresses", () => {
  const research = dryRunResearch(SATURDAY_10_OSLO);
  const index = new Map([[research.segment.key, research]]);
  const all = [
    row("recClean", { Email: "post@clean.example", "Research Notes": NOTES.replace("900000001", "900000010") }),
    row("recNamed", { Email: "ola@named.example", "Research Notes": NOTES.replace("900000001", "900000011") }),
    row("recDupA", { Email: "post@dup.example", "Research Notes": NOTES.replace("900000001", "900000012") }),
    { id: "recDupB", fields: { Email: "info@dup.example", "Lead Status": "Sent" } },
    row("recNoSeg", { Email: "post@noseg.example", "Research Notes": "[GK-LITE] source=brreg orgnr=900000013 orgform=AS nace=47.111 kommune=0301" }),
    row("recStale", { Email: "post@stale.example", "Research Notes": NOTES.replace("900000001", "900000014") }),
    { id: "recWon", fields: { Email: "post@won.example", "Lead Status": "Won", "Paid NOK": 12000 } },
    { id: "recOffer", fields: { Email: "post@offer.example", "Lead Status": "Offer Sent", "Offer NOK": 8000, "Next Step Date": "2026-10-30" } },
    { id: "recLate", fields: { Email: "post@late.example", "Lead Status": "Interested" } }
  ];
  const report = auditLiteRows(all, index, SATURDAY_10_OSLO, new Map([["recStale", "UNIT_INACTIVE"]]));
  assert.equal(report.readyRows, 5);
  assert.equal(report.readyClean, 1);
  assert.deepEqual(report.rowsWithIssues.map(r => r.id).sort(), ["recDupA", "recNamed", "recNoSeg", "recStale"]);
  assert.ok(report.issueCounts.POLICY_PERSONAL_OR_NAMED_ADDRESS);
  assert.ok(report.issueCounts.DUPLICATE_DOMAIN);
  assert.ok(report.issueCounts.NO_RESEARCH);
  assert.ok(report.issueCounts.UNIT_INACTIVE);
  assert.equal(report.paidNok, 12000);
  assert.equal(report.offeredNok, 8000);
  assert.deepEqual(report.overdueFollowUps, ["recLate"]);
  assert.ok(!JSON.stringify(report).includes("@"), "report holds no addresses");
});

test("website intake labels its leads source=website, so the send-time check does not demand the Brreg address", async () => {
  const { toLiteCandidate } = await import("../src/lite/brreg-lite.js");
  const { placesToLiteCandidate } = await import("../src/lite/places-supplement.js");
  const { liteResearchNote } = await import("../src/lite/intake.js");
  const registry = toLiteCandidate({ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" }, hjemmeside: "a.example" })!;
  const lead = placesToLiteCandidate({ companyName: "A AS", websiteUrl: "https://a.example" },
    [{ email: "kontakt@a.example", sourceUrl: "https://a.example/kontakt", sourceType: "mailto" }], registry, undefined, "website");
  assert.equal(lead?.source, "website");
  const notes = liteResearchNote({ ...lead!, email: lead!.email! });
  assert.match(notes, /source=website/);
  // Brreg has no email for this unit; a website lead is still valid at send time.
  assert.equal(await checkBrregStillValid(notes, "kontakt@a.example", undefined, brreg(unit({ epostadresse: undefined }))), undefined);
});

test("domain fingerprints: keyed, stable, and a lookup returns only status for the asked businesses", async () => {
  const { domainFingerprint, lookupFingerprints } = await import("../src/lite/fingerprint.js");
  const fp = domainFingerprint("a.example", "k1");
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(domainFingerprint("WWW.A.example", "k1"), fp);
  assert.notEqual(domainFingerprint("a.example", "k2"), fp, "another key gives another fingerprint");
  const rows = [
    { id: "rec1", fields: { Email: "post@a.example", "Lead Status": "Sent" } },
    { id: "rec2", fields: { Website: "https://www.a.example", "Lead Status": "Draft Ready", "Do Not Contact": true } },
    { id: "rec3", fields: { Email: "post@b.example", "Lead Status": "Lite Ready" } }
  ];
  const result = lookupFingerprints(rows, [fp, domainFingerprint("c.example", "k1"), "not-a-fingerprint"], "k1");
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { fingerprint: fp, statuses: ["Sent", "Draft Ready"], doNotContact: true });
  assert.deepEqual(result[1].statuses, []);
  assert.ok(!JSON.stringify(result).includes("example"), "no domain in the output");
  assert.throws(() => domainFingerprint("a.example", ""), /key/);
});

test("refill buffer: only Lite Ready rows without DNC count toward the buffer target", async () => {
  const { indexFromRecords } = await import("../src/lite/intake.js");
  const index = indexFromRecords([
    { id: "r1", fields: { Email: "post@a.example", "Lead Status": "Lite Ready" } },
    { id: "r2", fields: { Email: "post@b.example", "Lead Status": "Lite Ready", "Do Not Contact": true } },
    { id: "r3", fields: { Email: "post@c.example", "Lead Status": "Sent" } },
    { id: "r4", fields: { Email: "post@d.example", "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] orgnr=900000009" } }
  ]);
  assert.equal(index.readyCount, 2);
  assert.ok(index.organizationNumbers.has("900000009"), "known org numbers are skipped by the website path");
});
