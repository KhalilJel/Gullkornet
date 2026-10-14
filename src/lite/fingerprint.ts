import { createHmac } from "node:crypto";
import { businessDomainOf } from "../domain/email-domain.js";
import type { LiteQueueRecord } from "./send.js";

// Keyed fingerprints of business domains, so a public Actions log can answer "is this business
// already in Airtable, and in which status?" without naming it. The key is the Lite research key
// (GitHub secret + owner's .env); without it a fingerprint cannot be linked to a domain.

export function domainFingerprint(domain: string, key: string): string {
  if (!key) throw new Error("A fingerprint key is required.");
  return createHmac("sha256", key).update(domain.trim().toLowerCase().replace(/^www\./, "")).digest("hex").slice(0, 16);
}

function domainsOf(row: LiteQueueRecord): string[] {
  const out = new Set<string>();
  const email = typeof row.fields.Email === "string" ? row.fields.Email : "";
  const domain = email ? businessDomainOf(email) : undefined;
  if (domain) out.add(domain);
  const website = typeof row.fields.Website === "string" ? row.fields.Website.trim() : "";
  if (website) {
    try {
      out.add(new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, ""));
    } catch { /* not a URL */ }
  }
  return [...out];
}

export type FingerprintMatch = { fingerprint: string; statuses: string[]; doNotContact: boolean };

/** For each requested fingerprint: the Lead Status of every row on that domain, and whether any row is DNC. */
export function lookupFingerprints(rows: LiteQueueRecord[], requested: string[], key: string): FingerprintMatch[] {
  const wanted = new Set(requested.map(f => f.trim().toLowerCase()).filter(f => /^[0-9a-f]{16}$/.test(f)));
  const found = new Map<string, FingerprintMatch>();
  for (const row of rows) {
    for (const domain of domainsOf(row)) {
      const fp = domainFingerprint(domain, key);
      if (!wanted.has(fp)) continue;
      const match = found.get(fp) ?? { fingerprint: fp, statuses: [], doNotContact: false };
      match.statuses.push(typeof row.fields["Lead Status"] === "string" ? row.fields["Lead Status"] : "(empty)");
      if (row.fields["Do Not Contact"] === true) match.doNotContact = true;
      found.set(fp, match);
    }
  }
  return [...wanted].map(fp => found.get(fp) ?? { fingerprint: fp, statuses: [], doNotContact: false });
}
