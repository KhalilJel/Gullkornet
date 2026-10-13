import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessCideaRouting, formatRoutingNotes, ROUTING_RULES_VERSION } from "../src/domain/cidea-routing.js";
import { validateFinding, type Finding } from "../src/domain/research-evidence.js";
import { buildRoutingForCompany, findingsFromAudit } from "../src/integrations/company-dossier.js";
import { researchContactAndDraft } from "../src/integrations/contact-research.js";
import { readBodyBounded } from "../src/integrations/bounded-read.js";
import {
  classifyEscalation, DEFAULT_ROUTER_POLICY, escalateResearch, routerPolicyFromEnv,
  type BuiltinOutcome, type ResearchProviders, type RouterState
} from "../src/integrations/research-router.js";
import type { GoogleCandidate, WebsiteAudit } from "../src/integrations/website-audit.js";

const LONG_TEXT = "Vi tilbyr regnskap og rådgivning til små og mellomstore bedrifter i hele regionen. ".repeat(4);
const policy = { ...DEFAULT_ROUTER_POLICY, timeoutMs: 40 };
const fresh = (): RouterState => ({ firecrawlUsed: 0, browserUsed: 0 });
const failedFetch: BuiltinOutcome = { ok: false, textLength: 0, reason: "FETCH_ERROR" };
const thinPage: BuiltinOutcome = { ok: true, textLength: 20, httpStatus: 200 };
const okBrowser = { status: "success" as const, finalUrl: "https://example.no/", evidence: [LONG_TEXT] };

// ---- router -----------------------------------------------------------------------------

test("a readable page never triggers a paid or browser provider", async () => {
  let called = false;
  const providers: ResearchProviders = { firecrawl: async () => { called = true; return { url: "https://x.no", markdown: LONG_TEXT }; } };
  const result = await escalateResearch({ url: "https://example.no", builtin: { ok: true, textLength: 5000, httpStatus: 200 } }, providers, fresh(), policy);
  assert.equal(called, false);
  assert.deepEqual(result.attempts, []);
});

test("URLs blocked by the public-URL safety check are never escalated to any provider", async () => {
  let called = 0;
  const providers: ResearchProviders = {
    firecrawl: async () => { called += 1; return { url: "https://x.no", markdown: LONG_TEXT }; },
    jev: async () => { called += 1; return okBrowser; },
    browserUse: async () => { called += 1; return okBrowser; }
  };
  for (const reason of ["URL_BLOCKED_OR_NON_PUBLIC", "BLOCKED_URL", "NO_WEBSITE"]) {
    const result = await escalateResearch({ url: "http://127.0.0.1", builtin: { ok: false, textLength: 0, reason } }, providers, fresh(), policy);
    assert.equal(result.page, undefined);
  }
  assert.equal(called, 0);
});

test("missing credentials: nothing is invented and the gap is recorded", async () => {
  const result = await escalateResearch({ url: "https://example.no", builtin: failedFetch }, {}, fresh(), policy);
  assert.equal(result.page, undefined);
  assert.deepEqual(result.attempts.map((a) => [a.provider, a.outcome, a.reason]), [
    ["firecrawl", "skipped", "not_configured"],
    ["jev-ultrafast", "escalation_needed", "no_executor_available_in_this_runtime"]
  ]);
});

test("Firecrawl is tried first and its content is accepted when substantial", async () => {
  const providers: ResearchProviders = { firecrawl: async (url) => ({ url, title: "Eksempel", markdown: LONG_TEXT }) };
  const state = fresh();
  const result = await escalateResearch({ url: "https://example.no", builtin: thinPage }, providers, state, policy);
  assert.equal(result.page?.markdown, LONG_TEXT);
  assert.equal(result.attempts[0]?.provider, "firecrawl");
  assert.equal(result.attempts[0]?.outcome, "ok");
  assert.equal(state.firecrawlUsed, 1);
  assert.equal(state.browserUsed, 0);
});

