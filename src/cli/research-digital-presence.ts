import { readFile } from "node:fs/promises";
import { researchDigitalPresences } from "../integrations/digital-presence.js";
import type { GoogleCandidate } from "../integrations/website-audit.js";

const inputPath = process.argv[2] ?? "data/google-candidates.json";

try {
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Candidate input must be a JSON array.");
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
  const results = await researchDigitalPresences(candidates, 3);
  console.log(JSON.stringify(results, null, 2));
  const counts = {
    noWebsiteListed: results.filter((item) => item.segment === "NO_WEBSITE_LISTED").length,
    withSocialLinks: results.filter((item) => item.segment === "WEBSITE_WITH_SOCIAL_LINKS").length,
    withoutDetectedSocialLinks: results.filter((item) => item.segment === "WEBSITE_WITHOUT_DETECTED_SOCIAL_LINKS").length,
    fetchErrors: results.filter((item) => item.segment === "FETCH_ERROR" || item.segment === "BLOCKED_URL").length
  };
  console.error("Digital presence research complete:", JSON.stringify(counts), "No emails were sent. Absence of a link is not proof of absence of a social profile.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Digital presence research failed.");
  process.exitCode = 1;
}
