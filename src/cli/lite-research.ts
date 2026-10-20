import "dotenv/config";
import { auditCandidates } from "../integrations/website-audit.js";
import { brregIndustryTotal, discoverBrregLiteCandidates } from "../lite/brreg-lite.js";
import { assessResearch, buildSegmentResearch, LITE_REGIONS, regionMunicipalities, LITE_RESEARCH_MIN_EXAMINED, liteSegment, loadResearchIndex, saveResearch, spreadSample } from "../lite/market-research.js";

// npm run lite:research -- --industry 96.021 [--region oslo-akershus] [--sample 15] [--write]
// Fetches the front page of a spread sample of registered websites in the segment and stores
// what was actually observed in research/segments/. Without --write it only prints the summary.
// Reads public data only (Brønnøysund + the companies' own front pages); no Airtable, no email.
// npm run lite:research -- --industry 96.210 --show   -> decrypts and prints the stored research for review
// Research files are encrypted with GULLKORNET_LITE_RESEARCH_KEY (secret / local .env).

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const region = arg("region") ?? "oslo-akershus";
  const segment = liteSegment(arg("industry"), region);
  if (!segment) throw new Error(`--industry must be a NACE code such as 96.021 and --region one of: ${Object.keys(LITE_REGIONS).join(", ")}.`);
  if (process.argv.includes("--show")) {
    const research = (await loadResearchIndex()).get(segment.key);
    if (!research) throw new Error(`No stored research for ${segment.key}.`);
    console.log(JSON.stringify(research, null, 2));
    const decision = assessResearch(segment, research, Date.now());
    console.log(`Send gate: ${decision.ok ? "OK" : decision.reason}`);
    return;
  }
  const sampleSize = Math.max(LITE_RESEARCH_MIN_EXAMINED, Math.min(Number(arg("sample") ?? "15") || 15, 40));

  // SN2025 check first: an unknown code would otherwise look like a segment without websites.
  const registered = await brregIndustryTotal(segment.industryCode);
  if (registered === 0) throw new Error(`NACE ${segment.industryCode} has no active units in Brreg; check the SN2025 code.`);
  const municipalities = await regionMunicipalities(region);
  console.log(`Segment ${segment.key}: ${registered} active units nationwide; ${municipalities.length} municipalities in ${LITE_REGIONS[region]!.name}.`);
  const units = (await discoverBrregLiteCandidates({
    municipalities,
    industryCodes: [segment.industryCode],
    orgForms: ["AS", "ASA"],
    pagesPerQuery: 3
  })).filter(unit => unit.websiteUrl);
  // A few extra sites cover pages that cannot be read; the result records every attempt.
  const sample = spreadSample(units, Math.min(units.length, sampleSize + 5));
  const audits = await auditCandidates(sample.map(unit => ({ companyName: unit.companyName, websiteUrl: unit.websiteUrl, industry: unit.industry })));
  const research = buildSegmentResearch(segment, sample, audits, new Date());

  console.log(`Segment ${segment.key}: registered websites=${units.length} attempted=${research.attempted} examined=${research.examined} ` +
    `supportsTemplate=${research.supportsTemplate}`);
  for (const o of research.observations) console.log(`  ${o.count}/${research.examined} ${o.text}`);
  if (!research.supportsTemplate) {
    console.log(`Not enough evidence for the template claim (need >= ${LITE_RESEARCH_MIN_EXAMINED} examined sites and at least one common gap). Sending stays blocked for this segment.`);
  }
  if (process.argv.includes("--write")) console.log(`Wrote ${await saveResearch(research)}`);
  else console.log("Dry run: add --write to store the research file.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Lite research failed.");
  process.exitCode = 1;
});