test("a transient Firecrawl failure is retried once; a permanent one is not", async () => {
  let transientCalls = 0;
  const transient: ResearchProviders = { firecrawl: async (url) => { transientCalls += 1; if (transientCalls === 1) throw new Error("FIRECRAWL_HTTP_503"); return { url, markdown: LONG_TEXT }; } };
  assert.ok((await escalateResearch({ url: "https://example.no", builtin: failedFetch }, transient, fresh(), policy)).page);
  assert.equal(transientCalls, 2);

  let permanentCalls = 0;
  const permanent: ResearchProviders = { firecrawl: async () => { permanentCalls += 1; throw new Error("FIRECRAWL_HTTP_401"); } };
  const result = await escalateResearch({ url: "https://example.no", builtin: failedFetch }, permanent, fresh(), policy);
  assert.equal(permanentCalls, 1);
  assert.equal(result.page, undefined);
  assert.equal(result.attempts.find((a) => a.provider === "firecrawl")?.reason, "FIRECRAWL_HTTP_401");
});

test("a provider that never answers is cut off by the timeout", async () => {
  const providers: ResearchProviders = { firecrawl: () => new Promise(() => undefined) };
  const startedAt = Date.now();
  const result = await escalateResearch({ url: "https://example.no", builtin: failedFetch }, providers, fresh(), { ...policy, timeoutMs: 30 });
  assert.ok(Date.now() - startedAt < 2000);
  assert.equal(result.attempts.find((a) => a.provider === "firecrawl")?.outcome, "failed");
  assert.equal(result.attempts.find((a) => a.provider === "firecrawl")?.reason, "PROVIDER_TIMEOUT");
});

test("empty, thin or malformed provider output is not accepted as research", async () => {
  for (const output of [{ url: "https://x.no" }, { url: "https://x.no", markdown: "kort" }, { url: "https://x.no", markdown: "   " }, undefined, null]) {
    const providers: ResearchProviders = { firecrawl: async () => output as never };
    const result = await escalateResearch({ url: "https://example.no", builtin: failedFetch }, providers, fresh(), policy);
    assert.equal(result.page, undefined);
    assert.equal(result.attempts.find((a) => a.provider === "firecrawl")?.outcome, "failed");
  }
});

test("the per-run Firecrawl budget is a real limit", async () => {
  let calls = 0;
  const providers: ResearchProviders = { firecrawl: async (url) => { calls += 1; return { url, markdown: LONG_TEXT }; } };
  const state = fresh();
  const tight = { ...policy, maxFirecrawlPerRun: 2 };
  for (let i = 0; i < 4; i += 1) await escalateResearch({ url: "https://example.no", builtin: thinPage }, providers, state, tight);
  assert.equal(calls, 2);
  const last = await escalateResearch({ url: "https://example.no", builtin: thinPage }, providers, state, tight);
  assert.equal(last.attempts[0]?.reason, "run_budget_exhausted");
});

test("exactly one browser path is used per company: JEV for simple steps, Browser Use for interactive pages", async () => {
  const calls: string[] = [];
  const providers: ResearchProviders = {
    jev: async () => { calls.push("jev"); return okBrowser; },
    browserUse: async () => { calls.push("browser-use"); return okBrowser; }
  };
  const simple = await escalateResearch({ url: "https://example.no", builtin: thinPage }, providers, fresh(), policy);
  assert.deepEqual(calls, ["jev"]);
  assert.equal(simple.attempts.at(-1)?.provider, "jev-ultrafast");

  calls.length = 0;
  const interactive = await escalateResearch({ url: "https://example.no", builtin: { ...thinPage, interactive: true } }, providers, fresh(), policy);
  assert.deepEqual(calls, ["browser-use"]);
  assert.equal(interactive.attempts.every((a) => a.provider !== "firecrawl"), true);
  assert.ok(interactive.page);
});

test("a browser result without a final URL or enough evidence is rejected", async () => {
  for (const result of [
    { status: "success" as const, evidence: [LONG_TEXT] },
    { status: "success" as const, finalUrl: "https://example.no/", evidence: ["for kort"] },
    { status: "blocked" as const, evidence: [], failureReason: "bot protection at contact@example.no" }
  ]) {
    const out = await escalateResearch({ url: "https://example.no", builtin: thinPage }, { jev: async () => result }, fresh(), policy);
    assert.equal(out.page, undefined);
    assert.ok(!JSON.stringify(out.attempts).includes("contact@example.no"), "provider error text must not leak addresses");
  }
});

