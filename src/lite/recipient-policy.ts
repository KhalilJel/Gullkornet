import { businessDomainOf, CIDEA_DOMAINS, emailDomain, FREEMAIL_DOMAINS } from "../domain/email-domain.js";
import { isSharedBusinessInbox } from "../integrations/outbound-email.js";

// Marketing Control Act (markedsføringsloven) § 15 protects natural persons. Forbrukertilsynet's
// guidance: a named work address (ola@firma.no) is a natural person even if it is registered in
// Brønnøysund, a role address that belongs to no specific person (post@firma.no) is not, and when
// in doubt the sender carries the risk. Gullkornet Lite therefore only uses:
//   1. legal-person organisation forms (default AS/ASA; ENK and all other forms are excluded),
//   2. a role/shared mailbox from the existing allow-list (post@, info@, kontakt@ ...),
//   3. a non-freemail business domain that matches the registered website when one is known,
//   4. companies that are not bankrupt or being wound up.
// Anything uncertain is excluded (fail closed).

export const DEFAULT_LITE_ORG_FORMS: readonly string[] = Object.freeze(["AS", "ASA"]);

export type LiteRecipientInput = {
  email?: string;
  orgForm?: string;
  websiteUrl?: string;
  bankrupt?: boolean;
  windingUp?: boolean;
};

export type LiteRejectReason =
  | "NO_EMAIL"
  | "INVALID_EMAIL"
  | "ORG_FORM_NOT_ALLOWED"
  | "ORG_FORM_UNKNOWN"
  | "FREEMAIL"
  | "PERSONAL_OR_NAMED_ADDRESS"
  | "CIDEA_DOMAIN"
  | "EMAIL_DOMAIN_MISMATCH"
  | "COMPANY_INACTIVE";

export type LiteRecipientDecision = { ok: true; email: string } | { ok: false; reason: LiteRejectReason };

function hostOf(url?: string): string {
  if (!url?.trim()) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** True when the email domain is the website host, or one is a subdomain of the other. */
export function emailMatchesWebsite(email: string, websiteUrl: string): boolean {
  const domain = emailDomain(email).replace(/^www\./, "");
  const host = hostOf(websiteUrl);
  if (!domain || !host) return false;
  return domain === host || host.endsWith("." + domain) || domain.endsWith("." + host);
}

export function normalizeOrgForm(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

export function assessLiteRecipient(
  input: LiteRecipientInput,
  allowedOrgForms: readonly string[] = DEFAULT_LITE_ORG_FORMS
): LiteRecipientDecision {
  const orgForm = normalizeOrgForm(input.orgForm);
  if (!orgForm) return { ok: false, reason: "ORG_FORM_UNKNOWN" };
  if (!allowedOrgForms.map(normalizeOrgForm).includes(orgForm)) return { ok: false, reason: "ORG_FORM_NOT_ALLOWED" };
  if (input.bankrupt === true || input.windingUp === true) return { ok: false, reason: "COMPANY_INACTIVE" };

  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "NO_EMAIL" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: "INVALID_EMAIL" };
  const domain = emailDomain(email);
  if (FREEMAIL_DOMAINS.has(domain)) return { ok: false, reason: "FREEMAIL" };
  if (CIDEA_DOMAINS.has(domain)) return { ok: false, reason: "CIDEA_DOMAIN" };
  if (!isSharedBusinessInbox(email) || !businessDomainOf(email)) return { ok: false, reason: "PERSONAL_OR_NAMED_ADDRESS" };
  if (input.websiteUrl?.trim() && !emailMatchesWebsite(email, input.websiteUrl)) {
    return { ok: false, reason: "EMAIL_DOMAIN_MISMATCH" };
  }
  return { ok: true, email };
}

export function parseAllowedOrgForms(value?: string): string[] {
  const forms = (value ?? "").split(",").map(normalizeOrgForm).filter(Boolean);
  if (forms.length === 0) return [...DEFAULT_LITE_ORG_FORMS];
  if (forms.includes("ENK")) throw new Error("ENK can never be an allowed Gullkornet Lite organisation form.");
  // Only limited companies: in ANS, DA, NUF and similar forms the owners can be natural persons.
  const other = forms.filter(form => !DEFAULT_LITE_ORG_FORMS.includes(form));
  if (other.length) throw new Error(`Gullkornet Lite allows only ${DEFAULT_LITE_ORG_FORMS.join(", ")}; refused: ${other.join(", ")}.`);
  return forms;
}
