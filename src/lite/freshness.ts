import { Resolver } from "node:dns/promises";
import { emailDomain } from "../domain/email-domain.js";
import { toLiteCandidate } from "./brreg-lite.js";
import { DEFAULT_LITE_ORG_FORMS, normalizeOrgForm } from "./recipient-policy.js";

// A Lite Ready row can wait days or weeks before it is sent. Right before sending, the facts the
// intake relied on are checked again against their sources: the company is still registered,
// active and a limited company, the address is still the one it registered (Brreg leads), and the
// email domain still receives mail. A changed fact refuses the row; an unreachable source stops the
// run (never read as "still valid").

const API = "https://data.brreg.no/enhetsregisteret/api/enheter";

export type FreshnessReason =
  | "NO_ORGNR"
  | "UNIT_GONE"
  | "UNIT_INACTIVE"
  | "ORG_FORM_CHANGED"
  | "EMAIL_NOT_REGISTERED"
  | "NO_MAIL_SERVER"
  | "DNS_TEMPORARY";

/** Only this reason is worth retrying later; the others are facts about the company or domain. */
export const TEMPORARY_FRESHNESS_REASONS: ReadonlySet<FreshnessReason> = new Set(["DNS_TEMPORARY"]);

// Bounded resolver: a dead domain's nameservers answer with a timeout after about 10 s instead of
// the system default's minutes. A timeout is still treated as "cannot receive mail now".
const resolver = new Resolver({ timeout: 3000, tries: 2 });
const boundedResolveMx = (domain: string) => resolver.resolveMx(domain);

export type FreshnessDeps = {
  fetchImpl?: typeof fetch;
  resolveMxImpl?: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
};

export function orgnrFromNotes(notes: string): string | undefined {
  return /(?:^|\s)orgnr=(\d{9})(?:\s|$)/.exec(notes)?.[1];
}

export function sourceFromNotes(notes: string): string | undefined {
  return /(?:^|\s)source=([a-z]+)/.exec(notes)?.[1];
}

/** Brreg's current record for the unit. Returns a refusal reason, undefined when still valid; throws on an outage. */
export async function checkBrregStillValid(
  notes: string,
  email: string,
  allowedOrgForms: readonly string[] = DEFAULT_LITE_ORG_FORMS,
  fetchImpl: typeof fetch = fetch
): Promise<FreshnessReason | undefined> {
  const orgnr = orgnrFromNotes(notes);
  if (!orgnr) return "NO_ORGNR";
  const response = await fetchImpl(`${API}/${orgnr}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  // 404: never existed or removed; 410: deleted from the register.
  if (response.status === 404 || response.status === 410) return "UNIT_GONE";
  if (!response.ok) throw new Error(`Brreg lookup failed (HTTP ${response.status}). Refusing to send.`);
  const unit = await response.json().catch(() => null);
  if (!unit || typeof unit !== "object") throw new Error("Brreg returned an invalid unit. Refusing to send.");
  const candidate = toLiteCandidate(unit as Parameters<typeof toLiteCandidate>[0]);
  if (!candidate || candidate.organizationNumber !== orgnr) return "UNIT_GONE";
  if (candidate.bankrupt || candidate.windingUp) return "UNIT_INACTIVE";
  if (!allowedOrgForms.map(normalizeOrgForm).includes(candidate.orgForm)) return "ORG_FORM_CHANGED";
  // Brreg leads use the address the company registered; if it has changed, the source no longer supports it.
  if (sourceFromNotes(notes) === "brreg" && candidate.email !== email.trim().toLowerCase()) return "EMAIL_NOT_REGISTERED";
  return undefined;
}

/** A domain whose MX lookup must always work; used to tell a broken recipient domain from a resolver outage. */
export const DNS_CONTROL_DOMAIN = "cideamarketing.com";

export type MailServerStatus = "ok" | "none" | "temporary";

/**
 * "ok" when the domain publishes a usable MX record; "none" for no domain / no MX / null MX.
 * Any other DNS error (SERVFAIL, timeout ...) is checked against a control domain: if the control
 * still resolves, the fault lies with the recipient's domain ("temporary": cannot receive mail now,
 * may recover); if the control fails too, the resolver is down and the run stops (throws).
 */
export async function mailServerStatus(email: string, resolve: FreshnessDeps["resolveMxImpl"] = boundedResolveMx): Promise<MailServerStatus> {
  const domain = emailDomain(email);
  if (!domain) return "none";
  try {
    const records = await resolve(domain);
    // RFC 7505 null MX ("." / empty exchange): the domain accepts no mail.
    return records.some(record => record.exchange && record.exchange !== ".") ? "ok" : "none";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") return "none";
    let controlOk = false;
    try {
      controlOk = (await resolve(DNS_CONTROL_DOMAIN)).length > 0;
    } catch {
      controlOk = false;
    }
    if (controlOk) return "temporary";
    throw new Error(`DNS lookup failed (${typeof code === "string" ? code : "unknown"}). Refusing to send.`);
  }
}

/** True only when the domain can receive mail now. */
export async function hasMailServer(email: string, resolve: FreshnessDeps["resolveMxImpl"] = boundedResolveMx): Promise<boolean> {
  return await mailServerStatus(email, resolve) === "ok";
}

export async function checkLiteFreshness(
  notes: string,
  email: string,
  allowedOrgForms?: readonly string[],
  deps: FreshnessDeps = {}
): Promise<FreshnessReason | undefined> {
  const registry = await checkBrregStillValid(notes, email, allowedOrgForms, deps.fetchImpl);
  if (registry) return registry;
  const mx = await mailServerStatus(email, deps.resolveMxImpl);
  return mx === "ok" ? undefined : mx === "none" ? "NO_MAIL_SERVER" : "DNS_TEMPORARY";
}
