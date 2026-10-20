// What failed deliveries have in common, compared with the deliveries that went through. Aggregates
// only: each sent email is reduced to a few coarse features, and only counts per feature value are
// printed, never an address, a domain or a record.

export type BounceFeatures = {
  /** role (post@, firmapost@ ...), personal (ola.nordmann@), other */
  localPart: "role" | "personal" | "other";
  /** Address domain equals the registered website's domain. */
  domainMatchesWebsite: "yes" | "no" | "no_website";
  freemail: "yes" | "no";
  /** Where the address was found: Brreg registration or the company's own website. */
  source: string;
  /** The mail host family behind the domain's MX records. */
  mxProvider: string;
};

const ROLE_LOCAL_PARTS = new Set([
  "post", "postmottak", "postmaster", "firmapost", "info", "kontakt", "kontor", "mail", "epost", "e-post", "admin",
  "office", "hei", "hello", "salg", "sales", "booking", "bestilling", "service", "kundeservice", "regnskap", "faktura", "ordre"
]);
const FREEMAIL = new Set(["gmail.com", "hotmail.com", "hotmail.no", "outlook.com", "live.no", "live.com", "yahoo.com", "yahoo.no", "icloud.com", "online.no", "msn.com"]);
const MX_FAMILIES: [RegExp, string][] = [
  [/(^|\.)(google|googlemail)\.com$/, "google"],
  [/(^|\.)(outlook\.com|protection\.outlook\.com|hotmail\.com)$/, "microsoft"],
  [/(^|\.)domeneshop\.no$/, "domeneshop"],
  [/(^|\.)one\.com$/, "one.com"],
  [/(^|\.)(telenor\.net|online\.no)$/, "telenor"],
  [/(^|\.)(pphosted\.com|mimecast\.com|messagelabs\.com|barracudanetworks\.com)$/, "security_gateway"],
  [/(^|\.)(webhuset\.no|uniweb\.no|syse\.no|proisp\.no|servetheworld\.net)$/, "norwegian_hosting"]
];

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return undefined; }
}

export function mxFamily(hosts: string[] | undefined): string {
  if (hosts === undefined) return "lookup_failed";
  if (hosts.length === 0) return "none";
  const host = hosts[0]!.toLowerCase().replace(/\.$/, "");
  return MX_FAMILIES.find(([pattern]) => pattern.test(host))?.[1] ?? "other";
}

export function bounceFeatures(email: string, notes: string, website: string | undefined, mxHosts: string[] | undefined): BounceFeatures {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const site = hostOf(website);
  return {
    localPart: ROLE_LOCAL_PARTS.has(local) ? "role" : /^[a-zæøå]+([.\-_][a-zæøå]+)+$/.test(local) ? "personal" : "other",
    domainMatchesWebsite: !site ? "no_website" : site === domain || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`) ? "yes" : "no",
    freemail: FREEMAIL.has(domain) ? "yes" : "no",
    source: /(?:^|\s)source=(\w+)/.exec(notes)?.[1] ?? "unknown",
    mxProvider: mxFamily(mxHosts)
  };
}

export type AnalysisRow = { features: BounceFeatures; failed: boolean };
export type FeatureLine = { feature: keyof BounceFeatures; value: string; sent: number; failed: number; rate: number };

/** Failure rate per feature value, highest rate first within each feature. */
export function analyzeBounces(rows: AnalysisRow[]): FeatureLine[] {
  const lines: FeatureLine[] = [];
  const features = Object.keys(rows[0]?.features ?? {}) as (keyof BounceFeatures)[];
  for (const feature of features) {
    const byValue = new Map<string, { sent: number; failed: number }>();
    for (const row of rows) {
      const value = row.features[feature];
      const entry = byValue.get(value) ?? { sent: 0, failed: 0 };
      entry.sent++;
      if (row.failed) entry.failed++;
      byValue.set(value, entry);
    }
    lines.push(...[...byValue].map(([value, c]) => ({ feature, value, sent: c.sent, failed: c.failed, rate: c.failed / c.sent }))
      .sort((a, b) => b.rate - a.rate || b.sent - a.sent));
  }
  return lines;
}
