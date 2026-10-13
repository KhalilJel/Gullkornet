// Shared mailbox providers: an address on one of these domains says nothing about
// which business it belongs to, so business-level (domain) matching must skip them.
// Keep in sync with FREEMAIL_DOMAINS in openoutsend_ingest_api.py.
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.no", "outlook.com", "outlook.no",
  "live.com", "live.no", "msn.com", "yahoo.com", "yahoo.no", "icloud.com", "me.com",
  "mac.com", "aol.com", "protonmail.com", "proton.me", "online.no", "getmail.no",
  "broadpark.no", "frisurf.no", "start.no", "c2i.net", "altibox.no", "lyse.net"
]);

/** CIDEA's own sending domain is never a prospect business. */
export const CIDEA_DOMAINS: ReadonlySet<string> = new Set(["cideamarketing.com"]);

export function emailDomain(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  return at > 0 ? normalized.slice(at + 1).replace(/\.$/, "") : "";
}

/** The prospect business domain of an address, or undefined for freemail, CIDEA or invalid addresses. */
export function businessDomainOf(email: string): string | undefined {
  const domain = emailDomain(email);
  if (!domain || !domain.includes(".") || FREEMAIL_DOMAINS.has(domain) || CIDEA_DOMAINS.has(domain)) {
    return undefined;
  }
  return domain;
}
