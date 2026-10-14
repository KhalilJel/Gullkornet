import type { GoogleCandidate } from "../integrations/website-audit.js";
import type { PublicEmail } from "../integrations/contact-research.js";
import type { BrregLiteCandidate } from "./brreg-lite.js";
import type { LiteSourceCandidate } from "./intake.js";
import { assessLiteRecipient } from "./recipient-policy.js";

/**
 * Turns one Places candidate into a Lite candidate. The organisation form must come from
 * Brønnøysund (a unique registry match on the website); without it the candidate is dropped,
 * because an unknown form could be an ENK. The website's role address is preferred; the
 * registry address is the fallback.
 */
export function placesToLiteCandidate(
  place: GoogleCandidate,
  websiteEmails: PublicEmail[],
  registry: BrregLiteCandidate | undefined,
  allowedOrgForms?: readonly string[]
): LiteSourceCandidate | undefined {
  if (!registry || !place.websiteUrl) return undefined;
  const base = {
    source: "places" as const,
    organizationNumber: registry.organizationNumber,
    companyName: place.companyName || registry.companyName,
    orgForm: registry.orgForm,
    websiteUrl: place.websiteUrl,
    city: place.city ?? registry.city,
    industry: place.industry ?? registry.industry,
    industryCode: registry.industryCode,
    municipalityCode: registry.municipalityCode,
    bankrupt: registry.bankrupt,
    windingUp: registry.windingUp,
    sourceUrl: place.sourceUrl || registry.sourceUrl
  };
  for (const found of websiteEmails) {
    if (assessLiteRecipient({ ...base, email: found.email }, allowedOrgForms).ok) {
      return { ...base, email: found.email, contactSourceUrl: found.sourceUrl };
    }
  }
  if (registry.email && assessLiteRecipient({ ...base, email: registry.email }, allowedOrgForms).ok) {
    return { ...base, email: registry.email, contactSourceUrl: registry.sourceUrl };
  }
  return { ...base, email: websiteEmails[0]?.email ?? registry.email };
}

export function brregToLiteCandidate(unit: BrregLiteCandidate): LiteSourceCandidate {
  return {
    source: "brreg",
    organizationNumber: unit.organizationNumber,
    companyName: unit.companyName,
    orgForm: unit.orgForm,
    email: unit.email,
    websiteUrl: unit.websiteUrl,
    city: unit.city,
    industry: unit.industry,
    industryCode: unit.industryCode,
    municipalityCode: unit.municipalityCode,
    bankrupt: unit.bankrupt,
    windingUp: unit.windingUp,
    sourceUrl: unit.sourceUrl,
    contactSourceUrl: unit.sourceUrl
  };
}
