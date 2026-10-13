import { assessCideaRouting, formatRoutingNotes, type RoutingAssessment } from "../domain/cidea-routing.js";
import type { Finding, ProviderAttempt } from "../domain/research-evidence.js";
import type { PageContent } from "./research-router.js";
import type { GoogleCandidate, WebsiteAudit } from "./website-audit.js";

// Turns what the pipeline already observed about one company into source-backed findings,
// then asks the Cidea routing rules what it supports. Only automated signals that are
// reproducible from a public page are recorded as facts, and each cites the page it came from.

const SIGNAL_STATEMENTS: Record<string, string> = {
  MISSING_TITLE: "Forsiden har ingen sidetittel (<title>).",
  MISSING_META_DESCRIPTION: "Forsiden har ingen meta-beskrivelse.",
  MISSING_VIEWPORT_META: "Forsiden mangler viewport-meta (mulig svak mobiltilpasning).",
  NO_OBVIOUS_CONTACT_PATH: "Forsiden har ingen tydelig lenke til kontakt eller bestilling.",
  NOT_HTTPS: "Nettstedet ble levert uten HTTPS.",
  HTTP_ERROR: "Forsiden svarte med en HTTP-feilkode."
};

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function findingsFromAudit(candidate: GoogleCandidate, audit?: WebsiteAudit): Finding[] {
  const findings: Finding[] = [];
  if (!candidate.websiteUrl || audit?.status === "NO_WEBSITE") {
    // The absence of a website is only a fact about what Google Places returned.
    if (isHttpUrl(candidate.sourceUrl)) {
      findings.push({
        kind: "fact",
        statement: "Google Places oppgir ingen nettside for bedriften.",
        sourceUrl: candidate.sourceUrl,
        retrievedAt: audit?.checkedAt ?? new Date().toISOString(),
        confidence: 0.85,
        provider: "google-places",
        signal: "NO_WEBSITE"
      });
    }
    return findings;
  }
  if (audit?.status !== "AUDITED") return findings;
  const sourceUrl = audit.finalUrl ?? audit.websiteUrl ?? candidate.websiteUrl;
  if (!isHttpUrl(sourceUrl)) return findings;
  for (const flag of audit.flags) {
    const statement = SIGNAL_STATEMENTS[flag];
    if (!statement) continue;
    findings.push({
      kind: "fact",
      statement,
      sourceUrl,
      retrievedAt: audit.checkedAt,
      confidence: 0.9,
      provider: "builtin-fetch",
      signal: flag
    });
  }
  return findings;
}

/** Facts from a page read by Firecrawl or a browser path, when the built-in fetch could not. */
export function findingsFromScrapedPage(page: PageContent, provider: "firecrawl" | "jev-ultrafast" | "browser-use", retrievedAt: string): Finding[] {
  if (!isHttpUrl(page.url)) return [];
  const findings: Finding[] = [];
  if (provider === "firecrawl") {
    // Firecrawl exposes page metadata, so only these two signals can be stated as facts.
    if (!page.title?.trim()) {
      findings.push({ kind: "fact", statement: SIGNAL_STATEMENTS.MISSING_TITLE!, sourceUrl: page.url, retrievedAt, confidence: 0.8, provider, signal: "MISSING_TITLE" });
    }
    if (!page.description?.trim()) {
      findings.push({ kind: "fact", statement: SIGNAL_STATEMENTS.MISSING_META_DESCRIPTION!, sourceUrl: page.url, retrievedAt, confidence: 0.8, provider, signal: "MISSING_META_DESCRIPTION" });
    }
  }
  return findings;
}

export type ResearchProvenance = {
  attempts: ProviderAttempt[];
  scrapedPage?: PageContent;
  scrapedBy?: "firecrawl" | "jev-ultrafast" | "browser-use";
  builtinReadable: boolean;
};

export function buildRoutingForCompany(
  candidate: GoogleCandidate,
  audit: WebsiteAudit | undefined,
  provenance: ResearchProvenance,
  now: () => Date = () => new Date()
): { assessment: RoutingAssessment; notes: string[] } {
  const findings: Finding[] = [...findingsFromAudit(candidate, audit)];
  if (provenance.scrapedPage && provenance.scrapedBy) {
    findings.push(...findingsFromScrapedPage(provenance.scrapedPage, provenance.scrapedBy, now().toISOString()));
  }
  const hasWebsite = Boolean(candidate.websiteUrl) && audit?.status !== "NO_WEBSITE";
  let completeness: "complete" | "partial" | "insufficient";
  if (!hasWebsite) completeness = audit?.status === "NO_WEBSITE" || !candidate.websiteUrl ? "complete" : "insufficient";
  else if (provenance.builtinReadable && audit?.status === "AUDITED") completeness = "complete";
  else if (provenance.scrapedPage) completeness = "partial";
  else completeness = "insufficient";
  const assessment = assessCideaRouting({ findings, hasWebsite, completeness, now });
  return { assessment, notes: formatRoutingNotes(assessment, provenance.attempts) };
}
