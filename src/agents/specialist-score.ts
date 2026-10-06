import type { AuditCategory, AuditFinding } from "../domain/website-audit.js";

const WEIGHT: Record<AuditFinding["severity"], number> = {
  low: 1, medium: 2, high: 4, critical: 6
};

export function scoreCategory(findings: AuditFinding[], category: AuditCategory): number {
  const penalty = findings
    .filter((f) => f.category === category)
    .reduce((sum, f) => sum + WEIGHT[f.severity] * f.confidence, 0);
  return Math.max(0, Math.min(100, Math.round(100 - penalty * 8)));
}

export function scoreAllCategories(findings: AuditFinding[]): Record<AuditCategory, number> {
  return {
    UX: scoreCategory(findings, "UX"),
    SEO: scoreCategory(findings, "SEO"),
    CRO: scoreCategory(findings, "CRO"),
    DESIGN: scoreCategory(findings, "DESIGN"),
    CONTENT: scoreCategory(findings, "CONTENT"),
    PERFORMANCE: scoreCategory(findings, "PERFORMANCE"),
    TRUST: scoreCategory(findings, "TRUST")
  };
}
