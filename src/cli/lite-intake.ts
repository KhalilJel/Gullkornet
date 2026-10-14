import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { researchContactAndDraft } from "../integrations/contact-research.js";
import type { GoogleCandidate } from "../integrations/website-audit.js";
import { discoverBrregLiteCandidates, lookupBrregByWebsite } from "../lite/brreg-lite.js";
import { airtableConfigFromEnv, createLiteRecords, emptyIndex, fetchExistingIndex, selectLiteLeads, type LiteSourceCandidate } from "../lite/intake.js";
import { documentedSegments, LITE_REGIONS, liteSegment, loadResearchIndex, regionOfMunicipality } from "../lite/market-research.js";
import { brregToLiteCandidate, placesToLiteCandidate } from "../lite/places-supplement.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";

// npm run lite:intake -- --source brreg [--municipalities 0301,3201] [--industries 96.021,56.101] [--pages 3] [--start-page 0] [--limit 300] [--sync] [--out data/lite.json]
// npm run lite:intake -- --source places --input data/google-candidates.json [--limit 50] [--sync]
// Without --sync nothing is written to Airtable. Logs contain counts only.
// Only leads in a segment (NACE x region) with fresh market research in research/segments are kept;
// without --industries, Brreg is queried for exactly those segments.

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const list = (value?: string) => (value ?? "").split(",").map(v => v.trim()).filter(Boolean);

async function main(): Promise<void> {
  const source = arg("source") ?? "brreg";
  const sync = process.argv.includes("--sync");
  const limit = Math.max(1, Math.min(Number(arg("limit") ?? "300") || 300, 2000));
  const allowedOrgForms = parseAllowedOrgForms(process.env.GULLKORNET_LITE_ORG_FORMS);
  let candidates: LiteSourceCandidate[] = [];
  const documented = new Set(documentedSegments(await loadResearchIndex(), Date.now()).map(segment => segment.key));
  if (documented.size === 0) {
    console.log("No segment has fresh market research (npm run lite:research). Nothing to do.");
    return;
  }

  if (source === "brreg") {
    const documentedList = [...documented].map(key => key.split("@"));
    const industries = list(arg("industries")).length ? list(arg("industries")) : [...new Set(documentedList.map(([nace]) => nace!))];
    const municipalities = list(arg("municipalities")).length ? list(arg("municipalities"))
      : [...new Set(documentedList.flatMap(([, region]) => [...(LITE_REGIONS[region!]?.municipalities ?? [])]))];
    const units = await discoverBrregLiteCandidates({
      municipalities,
      industryCodes: industries,
      orgForms: allowedOrgForms,
      pagesPerQuery: Number(arg("pages") ?? "3") || 3,
      startPage: Number(arg("start-page") ?? "0") || 0
    });
    candidates = units.map(brregToLiteCandidate);
    console.log(`Brreg units fetched: ${units.length}; with registered email: ${units.filter(u => u.email).length}`);
  } else if (source === "places") {
    const input = arg("input");
    if (!input) throw new Error("--input <google-candidates.json> is required for --source places.");
    const places = (JSON.parse(await readFile(input, "utf8")) as GoogleCandidate[]).filter(p => p.websiteUrl).slice(0, limit);
    let matched = 0;
    for (const place of places) {
      const registry = await lookupBrregByWebsite(place.websiteUrl!);
      if (!registry) continue;
      matched++;
      const research = await researchContactAndDraft(place);
      const candidate = placesToLiteCandidate(place, research.emails, registry, allowedOrgForms);
      if (candidate) candidates.push(candidate);
    }
    console.log(`Places candidates with website: ${places.length}; unique Brreg match: ${matched}`);
  } else {
    throw new Error("--source must be brreg or places.");
  }

  const airtable = sync || process.env.AIRTABLE_API_TOKEN ? airtableConfigFromEnv() : undefined;
  const existing = airtable ? await fetchExistingIndex(airtable) : emptyIndex();
  if (!airtable) console.log("No Airtable credentials: de-duplication against Airtable skipped (dry run only).");
  const inSegment = candidates.filter(c => {
    const segment = liteSegment(c.industryCode, regionOfMunicipality(c.municipalityCode));
    return segment !== undefined && documented.has(segment.key);
  });
  console.log(`Documented segments: ${documented.size}; candidates in a documented segment: ${inSegment.length} of ${candidates.length}`);
  const selection = selectLiteLeads(inSegment, existing, allowedOrgForms);
  const leads = selection.leads.slice(0, limit);
  console.log(`Lite selection: qualified=${selection.leads.length} usedThisRun=${leads.length} alreadyKnown=${selection.alreadyKnown} ` +
    `duplicateInBatch=${selection.duplicateInBatch} rejected=${JSON.stringify(selection.rejected)}`);

  const out = arg("out");
  if (out) {
    if (!out.startsWith("data/")) throw new Error("--out must be under data/ (git-ignored).");
    await writeFile(out, JSON.stringify(leads, null, 2), { mode: 0o600 });
  }
  if (sync && airtable) {
    const created = await createLiteRecords(leads, airtable);
    console.log(`Airtable: created ${created} Lite Ready records.`);
  } else {
    console.log("Dry run: nothing written to Airtable (add --sync to write).");
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Lite intake failed.");
  process.exitCode = 1;
});
