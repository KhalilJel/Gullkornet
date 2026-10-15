import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { discoverBrregLiteCandidates, lookupBrregByWebsite, toLiteCandidate } from "../src/lite/brreg-lite.js";
import { DRY_RUN_RECORDS, dryRunConfig, dryRunDeps, dryRunResearch } from "../src/lite/fixtures.js";
import {
  createLiteRecords, emptyIndex, indexFromRecords, liteAirtableFields, LITE_READY_STATUS, selectLiteLeads, type LiteSourceCandidate
} from "../src/lite/intake.js";
import { brregToLiteCandidate, placesToLiteCandidate } from "../src/lite/places-supplement.js";
import { assessLiteRecipient, parseAllowedOrgForms } from "../src/lite/recipient-policy.js";
import {
  assertLiteCapacity, countLedger, isWithinLiteWindow, loadLiteSendConfig, theoreticalDailyCapacity
} from "../src/lite/schedule.js";
import { assertLiteRecipientApproved, liteIdempotencyKey, LiteRefusedError, runLiteSend, withTransientRetry, type LiteQueueRecord } from "../src/lite/send.js";
import { assertLiteTemplateCompliant, LITE_FROM, LITE_TEMPLATE } from "../src/lite/template.js";
import { assessResearch, buildSegmentResearch, decryptResearch, encryptResearch, liteSegment, loadResearchIndex, saveResearch, segmentFromNotes, withResearchRef } from "../src/lite/market-research.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WebsiteAudit } from "../src/integrations/website-audit.js";
import { SendDeferredError } from "../src/integrations/send-schedule.js";

const SATURDAY_10_OSLO = Date.parse("2026-10-17T08:00:00Z"); // CEST, UTC+2
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------- 1. Lead intake ----------

test("Brreg unit maps to a Lite candidate with org form, email and status flags", () => {
  const candidate = toLiteCandidate({
    organisasjonsnummer: "987661739", navn: "ADAM OG EVA FRISØR AS", organisasjonsform: { kode: "AS" },
    hjemmeside: "www.adamogeva.example", epostadresse: " Post@AdamogEva.example ", konkurs: false,
    forretningsadresse: { kommune: "OSLO", kommunenummer: "0301" }, naeringskode1: { kode: "96.021", beskrivelse: "Frisering" }
  });
  assert.equal(candidate?.orgForm, "AS");
  assert.equal(candidate?.email, "post@adamogeva.example");
  assert.equal(candidate?.websiteUrl, "https://www.adamogeva.example");
  assert.equal(candidate?.bankrupt, false);
  assert.equal(toLiteCandidate({ organisasjonsnummer: "123", navn: "X", organisasjonsform: { kode: "AS" } }), undefined);
  assert.equal(toLiteCandidate({ organisasjonsnummer: "987661739", navn: "X AS" }), undefined, "unknown form is dropped");
  assert.equal(toLiteCandidate({ organisasjonsnummer: "987661739", navn: "X AS", organisasjonsform: { kode: "AS" }, slettedato: "2020-01-01" }), undefined);
});

test("Brreg discovery queries only the allowed org form, active companies and SMB size, and stops at the last page", async () => {
  const urls: URL[] = [];
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    urls.push(url);
    return json({
      _embedded: { enheter: [{ organisasjonsnummer: url.searchParams.get("page") === "0" ? "900000001" : "900000002", navn: "A AS", organisasjonsform: { kode: "AS" }, epostadresse: "post@a.example" }] },
      page: { totalPages: 2 }
    });
  }) as typeof fetch;
  const result = await discoverBrregLiteCandidates({ municipalities: ["0301"], orgForms: ["AS"], industryCodes: ["96.021"], pagesPerQuery: 5, fetchImpl });
  assert.equal(urls.length, 2, "stops after totalPages");
  for (const url of urls) {
    assert.equal(url.searchParams.get("organisasjonsform"), "AS");
    assert.equal(url.searchParams.get("konkurs"), "false");
    assert.equal(url.searchParams.get("underAvvikling"), "false");
    assert.equal(url.searchParams.get("underTvangsavviklingEllerTvangsopplosning"), "false");
    assert.equal(url.searchParams.get("naeringskode"), "96.021");
    assert.equal(url.searchParams.get("tilAntallAnsatte"), "249");
  }
  assert.equal(result.length, 2);
});

