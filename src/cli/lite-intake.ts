import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { researchContactAndDraft } from "../integrations/contact-research.js";
import type { GoogleCandidate } from "../integrations/website-audit.js";
import { discoverBrregLiteCandidates, lookupBrregByWebsite } from "../lite/brreg-lite.js";
import { airtableConfigFromEnv, createLiteRecords, emptyIndex, fetchExistingIndex, selectLiteLeads, type LiteSourceCandidate } from "../lite/intake.js";
import { documentedSegments, LITE_REGIONS, liteSegment, loadResearchIndex, regionMunicipalities, regionOfMunicipality } from "../lite/market-research.js";
import { brregToLiteCandidate, placesToLiteCandidate, websiteSupplementPool } from "../lite/places-supplement.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";

// npm run lite:intake -- --source brreg [--municipalities 0301,3201] [--industries 96.021,56.101] [--pages 3] [--start-page 0] [--limit 300] [--sync] [--out data/lite.json]
// npm run lite:intake -- --source website [same Brreg options]   (units whose registered address does not
//   qualify but who registered a website: a role address is looked for on that website; no Google calls)
// npm run lite:intake -- --source auto --target-buffer 700 [--website-cap 150] --sync   (daily refill: brreg + website
//   over every documented segment, stops when the Lite Ready buffer is full; an exhausted segment just adds 0)
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

  const airtable = sync || process.env.AIRTABLE_API_TOKEN ? airtableConfigFromEnv() : undefined;
  const existing = airtable ? await fetchExistingIndex(airtable) : emptyIndex();
  if (!airtable) console.log("No Airtable credentials: de-duplication against Airtable skipped (dry run only).");
  let room = limit;
  const targetBuffer = arg("target-buffer");
  if (targetBuffer !== undefined) {
    const target = Number(targetBuffer);
    if (!Number.isInteger(target) || target < 0 || target > 5000) throw new Error("--target-buffer must be 0-5000.");
    room = Math.min(limit, Math.max(0, target - existing.readyCount));
    console.log(`Lite Ready buffer: ${existing.readyCount} of ${target}; room this run: ${room}`);
    if (room === 0) { console.log("Buffer is full. Nothing to do."); return; }
  }

  if (source === "brreg" || source === "website" || source === "auto") {
    const documentedList = [...documented].map(key => key.split("@") as [string, string]);
    const onlyIndustries = list(arg("industries"));
    const query = { orgForms: allowedOrgForms, pagesPerQuery: Number(arg("pages") ?? "3") || 3, startPage: Number(arg("start-page") ?? "0") || 0 };
    let units: Awaited<ReturnType<typeof discoverBrregLiteCandidates>>;
    if (list(arg("municipalities")).length) {
      units = await discoverBrregLiteCandidates({
        ...query, municipalities: list(arg("municipalities")),
        industryCodes: onlyIndustries.length ? onlyIndustries : [...new Set(documentedList.map(([nace]) => nace))]
      });
    } else {
      // One query set per documented region, for that region's documented industries only: a code
      // researched in Vestfold is not fetched for the whole of Vestland.
      const byOrg = new Map<string, (typeof units)[number]>();
      for (const region of [...new Set(documentedList.map(([, r]) => r))]) {
        const industries = documentedList.filter(([nace, r]) => r === region && (!onlyIndustries.length || onlyIndustries.includes(nace))).map(([nace]) => nace);
        if (!LITE_REGIONS[region] || industries.length === 0) continue;
        const found = await discoverBrregLiteCandidates({ ...query, municipalities: await regionMunicipalities(region), industryCodes: industries });
        for (const unit of found) byOrg.set(unit.organizationNumber, unit);
      }
      units = [...byOrg.values()];
    }
    console.log(`Brreg units fetched: ${units.length}; with registered email: ${units.filter(u => u.email).length}`);
    if (source !== "website") candidates = units.map(brregToLiteCandidate);
    if (source !== "brreg") {
      // Only units the Brreg path cannot use and that are not already in Airtable; the website must
      // map back to exactly this unit. The list is rotated by day so a capped run moves through it.
      const cap = Math.max(1, Math.min(Number(arg("website-cap") ?? "150") || 150, 1000));
      const pool = websiteSupplementPool(units, existing.organizationNumbers, documented, allowedOrgForms);
      console.log(`Website candidates in documented segments, not already known: ${pool.length}; cap: ${cap}`);
      const offset = pool.length ? (Math.floor(Date.now() / 86_400_000) * cap) % pool.length : 0;
      const websiteOnly = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, cap);
      let matched = 0;
      let failed = 0;
      for (const unit of websiteOnly) {
        // One unit whose lookup fails (Brreg 5xx, an unreachable site) is skipped, not the whole run;
        // it stays unknown and comes round again in a later run.
        try {
          const registry = await lookupBrregByWebsite(unit.websiteUrl!);
          if (!registry || registry.organizationNumber !== unit.organizationNumber) continue;
          matched++;
          const place = { companyName: unit.companyName, websiteUrl: unit.websiteUrl, city: unit.city, industry: unit.industry, sourceUrl: unit.sourceUrl };
          const research = await researchContactAndDraft(place);
          const candidate = placesToLiteCandidate(place, research.emails, registry, allowedOrgForms, "website");
          if (candidate) candidates.push(candidate);
        } catch (error) {
          failed++;
          console.log(`Website unit skipped: ${error instanceof Error ? error.message : "lookup failed"}`);
          // A broad outage ends the website supplement; the candidates found so far are still synced.
          if (failed > 20 && failed > websiteOnly.length / 4) { console.log(`Website lookups failing (${failed}); website supplement stopped.`); break; }
        }
      }
      console.log(`Website-only units: ${websiteOnly.length}; website maps back to the unit: ${matched}; lookups failed: ${failed}`);
    }
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
    throw new Error("--source must be brreg, website, auto or places.");
  }

  const inSegment = candidates.filter(c => {
    const segment = liteSegment(c.industryCode, regionOfMunicipality(c.municipalityCode));
    return segment !== undefined && documented.has(segment.key);
  });
  console.log(`Documented segments: ${documented.size}; candidates in a documented segment: ${inSegment.length} of ${candidates.length}`);
  const selection = selectLiteLeads(inSegment, existing, allowedOrgForms);
  const leads = selection.leads.slice(0, room);
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
