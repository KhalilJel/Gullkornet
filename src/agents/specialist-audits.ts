import type { WebsiteAudit, AuditFinding } from "../domain/website-audit.js";

export type SpecialistAudit = "UX" | "SEO" | "CRO" | "DESIGN" | "CONTENT" | "PERFORMANCE" | "TRUST";

function finding(
  category: AuditFinding["category"],
  severity: AuditFinding["severity"],
  title: string,
  observation: string,
  recommendation: string,
  sourceUrl: string,
  confidence = 0.95
): AuditFinding {
  return { category, severity, title, observation, recommendation,
    evidence: [{ sourceUrl, observation }], confidence };
}

export function runDeterministicSpecialistAudits(audit: WebsiteAudit): AuditFinding[] {
  if (!audit.websiteUrl) return [];
  const url = audit.finalUrl ?? audit.websiteUrl;
  const findings: AuditFinding[] = [];

  if (audit.flags.includes("MISSING_TITLE")) findings.push(
    finding("SEO","high","Missing page title","The page does not expose a usable HTML title.","Add a concise, descriptive title aligned with the page's primary search intent.",url)
  );
  if (audit.flags.includes("MISSING_META_DESCRIPTION")) findings.push(
    finding("SEO","medium","Missing meta description","No meta description was detected.","Add a useful description that explains the offer and encourages qualified clicks.",url)
  );
  if (audit.flags.includes("MISSING_VIEWPORT_META")) findings.push(
    finding("UX","high","Missing viewport configuration","No viewport meta tag was detected.","Add responsive viewport configuration and verify the mobile experience.",url)
  );
  if (audit.flags.includes("NO_OBVIOUS_CONTACT_PATH")) findings.push(
    finding("CRO","high","No obvious contact path","The first page did not expose an obvious contact, booking or appointment path.","Add a clear primary next step that matches the business's commercial goal.",url)
  );
  if (audit.flags.includes("NOT_HTTPS")) findings.push(
    finding("TRUST","critical","Website is not using HTTPS","The final URL is not HTTPS.","Enable HTTPS and redirect HTTP traffic to the secure canonical URL.",url)
  );
  if (audit.flags.includes("HTTP_ERROR")) findings.push(
    finding("PERFORMANCE","critical","Website returned an HTTP error","The audited page returned an HTTP status in the error range.","Resolve the server or routing error before making conversion recommendations.",url)
  );
  if (audit.flags.includes("NO_EMAIL_LINK_DETECTED")) findings.push(
    finding("CRO","low","No email link detected","No mailto link was found on the audited page.","Confirm that visitors still have a low-friction contact option; an email link is optional.",url,0.8)
  );

  if (audit.title && audit.title.length > 60) findings.push(
    finding("SEO","low","Long page title","The title is longer than 60 characters.","Review the title for clarity and search-result truncation.",url,0.9)
  );

  return findings;
}
