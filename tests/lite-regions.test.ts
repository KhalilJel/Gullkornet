import assert from "node:assert/strict";
import test from "node:test";
import { assessResearch, LITE_REGIONS, liteSegment, regionMunicipalities, regionOfMunicipality } from "../src/lite/market-research.js";
import { dryRunConfig, dryRunDeps } from "../src/lite/fixtures.js";
import { runLiteSend } from "../src/lite/send.js";
import { loadLiteSendConfig } from "../src/lite/schedule.js";
import { websiteSupplementPool } from "../src/lite/places-supplement.js";
import { brregIndustryTotal, toLiteCandidate } from "../src/lite/brreg-lite.js";

test("website budget excludes undocumented, known and already usable register candidates", () => {
  const unit = (id: string, municipality = "3107", email?: string) => toLiteCandidate({
    organisasjonsnummer: id, navn: "Test AS", organisasjonsform: { kode: "AS" },
    hjemmeside: "example.no", epostadresse: email,
    forretningsadresse: { kommunenummer: municipality }, naeringskode1: { kode: "43.221" }
  })!;
  const candidates = [unit("900000001"), unit("900000002", "3905"), unit("900000003"), unit("900000004", "3107", "post@example.no")];
  const pool = websiteSupplementPool(candidates, new Set(["900000003"]), new Set(["43.221@ostfold"]));
  assert.deepEqual(pool.map(u => u.organizationNumber), ["900000001"]);
  assert.deepEqual(websiteSupplementPool(candidates, new Set(), new Set()), []);
});

test("new regions have unique municipality codes and require their own research", () => {
  const codes = Object.values(LITE_REGIONS).flatMap(r => [...(r.municipalities ?? [])]);
  assert.equal(new Set(codes).size, codes.length);
  for (const [region, code, count] of [["ostfold", "3107", 12], ["buskerud", "3301", 18], ["vestfold", "3905", 6]] as const) {
    assert.equal(LITE_REGIONS[region]!.municipalities?.length, count);
    assert.equal(regionOfMunicipality(code), region);
    assert.deepEqual(assessResearch(liteSegment("43.221", region), undefined, Date.now()), { ok: false, reason: "NO_RESEARCH" });
  }
  assert.equal(regionOfMunicipality("3004"), undefined, "obsolete code never maps to a new region");
});

test("95/day fits the existing plan and simulation stops before the 96th send", async () => {
  const cfg = loadLiteSendConfig({ RESEND_DAILY_QUOTA: "100", RESEND_MONTHLY_QUOTA: "3000" });
  assert.equal(cfg.dailyLimit * 31, 2945);
  const records = Array.from({ length: 120 }, (_, i) => ({ id: `rec95${i}`, fields: {
    "Lead Status": "Lite Ready", Email: `post@launch${i}.example`,
    "Research Notes": `[GK-LITE] source=brreg orgnr=${900010000 + i} orgform=AS nace=96.021 kommune=0301`
  } }));
  const start = Date.parse("2026-10-17T05:00:00Z");
  const run = dryRunDeps(start, records);
  for (let tick = 0; tick < 96; tick++) {
    await runLiteSend(run.deps, { ...dryRunConfig(), ...cfg });
    run.advance(600000);
  }
  assert.equal(run.outbox.length, 95);
  assert.equal(new Set(run.outbox.map(o => o.key)).size, 95);
  assert.equal(new Set(run.outbox.map(o => o.email.to)).size, 95);
});

test("county regions map by the 2024 municipality prefix and resolve their municipalities from Brreg", async () => {
  assert.equal(regionOfMunicipality("3201"), "oslo-akershus", "listed regions win");
  assert.equal(regionOfMunicipality("3212"), "akershus");
  assert.equal(regionOfMunicipality("4601"), "vestland");
  assert.equal(regionOfMunicipality("5001"), "trondelag");
  assert.equal(regionOfMunicipality("1103"), "rogaland");
  assert.equal(regionOfMunicipality("4601x"), undefined);
  assert.equal(regionOfMunicipality("0101"), undefined, "pre-2020 codes map to nothing");
  const prefixes = Object.values(LITE_REGIONS).map(r => r.countyPrefix).filter(Boolean);
  assert.equal(new Set(prefixes).size, prefixes.length);
  const kommuner = (numbers: string[], status = 200) => (async () => new Response(JSON.stringify({ _embedded: { kommuner: numbers.map(nummer => ({ nummer })) } }), { status })) as typeof fetch;
  assert.deepEqual(await regionMunicipalities("akershus", kommuner(["3201", "3212", "3214", "4601", "3212"])), ["3212", "3214"]);
  assert.deepEqual(await regionMunicipalities("vestfold", kommuner([])), ["3901", "3903", "3905", "3907", "3909", "3911"]);
  await assert.rejects(regionMunicipalities("vestland", kommuner(["3212"])), /no municipalities/);
  await assert.rejects(regionMunicipalities("vestland", kommuner([], 503)), /503/);
  await assert.rejects(regionMunicipalities("atlantis"), /Unknown region/);
  assert.deepEqual(await assessResearch(liteSegment("43.221", "vestland"), undefined, Date.now()), { ok: false, reason: "NO_RESEARCH" });
});

test("SN2025 check reads Brreg's nationwide count and fails closed on a malformed answer", async () => {
  const urls: string[] = [];
  const total = (body: unknown) => (async (url: URL) => { urls.push(String(url)); return new Response(JSON.stringify(body)); }) as unknown as typeof fetch;
  assert.equal(await brregIndustryTotal("96.210", total({ page: { totalElements: 812 } })), 812);
  assert.match(urls[0]!, /naeringskode=96\.210/);
  assert.equal(await brregIndustryTotal("96.021", total({ page: { totalElements: 0 } })), 0);
  await assert.rejects(brregIndustryTotal("96.210", total({})), /BRREG_INVALID_TOTAL/);
});

test("the research workflow offers exactly the regions the code knows", async () => {
  const yml = await (await import("node:fs/promises")).readFile(".github/workflows/lite-market-research.yml", "utf8");
  const keys = Object.keys(LITE_REGIONS);
  assert.equal(/options: \[([^\]]+)\]/.exec(yml)?.[1], [...keys, "all"].join(", "));
  assert.equal(/regions=\(([^)]+)\); else/.exec(yml)?.[1], keys.join(" "));
});
