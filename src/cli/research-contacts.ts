import { readFile } from "node:fs/promises";
import { researchContactsAndDrafts } from "../integrations/contact-research.js";
import type { GoogleCandidate, WebsiteAudit } from "../integrations/website-audit.js";

const candidatesPath = process.argv[2] ?? "data/google-candidates.json";
const auditPath = process.argv[3] ?? "data/website-audit.json";

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

try {
  const [candidateData, auditData] = await Promise.all([readJson(candidatesPath), readJson(auditPath)]);
  if (!Array.isArray(candidateData)) throw new Error("Candidate input must be a JSON array.");
  if (!Array.isArray(auditData)) throw new Error("Website audit input must be a JSON array.");

  const candidates: GoogleCandidate[] = candidateData.map((item, index) => {
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

  const audits = auditData as WebsiteAudit[];
  const results = await researchContactsAndDrafts(candidates, audits, 3);
  console.log(JSON.stringify(results, null, 2));
  const withEmail = results.filter((item) => item.emails.length > 0).length;
  const withDraft = results.filter((item) => Boolean(item.draftBody && item.subject)).length;
  console.error(`Contact research complete: ${withEmail} candidates have a publicly listed email, ${withDraft} have a personalized draft. Nothing was sent. Human review is required.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Contact research failed.");
  process.exitCode = 1;
}