test("browser escalation has its own per-run budget", async () => {
  let calls = 0;
  const providers: ResearchProviders = { jev: async () => { calls += 1; return okBrowser; } };
  const state = fresh();
  for (let i = 0; i < 5; i += 1) await escalateResearch({ url: "https://example.no", builtin: thinPage }, providers, state, { ...policy, maxBrowserPerRun: 1 });
  assert.equal(calls, 1);
});

test("classification and environment limits are bounded", () => {
  assert.equal(classifyEscalation({ ok: true, textLength: 5000 }), "none");
  assert.equal(classifyEscalation({ ok: true, textLength: 10 }), "empty_content");
  assert.equal(classifyEscalation({ ok: false, textLength: 0, httpStatus: 403 }), "blocked_by_site");
  assert.equal(classifyEscalation({ ok: false, textLength: 0, reason: "FETCH_ERROR" }), "fetch_failed");
  assert.equal(routerPolicyFromEnv({ FIRECRAWL_MAX_PER_RUN: "7" }).maxFirecrawlPerRun, 7);
  assert.equal(routerPolicyFromEnv({ FIRECRAWL_MAX_PER_RUN: "100000" }).maxFirecrawlPerRun, DEFAULT_ROUTER_POLICY.maxFirecrawlPerRun);
  assert.equal(routerPolicyFromEnv({ FIRECRAWL_MAX_PER_RUN: "-1" }).maxFirecrawlPerRun, DEFAULT_ROUTER_POLICY.maxFirecrawlPerRun);
});

// ---- bounded body read -----------------------------------------------------------------

test("a response whose body stalls is abandoned instead of hanging the run", async () => {
  const stalled = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<html>")); } }));
  const startedAt = Date.now();
  await assert.rejects(readBodyBounded(stalled, 1024, 60), /BODY_READ_TIMEOUT/);
  assert.ok(Date.now() - startedAt < 2000);
  assert.equal(await readBodyBounded(new Response("hei"), 1024, 1000), "hei");
  assert.equal((await readBodyBounded(new Response("abcdef"), 3, 1000)), "abc");
});

// ---- evidence and routing --------------------------------------------------------------

const at = "2026-10-13T08:00:00.000Z";
const fact = (signal: string, overrides: Partial<Finding> = {}): Finding => ({
  kind: "fact", statement: `Signal ${signal}`, sourceUrl: "https://example.no/", retrievedAt: at,
  confidence: 0.9, provider: "builtin-fetch", signal, ...overrides
});

test("findings without a public source URL, timestamp or valid confidence are discarded", () => {
  assert.ok(validateFinding(fact("MISSING_TITLE")));
  for (const bad of [
    { ...fact("A"), sourceUrl: "" }, { ...fact("A"), sourceUrl: "ftp://x.no" }, { ...fact("A"), sourceUrl: "not a url" },
    { ...fact("A"), retrievedAt: "yesterday" }, { ...fact("A"), confidence: 1.2 }, { ...fact("A"), confidence: Number.NaN },
    { ...fact("A"), statement: "  " }, { ...fact("A"), kind: "guess" }, null, "text"
  ]) assert.equal(validateFinding(bad), undefined);
});

test("no evidence means no route, zero scores and zero confidence", () => {
  const result = assessCideaRouting({ findings: [{ kind: "fact", statement: "x", sourceUrl: "", retrievedAt: at, confidence: 1, provider: "builtin-fetch" }], hasWebsite: true, completeness: "complete" });
  assert.equal(result.route, "NONE");
  for (const unit of result.units) { assert.equal(unit.score, 0); assert.equal(unit.confidence, 0); }
  assert.equal(result.findings.length, 0);
});