test("Brreg website lookup accepts only a unique registry match", async () => {
  const unique = (async () => json({ _embedded: { enheter: [{ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" } }] } })) as typeof fetch;
  assert.equal((await lookupBrregByWebsite("https://www.a.example", unique))?.organizationNumber, "900000001");
  let call = 0;
  const twoUnits = (async () => json({ _embedded: { enheter: [{ organisasjonsnummer: call++ === 0 ? "900000001" : "900000002", navn: "A", organisasjonsform: { kode: "AS" } }] } })) as typeof fetch;
  assert.equal(await lookupBrregByWebsite("a.example", twoUnits), undefined);
  const none = (async () => json({})) as typeof fetch;
  assert.equal(await lookupBrregByWebsite("a.example", none), undefined);
  const large = (async () => json({ _embedded: { enheter: [{ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" }, antallAnsatte: 250 }] } })) as typeof fetch;
  assert.equal(await lookupBrregByWebsite("a.example", large), undefined, "250+ employees is not an SMB");
});

test("runner re-checks the window after waiting for spacing", async () => {
  // 19:59:30 Oslo (CEST); the previous email went out 30 s ago, so the runner waits 30 s into 20:00.
  const t = Date.parse("2026-10-17T17:59:30Z");
  const run = dryRunDeps(t, [liteRecord("recA", { Email: "post@a.example" })]);
  run.deps.fetchLedger = async () => [{ created_at: new Date(t - 30_000).toISOString(), to: ["post@other.example"] }];
  const summary = await runLiteSend(run.deps, dryRunConfig());
  assert.equal(summary.stoppedBy, "outside_window");
  assert.equal(run.outbox.length, 0);
});

test("Places supplement needs a registry match and prefers the website's role address", () => {
  const registry = toLiteCandidate({ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" }, epostadresse: "post@a.example" })!;
  const place = { companyName: "A", websiteUrl: "https://a.example", sourceUrl: "https://maps.example/a" };
  assert.equal(placesToLiteCandidate(place, [], undefined), undefined, "no registry match, no lead");
  const chosen = placesToLiteCandidate(place, [
    { email: "ola.nordmann@a.example", sourceUrl: "https://a.example/team", sourceType: "mailto" },
    { email: "kontakt@a.example", sourceUrl: "https://a.example/kontakt", sourceType: "mailto" }
  ], registry);
  assert.equal(chosen?.email, "kontakt@a.example");
  assert.equal(chosen?.contactSourceUrl, "https://a.example/kontakt");
  assert.equal(placesToLiteCandidate(place, [], registry)?.email, "post@a.example", "registry address as fallback");
});

// ---------- 2. ENK and address filtering (markedsføringsloven § 15) ----------

test("recipient policy: ENK, unknown form, named, freemail, mismatching and inactive are all refused", () => {
  const ok = { orgForm: "AS", email: "post@firma.example", websiteUrl: "https://www.firma.example" };
  assert.deepEqual(assessLiteRecipient(ok), { ok: true, email: "post@firma.example" });
  const reason = (input: Parameters<typeof assessLiteRecipient>[0]) => {
    const decision = assessLiteRecipient(input);
    return decision.ok ? "OK" : decision.reason;
  };
  assert.equal(reason({ ...ok, orgForm: "ENK" }), "ORG_FORM_NOT_ALLOWED");
  assert.equal(reason({ ...ok, orgForm: "enk" }), "ORG_FORM_NOT_ALLOWED");
  assert.equal(reason({ ...ok, orgForm: "ANS" }), "ORG_FORM_NOT_ALLOWED");
  assert.equal(reason({ ...ok, orgForm: undefined }), "ORG_FORM_UNKNOWN");
  assert.equal(reason({ ...ok, email: "ola.nordmann@firma.example" }), "PERSONAL_OR_NAMED_ADDRESS");
  assert.equal(reason({ ...ok, email: "kari@firma.example" }), "PERSONAL_OR_NAMED_ADDRESS");
  assert.equal(reason({ ...ok, email: "post@gmail.com", websiteUrl: undefined }), "FREEMAIL");
  assert.equal(reason({ ...ok, email: "post@online.no", websiteUrl: undefined }), "FREEMAIL");
  assert.equal(reason({ ...ok, email: "post@cideamarketing.com", websiteUrl: undefined }), "CIDEA_DOMAIN");
  assert.equal(reason({ ...ok, email: "post@regnskapsbyraa.example" }), "EMAIL_DOMAIN_MISMATCH");
  assert.equal(reason({ ...ok, bankrupt: true }), "COMPANY_INACTIVE");
  assert.equal(reason({ ...ok, windingUp: true }), "COMPANY_INACTIVE");
  assert.equal(reason({ ...ok, email: "" }), "NO_EMAIL");
  assert.equal(reason({ ...ok, email: "post@firma" }), "INVALID_EMAIL");
  assert.equal(reason({ ...ok, websiteUrl: undefined }), "OK", "no website: role address alone is enough");
});

test("ENK can never be configured as an allowed org form", () => {
  assert.deepEqual(parseAllowedOrgForms(undefined), ["AS", "ASA"]);
  assert.deepEqual(parseAllowedOrgForms("as, asa"), ["AS", "ASA"]);
  assert.throws(() => parseAllowedOrgForms("AS,ENK"), /ENK/);
  assert.throws(() => parseAllowedOrgForms("AS,ANS,DA,NUF"), /refused: ANS, DA, NUF/);
});

// ---------- 3. Duplicates ----------

const candidate = (overrides: Partial<LiteSourceCandidate>): LiteSourceCandidate => ({
  source: "brreg", organizationNumber: "900000001", companyName: "A AS", orgForm: "AS",
  email: "post@a.example", websiteUrl: "https://a.example", sourceUrl: "https://data.brreg.no/x", ...overrides
});

test("selection skips businesses already in Airtable by email, domain, org number or duplicate key", () => {
  const existing = indexFromRecords([
    { id: "rec1", fields: { Email: "post@known.example", "Lead Status": "Sent" } },
    { id: "rec2", fields: { Email: "info@domain.example", "Lead Status": "Replied" } },
    { id: "rec3", fields: { "Research Notes": "[GK-LITE] source=brreg orgnr=900000099 orgform=AS" } },
    { id: "rec4", fields: { Company: "Old", Website: "https://www.keyed.example" } }
  ]);
  const selection = selectLiteLeads([
    candidate({ organizationNumber: "900000010", email: "post@known.example", websiteUrl: undefined }),
    candidate({ organizationNumber: "900000011", email: "kontakt@domain.example", websiteUrl: undefined }),
    candidate({ organizationNumber: "900000099", email: "post@new1.example", websiteUrl: undefined }),
    candidate({ organizationNumber: "900000012", email: "post@keyed.example", websiteUrl: "https://keyed.example" }),
    candidate({ organizationNumber: "900000013", email: "post@fresh.example", websiteUrl: "https://fresh.example" })
  ], existing);
  assert.equal(selection.alreadyKnown, 4);
  assert.deepEqual(selection.leads.map(l => l.email), ["post@fresh.example"]);
});

test("selection de-duplicates within a batch and reports rejections by reason only", () => {
  const selection = selectLiteLeads([
    candidate({ organizationNumber: "900000001", email: "post@a.example" }),
    candidate({ organizationNumber: "900000002", email: "info@a.example" }),
    candidate({ organizationNumber: "900000003", orgForm: "ENK", email: "post@b.example", websiteUrl: undefined }),
    candidate({ organizationNumber: "900000004", email: "ola@c.example", websiteUrl: undefined })
  ], emptyIndex());
  assert.equal(selection.leads.length, 1);
  assert.equal(selection.duplicateInBatch, 1);
  assert.deepEqual(selection.rejected, { ORG_FORM_NOT_ALLOWED: 1, PERSONAL_OR_NAMED_ADDRESS: 1 });
});

test("Airtable record for a Lite lead carries status, marker, org number and form", () => {
  const lead = { ...brregToLiteCandidate(toLiteCandidate({ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" }, hjemmeside: "a.example", epostadresse: "post@a.example", naeringskode1: { kode: "96.021" }, forretningsadresse: { kommunenummer: "0301" } })!), email: "post@a.example" };
  const fields = liteAirtableFields(lead, new Date("2026-10-14T00:00:00Z"));
  assert.equal(fields["Lead Status"], LITE_READY_STATUS);
  assert.match(String(fields["Research Notes"]), /^\[GK-LITE\] source=brreg orgnr=900000001 orgform=AS nace=96\.021 kommune=0301 template=/);
  assert.equal(fields["Duplicate Key"], "a.example");
  assert.equal(fields.Email, "post@a.example");
});

test("Lite intake never writes to Airtable from a pull_request run", async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return json({ records: [] }); }) as typeof fetch;
  await assert.rejects(
    createLiteRecords([{ ...candidate({}), email: "post@a.example" }], { apiToken: "x", baseId: "appAAAAAAAAAAAAAA", tableName: "Leads", fetchImpl }, { GITHUB_EVENT_NAME: "pull_request" }),
    /AIRTABLE_WRITES_DISABLED/
  );
  assert.equal(calls, 0);
});

// ---------- 4 + 5. Lite gate, DNC and reply blocking ----------

const liteRecord = (id: string, fields: Record<string, unknown>): LiteQueueRecord => ({
  id, fields: { "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] source=brreg orgnr=900000001 orgform=AS nace=96.021 kommune=0301", ...fields }
});

test("Lite gate needs no AI fields but requires Lite Ready, the Lite marker, a legal form and no DNC", () => {
  const ok = liteRecord("recOk1", { Email: "post@a.example", Website: "https://a.example" });
  assert.equal(assertLiteRecipientApproved([ok], "post@a.example"), "recOk1");
  const refused = (records: LiteQueueRecord[]) => assert.throws(() => assertLiteRecipientApproved(records, "post@a.example"), LiteRefusedError);
  refused([liteRecord("recX", { Email: "post@a.example", "Do Not Contact": true })]);
  refused([liteRecord("recX", { Email: "post@a.example", "Lead Status": "Draft Ready" })]);
  refused([liteRecord("recX", { Email: "post@a.example", "Lead Status": "Sent" })]);
  refused([liteRecord("recX", { Email: "post@a.example", "Research Notes": "advanced pipeline row" })]);
  refused([liteRecord("recX", { Email: "post@a.example", "Research Notes": "[GK-LITE] orgform=ENK" })]);
  refused([]);
  refused([ok, liteRecord("recDup", { Email: "post@a.example" })]);
});

test("Lite gate refuses when another address at the same business was contacted, replied or is DNC", () => {
  const ok = liteRecord("recOk1", { Email: "post@a.example" });
  for (const other of [
    { Email: "info@a.example", "Lead Status": "Sent" },
    { Email: "info@a.example", "Lead Status": "Replied" },
    { Email: "info@a.example", "Lead Status": "Lite Ready", "Do Not Contact": true }
  ]) {
    assert.throws(() => assertLiteRecipientApproved([ok, { id: "recOther", fields: other }], "post@a.example"), LiteRefusedError);
  }
});

test("runner skips replied businesses and stops on a reply-service outage", async () => {
  const { deps, outbox } = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" })], new Set(["post@a.example"]));
  const summary = await runLiteSend(deps, dryRunConfig());
  assert.equal(summary.skipped.replied, 1);
  assert.equal(outbox.length, 0);

  const outage = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" })]);
  outage.deps.assertNotReplied = async () => { throw new Error("OpenOutSend reply-status check failed with HTTP 503. Refusing to send."); };
  await assert.rejects(runLiteSend(outage.deps, dryRunConfig()), /503/);
  assert.equal(outage.outbox.length, 0);
});

test("runner claims the row before sending and stops, unsent, if Airtable cannot be written", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" }), liteRecord("recB", { Email: "post@b.example" })]);
  run.deps.markSent = async () => { throw new Error("HTTP 500"); };
  await assert.rejects(runLiteSend(run.deps, dryRunConfig()), /Nothing was sent/);
  assert.equal(run.outbox.length, 0);
});

test("a row is Sent before the email goes out, so a crash after sending can never resend it", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" })]);
  const send = run.deps.send;
  run.deps.send = async (email, key) => {
    assert.equal(run.state.get("recA")?.fields["Lead Status"], "Sent", "claimed before send");
    return send(email, key);
  };
  await runLiteSend(run.deps, dryRunConfig());
  assert.equal(run.outbox.length, 1);
  // A day later the 24h ledger and idempotency key have expired; the row is still out of the queue.
  run.advance(25 * 3600_000);
  run.deps.fetchLedger = async () => [];
  const later = await runLiteSend(run.deps, dryRunConfig());
  assert.equal(later.scanned, 0);
  assert.equal(run.outbox.length, 1);
});

test("an unknown send result (timeout, 5xx) leaves the row Sent", async () => {
  for (const message of ["The operation was aborted due to timeout", "Resend send failed (HTTP 500).", "Resend returned an unexpected success response without an email ID."]) {
    const run = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" })]);
    run.deps.send = async () => { throw new Error(message); };
    await assert.rejects(runLiteSend(run.deps, dryRunConfig()), /result is unknown/);
    assert.equal(run.state.get("recA")?.fields["Lead Status"], "Sent", message);
  }
});

test("a failed send puts the claimed row back to Lite Ready and stops the run", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" }), liteRecord("recB", { Email: "post@b.example" })]);
  run.deps.send = async () => { throw new Error("Resend send failed (HTTP 422)."); };
  await assert.rejects(runLiteSend(run.deps, dryRunConfig()), /HTTP 422/);
  assert.equal(run.state.get("recA")?.fields["Lead Status"], "Lite Ready");
  run.deps.markReady = async () => { throw new Error("HTTP 500"); };
  await assert.rejects(runLiteSend(run.deps, dryRunConfig()), /stays Sent/);
  assert.equal(run.state.get("recA")?.fields["Lead Status"], "Sent");
});

test("runner never sends twice to an address already in the 24h Resend ledger", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" })]);
  run.deps.fetchLedger = async () => [{ created_at: new Date(SATURDAY_10_OSLO - 3 * 3600_000).toISOString(), to: ["post@a.example"] }];
  const summary = await runLiteSend(run.deps, dryRunConfig());
  assert.equal(summary.skipped.recentlySent, 1);
  assert.equal(run.outbox.length, 0);
});

test("idempotency key is deterministic per record and message", () => {
  const email = { from: "hello@cideamarketing.com", to: "post@a.example", subject: LITE_TEMPLATE.subject, text: LITE_TEMPLATE.text };
  assert.equal(liteIdempotencyKey("recA", email), liteIdempotencyKey("recA", email));
  assert.notEqual(liteIdempotencyKey("recA", email), liteIdempotencyKey("recB", email));
  assert.match(liteIdempotencyKey("recA", email), /^gullkornet-lite-[0-9a-f]{64}$/);
});

test("preview runs every gate and never sends or writes", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO);
  run.deps.send = async () => { throw new Error("must not send"); };
  run.deps.markSent = async () => { throw new Error("must not write"); };
  run.deps.markReady = async () => { throw new Error("must not write"); };
  const summary = await runLiteSend(run.deps, dryRunConfig(), { preview: true });
  assert.equal(summary.stoppedBy, "preview");
  assert.equal(summary.eligibleInPreview, 2);
});

test("template is the owner-approved text after removing the final sentence", () => {
  assertLiteTemplateCompliant();
  assert.equal(LITE_TEMPLATE.subject, "En idé til forbedring hos dere");
  assert.equal(LITE_TEMPLATE.text, [
    "Hei,",
    "",
    "Vi har sett på hvordan bedrifter i deres marked presenterer seg digitalt, og mener det finnes muligheter for å forbedre hvordan dere tiltrekker dere nye kunder.",
    "",
    "Vi har en konkret idé som vi tror kan gjøre det enklere for potensielle kunder å finne dere og ta kontakt.",
    "",
    "Er dere åpne for at vi sender dere en kort forklaring?",
    "",
    "Mvh",
    "Jelassi",
    "Cidea Marketing"
  ].join("\n"));
  assert.throws(() => assertLiteTemplateCompliant({ subject: "x", text: "Hei. Cidea Marketing" }), /opt-out/);
});

test("template guard refuses singular 'du' and other Cidea sales lines", () => {
  const optOut = "Cidea Marketing\nGi gjerne beskjed dersom dere ikke ønsker flere henvendelser.";
  assert.throws(() => assertLiteTemplateCompliant({ subject: "En idé til deg", text: optOut }), /dere/);
  assert.throws(() => assertLiteTemplateCompliant({ subject: "x", text: `Er du åpen?\n${optOut}` }), /dere/);
  assert.throws(() => assertLiteTemplateCompliant({ subject: "x", text: `Din bedrift.\n${optOut}` }), /dere/);
  assert.throws(() => assertLiteTemplateCompliant({ subject: "x", text: `Cidea Leads\n${optOut}` }), /Cidea Marketing only/);
  // Words that merely contain the letters are fine.
  assertLiteTemplateCompliant({ subject: "Dugnad og middager", text: `Duen og dinosauren.\n${optOut}` });
});

// ---------- 6. Capacity and window ----------

const baseEnv = { RESEND_DAILY_QUOTA: "100" };

test("defaults give 08-20 every day, 95/day, within the 3000/month plan", () => {
  const cfg = loadLiteSendConfig(baseEnv);
  assert.deepEqual([cfg.startHour, cfg.endHour, cfg.dailyLimit, cfg.hourlyLimit, cfg.maxPerRun], [8, 20, 95, 15, 5]);
  assert.ok(theoreticalDailyCapacity(cfg) === 95);
});

test("config refuses to exceed the Resend plan and refuses unreachable targets", () => {
  assert.throws(() => loadLiteSendConfig({}), /RESEND_DAILY_QUOTA is required/);
  assert.throws(() => loadLiteSendConfig({ RESEND_DAILY_QUOTA: "50" }), /exceeds RESEND_DAILY_QUOTA/);
  assert.throws(() => loadLiteSendConfig({ ...baseEnv, GULLKORNET_LITE_DAILY_LIMIT: "100", RESEND_MONTHLY_QUOTA: "3000" }), /RESEND_MONTHLY_QUOTA/, "free plan cannot carry 100/day");
  assert.doesNotThrow(() => loadLiteSendConfig({ ...baseEnv, RESEND_MONTHLY_QUOTA: "50000" }));
  assert.throws(() => loadLiteSendConfig({ ...baseEnv, GULLKORNET_LITE_HOURLY_LIMIT: "5" }), /unreachable/);
  assert.equal(loadLiteSendConfig({ RESEND_DAILY_QUOTA: "1000", GULLKORNET_LITE_DAILY_LIMIT: "150" }).dailyLimit, 150, "100 is a target, not a ceiling");
});

test("window covers Saturday and Sunday 08:00-19:59 Oslo, summer and winter time", () => {
  const cfg = { startHour: 8, endHour: 20 };
  assert.equal(isWithinLiteWindow(Date.parse("2026-10-17T06:00:00Z"), cfg), true, "Sat 08:00 CEST");
  assert.equal(isWithinLiteWindow(Date.parse("2026-10-17T05:59:00Z"), cfg), false, "Sat 07:59 CEST");
  assert.equal(isWithinLiteWindow(Date.parse("2026-10-18T17:59:00Z"), cfg), true, "Sun 19:59 CEST");
  assert.equal(isWithinLiteWindow(Date.parse("2026-10-18T18:00:00Z"), cfg), false, "Sun 20:00 CEST");
  assert.equal(isWithinLiteWindow(Date.parse("2026-11-01T07:00:00Z"), cfg), true, "Sun 08:00 CET");
  assert.equal(isWithinLiteWindow(Date.parse("2026-11-01T19:00:00Z"), cfg), false, "Sun 20:00 CET");
});

test("capacity check: hourly, daily, quota and spacing", () => {
  const cfg = loadLiteSendConfig(baseEnv);
  const now = SATURDAY_10_OSLO;
  const at = (minutesAgo: number) => ({ created_at: new Date(now - minutesAgo * 60_000).toISOString(), to: ["x@y.example"] });
  assert.doesNotThrow(() => assertLiteCapacity(countLedger([at(2)], now), cfg, now));
  assert.throws(() => assertLiteCapacity(countLedger([at(0.5)], now), cfg, now), SendDeferredError);
  assert.throws(() => assertLiteCapacity(countLedger(Array.from({ length: 15 }, (_, i) => at(3 + i)), now), cfg, now), /Hourly/);
  assert.throws(() => assertLiteCapacity(countLedger(Array.from({ length: 100 }, (_, i) => at(61 + i * 10)), now), cfg, now), /quota|Daily/);
  assert.throws(() => countLedger([{ created_at: "bad" }], now), /invalid timestamp/);
});

test("a full simulated day with a run every 10 minutes sends exactly 95, all inside 08-20 Oslo", async () => {
  const records = Array.from({ length: 300 }, (_, i) => liteRecord(`recSim${String(i).padStart(4, "0")}`, { Email: `post@sim${i}.example` }));
  const cfg = loadLiteSendConfig(baseEnv);
  const dayStart = Date.parse("2026-10-17T22:00:00Z"); // Sunday 00:00 Oslo
  const run = dryRunDeps(dayStart, records);
  for (let minute = 0; minute < 24 * 60; minute += 10) {
    const target = dayStart + minute * 60_000;
    const current = run.deps.now();
    if (target > current) run.advance(target - current);
    await runLiteSend(run.deps, cfg);
  }
  assert.equal(run.outbox.length, 95);
  for (const entry of run.ledger) {
    assert.ok(isWithinLiteWindow(Date.parse(entry.created_at), cfg), "sent outside the window");
  }
  assert.equal(new Set(run.outbox.map(o => o.email.to)).size, 95, "no address twice");
});

// ---------- 7. Offline dry run with five test leads ----------

test("dry run over five synthetic leads: 2 sent, ENK refused, replied skipped, DNC never queued", async () => {
  const { deps, outbox, state } = dryRunDeps(SATURDAY_10_OSLO);
  const summary = await runLiteSend(deps, dryRunConfig());
  assert.equal(DRY_RUN_RECORDS.length, 5);
  assert.deepEqual(outbox.map(o => o.email.to), ["post@frisor-a.example", "kontakt@ror-b.example"]);
  assert.ok(outbox.every(o => o.email.to.endsWith(".example")), "only reserved test domains");
  assert.ok(outbox.every(o => o.email.from === "Cidea Marketing <hello@cideamarketing.com>" && o.email.text === LITE_TEMPLATE.text));
  assert.deepEqual(summary.skipped, { refused: 1, replied: 1, recentlySent: 0, noResearch: 0, stale: 0 });
  assert.equal(summary.scanned, 4);
  assert.equal(state.get("recLiteDry00001")?.fields["Lead Status"], "Sent");
  assert.match(String(state.get("recLiteDry00001")?.fields["Research Notes"]), / research=96\.021@oslo-akershus@2026-10-16 sent=2026-10-17$/);
  assert.equal(state.get("recLiteDry00004")?.fields["Lead Status"], "Lite Ready");
});

test("send:lite CLI with the kill switch off makes no provider or CRM call", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/send-lite.ts"], {
    encoding: "utf8",
    timeout: 15000,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", RESEND_API_KEY: "re_should_not_be_used", AIRTABLE_API_TOKEN: "x" }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /kill switch is off/);
});

// ---------- Workflow safety ----------

import { readFile } from "node:fs/promises";

test("Lite outreach workflow is gated by its own kill switch and has no push/PR trigger", async () => {
  const wf = (await readFile(new URL("../.github/workflows/lite-outreach.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(wf, /GULLKORNET_LITE_ENABLE_LIVE_SEND: \$\{\{ secrets\.GULLKORNET_LITE_ENABLE_LIVE_SEND \}\}/);
  assert.doesNotMatch(wf, /GULLKORNET_ENABLE_LIVE_SEND:/, "must not reuse the advanced sender switch");
  assert.doesNotMatch(wf, /^  (push|pull_request):/m);
  assert.match(wf, /send:lite -- --preview/);
  assert.match(wf, /cron: "\*\/10 6-18 \* \* \*"/, "every day; window enforced in code");
  assert.doesNotMatch(wf, /upload-artifact/);
});

test("Lite intake workflow is inert without its variable and holds no sending credentials", async () => {
  const wf = (await readFile(new URL("../.github/workflows/lite-lead-intake.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(wf, /GULLKORNET_LITE_INTAKE_ENABLED/);
  assert.match(wf, /GULLKORNET_LITE_INTAKE_SYNC/);
  assert.doesNotMatch(wf, /RESEND|LIVE_SEND|send:(lite|daily|email)|OPENOUTREACH/);
  assert.doesNotMatch(wf, /^  (push|pull_request):/m);
  for (const line of wf.split("\n").filter(l => l.includes("${{ inputs."))) {
    assert.match(line, /^\s+INPUT_[A-Z_]+: \$\{\{ inputs\./, "inputs reach the shell only through env");
  }
  assert.doesNotMatch(wf, /upload-artifact/);
});

test("Lite research workflow holds no CRM or sending credentials and is manual only", async () => {
  const wf = (await readFile(new URL("../.github/workflows/lite-market-research.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.doesNotMatch(wf, /AIRTABLE|RESEND|LIVE_SEND|send:|OPENOUTREACH/);
  assert.doesNotMatch(wf, /^  (push|pull_request|schedule):/m);
  for (const line of wf.split("\n").filter(l => l.includes("${{ inputs."))) {
    assert.match(line, /^\s+INPUT_[A-Z_]+: \$\{\{ inputs\./, "inputs reach the shell only through env");
  }
});

test("failures in every Lite workflow raise the existing pipeline alert", async () => {
  const alerts = (await readFile(new URL("../.github/workflows/pipeline-failure-alerts.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  for (const file of ["lite-lead-intake.yml", "lite-outreach.yml", "lite-market-research.yml"]) {
    const name = /^name: (.+)$/m.exec((await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n"))?.[1];
    assert.ok(name && alerts.includes(`- "${name}"`), `${file} is watched by the alert workflow`);
  }
});

test("Brreg discovery can start further into the register and respects the 10 000 result cap", async () => {
  const pages: string[] = [];
  const fetchImpl = (async (input: URL | RequestInfo) => {
    pages.push(new URL(String(input)).searchParams.get("page") ?? "");
    return json({ _embedded: { enheter: [{ organisasjonsnummer: "900000001", navn: "A AS", organisasjonsform: { kode: "AS" } }] }, page: { totalPages: 1000 } });
  }) as typeof fetch;
  await discoverBrregLiteCandidates({ municipalities: ["0301"], pagesPerQuery: 3, startPage: 30, fetchImpl });
  assert.deepEqual(pages, ["30", "31", "32"]);
  pages.length = 0;
  await discoverBrregLiteCandidates({ municipalities: ["0301"], pagesPerQuery: 5, startPage: 500, fetchImpl });
  assert.deepEqual(pages, ["99"]);
});

// ---------- 8. Market research (template claim documentation) ----------

test("segment is NACE x region, read from the intake marker", () => {
  assert.deepEqual(segmentFromNotes("[GK-LITE] source=brreg nace=96.021 kommune=3201 template=x"), { key: "96.021@oslo-akershus", industryCode: "96.021", region: "oslo-akershus" });
  assert.equal(segmentFromNotes("[GK-LITE] source=brreg nace=96.021 kommune=5001"), undefined, "region without research coverage");
  assert.equal(segmentFromNotes("[GK-LITE] source=brreg orgnr=1"), undefined);
});

test("research records only what was fetched and claims a gap only when common", () => {
  const research = dryRunResearch(SATURDAY_10_OSLO);
  assert.equal(research.examined, 10);
  assert.equal(research.supportsTemplate, true);
  assert.deepEqual(research.opportunities, [
    "6 av 10 undersøkte nettsider manglet en beskrivelse som søkemotorer kan vise i søkeresultatet.",
    "6 av 10 undersøkte nettsider hadde verken en tydelig kontakt- eller bestillingslenke eller en e-postlenke på forsiden."
  ]);
  assert.match(research.followUp, /Vi har ikke gjort en egen vurdering av deres nettside/);
  assert.match(research.followUp, /automatisk gjennomgang/);
  assert.doesNotMatch(research.followUp, /(?<![\p{L}])(?:du|deg|din|ditt|dine)(?![\p{L}])/iu);

  const segment = liteSegment("96.021", "oslo-akershus")!;
  const units = Array.from({ length: 10 }, (_, i) => ({ organizationNumber: String(i), companyName: `S${i}` }));
  const audit = (i: number, over: Partial<WebsiteAudit>): WebsiteAudit => ({ companyName: `S${i}`, checkedAt: "2026-10-16T00:00:00Z", status: "AUDITED", httpStatus: 200, finalUrl: `https://s${i}.example/`, flags: [], ...over });
  // Unreadable sites are never counted as examined, and their flags are not used.
  const failed = buildSegmentResearch(segment, units, units.map((_, i) => i < 5
    ? audit(i, { status: "FETCH_ERROR", httpStatus: undefined, flags: ["FETCH_ERROR"] })
    : audit(i, { httpStatus: i === 5 ? 404 : 200, flags: i === 5 ? ["HTTP_ERROR", "MISSING_META_DESCRIPTION"] : ["MISSING_META_DESCRIPTION"] })), new Date(SATURDAY_10_OSLO));
  assert.equal(failed.attempted, 10);
  assert.equal(failed.examined, 4);
  assert.equal(failed.supportsTemplate, false);
  // Pages without a title and repeats of the same site never count; a mailto link is a contact route.
  const thin = buildSegmentResearch(segment, units, units.map((_, i) => audit(i, {
    finalUrl: i < 3 ? "https://same.example/" : `https://s${i}.example/`,
    flags: i === 9 ? ["MISSING_TITLE", "MISSING_META_DESCRIPTION"] : ["NO_OBVIOUS_CONTACT_PATH"]
  })), new Date(SATURDAY_10_OSLO));
  assert.equal(thin.examined, 7);
  assert.deepEqual(thin.sites.map(s => s.excluded ?? "-").filter(x => x !== "-"), ["DUPLICATE_SITE", "DUPLICATE_SITE", "NO_TITLE"]);
  assert.deepEqual(thin.opportunities, [], "fewer than 8 examined, and no e-mail-less contact gap");
  // No common gap: nothing to claim, so the template is not supported.
  const clean = buildSegmentResearch(segment, units, units.map((_, i) => audit(i, { flags: i === 0 ? ["MISSING_TITLE"] : [] })), new Date(SATURDAY_10_OSLO));
  assert.deepEqual(clean.opportunities, []);
  assert.equal(clean.supportsTemplate, false);
});

test("send gate: no, stale, insufficient or mismatched research blocks the lead", () => {
  const segment = liteSegment("96.021", "oslo-akershus")!;
  const research = dryRunResearch(SATURDAY_10_OSLO);
  assert.equal(assessResearch(segment, research, SATURDAY_10_OSLO).ok, true);
  assert.deepEqual(assessResearch(undefined, research, SATURDAY_10_OSLO), { ok: false, reason: "NO_SEGMENT" });
  assert.deepEqual(assessResearch(segment, undefined, SATURDAY_10_OSLO), { ok: false, reason: "NO_RESEARCH" });
  assert.deepEqual(assessResearch(liteSegment("43.221", "oslo-akershus"), research, SATURDAY_10_OSLO), { ok: false, reason: "NO_RESEARCH" });
  assert.deepEqual(assessResearch(segment, research, SATURDAY_10_OSLO + 91 * 86_400_000), { ok: false, reason: "RESEARCH_STALE" });
  assert.deepEqual(assessResearch(segment, { ...research, examined: 12 }, SATURDAY_10_OSLO), { ok: false, reason: "RESEARCH_INSUFFICIENT" });
  // The stored summary is not trusted: inflated claims or doctored site records are caught.
  assert.deepEqual(assessResearch(segment, { ...research, opportunities: ["10 av 10 undersøkte nettsider manglet alt."] }, SATURDAY_10_OSLO), { ok: false, reason: "RESEARCH_INSUFFICIENT" });
  assert.deepEqual(assessResearch(segment, { ...research, sites: research.sites.map(s => ({ ...s, status: "FETCH_ERROR" as const })) }, SATURDAY_10_OSLO), { ok: false, reason: "RESEARCH_INSUFFICIENT" });
});

test("runner skips leads without documented research and sends nothing to them", async () => {
  const run = dryRunDeps(SATURDAY_10_OSLO, [
    liteRecord("recA", { Email: "post@a.example" }),
    liteRecord("recB", { Email: "post@b.example", "Research Notes": "[GK-LITE] source=brreg orgnr=900000002 orgform=AS nace=43.221 kommune=0301" }),
    liteRecord("recC", { Email: "post@c.example", "Research Notes": "[GK-LITE] source=brreg orgnr=900000003 orgform=AS" })
  ]);
  const summary = await runLiteSend(run.deps, dryRunConfig());
  assert.equal(summary.sent, 1);
  assert.equal(summary.skipped.noResearch, 2);
  assert.deepEqual(run.outbox.map(o => o.email.to), ["post@a.example"]);

  const none = dryRunDeps(SATURDAY_10_OSLO, [liteRecord("recA", { Email: "post@a.example" })], new Set(), []);
  assert.equal((await runLiteSend(none.deps, dryRunConfig())).skipped.noResearch, 1);
  assert.equal(none.outbox.length, 0);
});

test("research reference replaces an earlier one on the row", () => {
  assert.equal(withResearchRef("[GK-LITE] a=1 research=old", "new"), "[GK-LITE] a=1 research=new");
});

test("Lite sends as Cidea Marketing <hello@cideamarketing.com>", () => {
  assert.equal(LITE_FROM, "Cidea Marketing <hello@cideamarketing.com>");
});

test("research is stored encrypted and bound to its segment", async () => {
  const env = { GULLKORNET_LITE_RESEARCH_KEY: Buffer.alloc(32, 7).toString("base64") };
  const research = dryRunResearch(SATURDAY_10_OSLO);
  const file = encryptResearch(research, env);
  assert.doesNotMatch(file, /Salong|salong|example/, "no company names or URLs in the stored file");
  assert.deepEqual(decryptResearch(file, env), research);
  assert.throws(() => decryptResearch(file, { GULLKORNET_LITE_RESEARCH_KEY: Buffer.alloc(32, 8).toString("base64") }));
  assert.throws(() => decryptResearch(file, {}), /GULLKORNET_LITE_RESEARCH_KEY/);
  const relabelled = JSON.stringify({ ...JSON.parse(file), segment: "43.221@oslo-akershus" });
  assert.throws(() => decryptResearch(relabelled, env), "a file cannot be moved to another segment");

  const dir = await mkdtemp(path.join(os.tmpdir(), "lite-research-"));
  try {
    await saveResearch(research, dir, env);
    assert.equal((await loadResearchIndex(dir, env)).get("96.021@oslo-akershus")?.id, research.id);
    await writeFile(path.join(dir, "plain.json"), JSON.stringify(research));
    await assert.rejects(loadResearchIndex(dir, env), /Unencrypted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reply check retries a transient 503 twice, then fails closed", async () => {
  const waits: number[] = [];
  let calls = 0;
  const flaky = async () => { calls++; if (calls < 3) throw new Error("OpenOutSend reply-status check failed with HTTP 503. Refusing to send."); return "ok"; };
  assert.equal(await withTransientRetry(flaky, async ms => { waits.push(ms); }), "ok");
  assert.deepEqual(waits, [10_000, 30_000]);
  calls = -10;
  await assert.rejects(withTransientRetry(flaky, async () => undefined), /HTTP 503/);
  await assert.rejects(withTransientRetry(async () => { throw new Error("HTTP 401"); }, async () => assert.fail("no retry on other errors")), /401/);
});
