import { readFile } from "node:fs/promises";
import { auditCandidates, type GoogleCandidate } from "../integrations/website-audit.js";

const inputPath = process.argv[2] ?? "data/google-candidates.json";

try {
  const raw = await readFile(inputPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Input must be a JSON array of Google Places candidates.");

  const candidates: GoogleCandidate[] = parsed.map((item, index) => {
    if (!item || typeof item !== "object" || typeof item.companyName !== "string" || !item.companyName.trim()) {
      throw new Error(`Candidate at index ${index} is missing a valid companyName.`);
    }
    return {
      companyName: item.companyName,
      websiteUrl: typeof item.websiteUrl === "string" ? item.websiteUrl : undefined,
      city: typeof item.city === "string" ? item.city : undefined,
      industry: typeof item.industry === "string" ? item.industry : undefined,
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined
    };
  });

  const audits = await auditCandidates(candidates, 4);
  console.log(JSON.stringify(audits, null, 2));
  const audited = audits.filter((item) => item.status === "AUDITED").length;
  const noWebsite = audits.filter((item) => item.status === "NO_WEBSITE").length;
  const errors = audits.filter((item) => item.status === "FETCH_ERROR" || item.status === "BLOCKED_URL").length;
  console.error(`Website audit completed: ${audited} audited, ${noWebsite} without a website URL, ${errors} blocked/failed. Automated signals are not lead qualification.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Website audit failed.");
  process.exitCode = 1;
}
