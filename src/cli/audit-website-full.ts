import { auditCandidate } from "../integrations/website-audit.js";
import { runDeterministicSpecialistAudits } from "../agents/specialist-audits.js";
import { scoreAllCategories } from "../agents/specialist-score.js";

const url = process.argv[2];
if (!url) throw new Error("Usage: npm run audit:website:full -- https://example.com");

const audit = await auditCandidate({
  companyName: process.env.COMPANY_NAME ?? "Unknown",
  websiteUrl: url,
  sourceUrl: url
});

const findings = runDeterministicSpecialistAudits(audit);
const scores = scoreAllCategories(findings);

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  audit,
  scores,
  findings,
  status: "review_required"
}, null, 2));
