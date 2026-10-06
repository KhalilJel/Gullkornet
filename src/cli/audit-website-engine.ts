import { auditCandidate } from "../integrations/website-audit.js";
import { cideaTargetSchema, websiteAuditSchema, TARGET_PRIORITIES, type AuditCategory, type CideaTarget } from "../domain/website-audit.js";
import { cideaTargets } from "../domain/cidea-targets.js";

const url = process.argv[2];
const targetInput = process.argv[3] ?? "CideaLead";
const companyName = process.argv[4] ?? new URL(url ?? "https://invalid.local").hostname;

if (!url) {
  throw new Error("Usage: npm run audit:website -- <url> [CideaLead|CideaMarketing|CideaConsulting] [companyName]");
}

const target = cideaTargetSchema.parse(targetInput) as CideaTarget;
const result = await auditCandidate({ companyName, websiteUrl: url, sourceUrl: url });

const evidence = result.flags.map(flag => ({
  category: flag.includes("TITLE") || flag.includes("META") ? "SEO" : flag.includes("CONTACT") ? "CRO" : flag.includes("VIEWPORT") ? "UX" : flag.includes("HTTPS") ? "TRUST" : "UX",
  severity: flag.includes("HTTP_ERROR") || flag.includes("BLOCKED") ? "critical" : "medium",
  title: flag.replaceAll("_", " ").toLowerCase(),
  observation: flag,
  recommendation: "Review this signal before making a production change.",
  evidence: [{ sourceUrl: result.finalUrl ?? url, observation: result.note ?? flag }],
  confidence: 0.9
}));

const score = (category: AuditCategory): number => {
  const deductions = evidence.filter(item => item.category === category).reduce((sum, item) => sum + (item.severity === "critical" ? 35 : 15), 0);
  return Math.max(0, 80 - deductions);
};

const audit = websiteAuditSchema.parse({
  target,
  websiteUrl: result.finalUrl ?? url,
  auditedAt: result.checkedAt,
  scores: {
    UX: score("UX"),
    SEO: score("SEO"),
    CRO: score("CRO"),
    DESIGN: 60,
    CONTENT: 60,
    PERFORMANCE: result.responseTimeMs && result.responseTimeMs < 1500 ? 75 : 55,
    TRUST: result.https ? 75 : 35
  },
  findings: evidence,
  topPriorities: TARGET_PRIORITIES[target]
    .filter(category => evidence.some(item => item.category === category))
    .slice(0, 5)
    .map(category => evidence.find(item => item.category === category)!.title),
  status: "review_required"
});

console.log(JSON.stringify({
  ...audit,
  companyName,
  targetPurpose: cideaTargets[target].purpose,
  primaryQuestion: cideaTargets[target].primaryQuestion,
  websiteSignals: result
}, null, 2));
