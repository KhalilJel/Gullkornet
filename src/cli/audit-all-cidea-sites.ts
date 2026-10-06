import { auditCandidate } from "../integrations/website-audit.js";
import { cideaTargetSchema, type CideaTarget } from "../domain/website-audit.js";

const entries = [
  ["CideaLead", process.env.CIDEA_LEAD_URL],
  ["CideaMarketing", process.env.CIDEA_MARKETING_URL],
  ["CideaConsulting", process.env.CIDEA_CONSULTING_URL]
] as const;

const targets = entries.filter(([, url]) => Boolean(url)) as [string, string][];
if (!targets.length) {
  throw new Error("Set CIDEA_LEAD_URL, CIDEA_MARKETING_URL and/or CIDEA_CONSULTING_URL before running audit:all.");
}

const results = await Promise.all(targets.map(async ([targetInput, url]) => {
  const target = cideaTargetSchema.parse(targetInput) as CideaTarget;
  const result = await auditCandidate({
    companyName: target,
    websiteUrl: url,
    sourceUrl: url
  });
  return { target, websiteUrl: url, result };
}));

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  count: results.length,
  results
}, null, 2));