test("a weak website routes to CideaLead and every inference and recommendation cites a source", () => {
  const result = assessCideaRouting({
    findings: [fact("MISSING_VIEWPORT_META"), fact("NOT_HTTPS"), fact("NO_OBVIOUS_CONTACT_PATH")],
    hasWebsite: true, completeness: "complete", now: () => new Date(at)
  });
  assert.equal(result.ruleVersion, ROUTING_RULES_VERSION);
  assert.equal(result.route, "CideaLead");
  const lead = result.units.find((u) => u.unit === "CideaLead")!;
  assert.equal(lead.score, 50);
  assert.ok(lead.confidence >= 0.5);
  const consulting = result.units.find((u) => u.unit === "CideaConsulting")!;
  assert.equal(consulting.score, 0);
  const derived = result.findings.filter((f) => f.kind !== "fact");
  assert.ok(derived.some((f) => f.kind === "inference") && derived.some((f) => f.kind === "recommendation"));
  for (const finding of result.findings) {
    assert.ok(validateFinding(finding), "every finding is well formed");
    assert.match(finding.sourceUrl, /^https:\/\//);
  }
  assert.ok(result.findings.filter((f) => f.kind === "fact").every((f) => f.provider !== "cidea-rules"), "rules never produce facts");
});

test("routing is deterministic and a partial or insufficient read lowers confidence", () => {
  const input = { findings: [fact("MISSING_VIEWPORT_META"), fact("NOT_HTTPS"), fact("MISSING_TITLE")], hasWebsite: true, now: () => new Date(at) };
  const complete = assessCideaRouting({ ...input, completeness: "complete" });
  assert.deepEqual(assessCideaRouting({ ...input, completeness: "complete" }), complete);
  const partial = assessCideaRouting({ ...input, completeness: "partial" });
  const insufficient = assessCideaRouting({ ...input, completeness: "insufficient" });
  const confidence = (r: typeof complete) => r.units.find((u) => u.unit === "CideaLead")!.confidence;
  assert.ok(confidence(complete) > confidence(partial) && confidence(partial) > confidence(insufficient));
});

test("two strong units make a strategic account that is flagged for no automatic outreach", () => {
  const result = assessCideaRouting({
    findings: [fact("HTTP_ERROR"), fact("MISSING_VIEWPORT_META"), fact("NOT_HTTPS"), fact("NO_OBVIOUS_CONTACT_PATH"), fact("MISSING_TITLE"), fact("MISSING_META_DESCRIPTION"), fact("NO_SOCIAL_PRESENCE_FOUND")],
    hasWebsite: true, completeness: "complete", now: () => new Date(at)
  });
  assert.equal(result.route, "STRATEGIC_ACCOUNT");
  assert.equal(result.strategic, true);
  const notes = formatRoutingNotes(result);
  assert.ok(notes[0]!.startsWith("[GK-ROUTE:STRATEGIC_ACCOUNT]"));
  assert.ok(notes.some((line) => line.includes("skal ikke godkjennes automatisk")));
});

test("a company without a website is a CideaLead fact from Google Places and has no marketing score", () => {
  const candidate: GoogleCandidate = { companyName: "Uten Nett AS", sourceUrl: "https://maps.google.com/?cid=1" };
  const findings = findingsFromAudit(candidate);
  assert.equal(findings[0]?.signal, "NO_WEBSITE");
  assert.equal(findings[0]?.provider, "google-places");
  const result = assessCideaRouting({ findings, hasWebsite: false, completeness: "complete" });
  assert.equal(result.units.find((u) => u.unit === "CideaMarketing")!.score, 0);
  assert.equal(result.route, "CideaLead");
  assert.deepEqual(findingsFromAudit({ companyName: "X" }), [], "no source URL, so no finding");
});

test("routing audit lines carry the rule version, timestamps, providers and source URLs", () => {
  const audit: WebsiteAudit = {
    companyName: "Eksempel AS", websiteUrl: "https://example.no", checkedAt: at, status: "AUDITED", finalUrl: "https://example.no/",
    flags: ["MISSING_VIEWPORT_META", "MISSING_TITLE", "NO_EMAIL_LINK_DETECTED"]
  };
  const { assessment, notes } = buildRoutingForCompany({ companyName: "Eksempel AS", websiteUrl: "https://example.no" }, audit,
    { attempts: [{ provider: "builtin-fetch", outcome: "ok", durationMs: 1, at }], builtinReadable: true }, () => new Date(at));
  assert.equal(assessment.route === "NONE" || assessment.route === "CideaLead" || assessment.route === "CideaMarketing", true);
  const text = notes.join("\n");
  assert.match(text, /cidea-routing-rules@1/);
  assert.match(text, /2026-10-13T08:00:00.000Z/);
  assert.match(text, /Kilde: https:\/\/example\.no\//);
  assert.doesNotMatch(text, /NO_EMAIL_LINK_DETECTED/, "signals that are not opportunities are not recorded");
});

// ---- research integration (no network: IP-literal URL and a mocked fetch) ---------------

const candidate: GoogleCandidate = { companyName: "Eksempel Regnskap AS", websiteUrl: "https://93.184.216.34/", city: "Bergen", industry: "regnskap", sourceUrl: "https://maps.google.com/?cid=2" };

async function withFetch<T>(handler: () => Response, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => handler()) as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("without escalation providers a failing site behaves as before and still records the routing basis", async () => {
  const result = await withFetch(() => new Response("down", { status: 503 }), () => researchContactAndDraft(candidate));
  assert.equal(result.researchStatus, "FETCH_ERROR");
  assert.deepEqual(result.emails, []);
  assert.equal(result.routing?.route, "NONE");
  assert.equal(result.routing?.completeness, "insufficient");
  assert.ok(result.notes.some((line) => line.startsWith("[GK-ROUTE:NONE]")));
});

test("a failed homepage is recovered through Firecrawl, with provenance, when it is configured", async () => {
  const markdown = `# Eksempel Regnskap\n\nVi tilbyr regnskap og lønn til små bedrifter i Bergen og omegn, med fast kontaktperson.\n\nKontakt oss: post@regnskap-eksempel.no\n${LONG_TEXT}`;
  const deps = {
    state: fresh(), policy,
    providers: { firecrawl: async (url: string) => ({ url, title: "Eksempel Regnskap", description: "Regnskap", markdown }) } satisfies ResearchProviders
  };
  const result = await withFetch(() => new Response("down", { status: 503 }), () => researchContactAndDraft(candidate, undefined, deps));
  assert.equal(result.researchStatus, "RESEARCHED");
  assert.ok(result.providerAttempts?.some((a) => a.provider === "firecrawl" && a.outcome === "ok"));
  assert.equal(result.routing?.completeness, "partial");
  assert.ok(result.notes.some((line) => line.includes("firecrawl:ok")));
  assert.equal(result.requiresHumanReview, true);
});

test("a failing Firecrawl never produces invented research or emails", async () => {
  const deps = { state: fresh(), policy, providers: { firecrawl: async () => { throw new Error("FIRECRAWL_HTTP_402"); } } satisfies ResearchProviders };
  const result = await withFetch(() => new Response("down", { status: 503 }), () => researchContactAndDraft(candidate, undefined, deps));
  assert.equal(result.researchStatus, "FETCH_ERROR");
  assert.deepEqual(result.emails, []);
  assert.equal(result.draftBody, undefined);
  assert.ok(result.notes.some((line) => line.includes("firecrawl:failed(FIRECRAWL_HTTP_402)")));
});

// ---- invariants -------------------------------------------------------------------------

test("research and routing code cannot send e-mail or touch send approval", async () => {
  const forbidden = /outbound-email|airtable-send-approval|reply-status|airtable-review-sync|resend/i;
  for (const file of ["src/domain/cidea-routing.ts", "src/domain/research-evidence.ts", "src/integrations/research-router.ts", "src/integrations/company-dossier.ts"]) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const imports = text.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
    assert.doesNotMatch(imports, forbidden, `${file} must not import sending or CRM-write code`);
  }
});

test("the Firecrawl key reaches only the research step, with a per-run budget", async () => {
  const text = (await readFile(new URL("../.github/workflows/contact-research-drafts.yml", import.meta.url), "utf8")).split("\r\n").join("\n");
  assert.equal((text.match(/secrets\.FIRECRAWL_API_KEY/g) ?? []).length, 1);
  assert.match(text, /FIRECRAWL_MAX_PER_RUN: "10"/);
  assert.doesNotMatch(text, /echo.*FIRECRAWL/);
});
