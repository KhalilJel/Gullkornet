import { createHash } from "node:crypto";
import { assertAirtableWritesAllowed } from "../domain/airtable-write-guard.js";
import type { SendLedgerEntry } from "../integrations/outbound-email.js";
import type { AirtableConfig } from "./intake.js";
import type { LiteQueueRecord } from "./send.js";
import { fetchReadWithRetry } from "./http-retry.js";

// Read-only investigation of the Resend events that trip the delivery-health stop
// (resend-pilot.ts). Output carries no addresses: a recipient is a short hash plus the
// Airtable record ID, and any address or recipient domain in provider text is masked.

export const FAILED_EVENTS = ["bounced", "complained", "failed", "suppressed"] as const;
/** Events after which the address must never be emailed again. "failed" is a send-side error, reported only. */
export const SUPPRESS_EVENTS = new Set(["bounced", "complained", "suppressed"]);

// Same set as send.ts: any of these on the exact row already keeps it out of every queue.
const BLOCKING_STATUSES = new Set([
  "Sent", "Replied", "Contacted", "Suppressed", "Do Not Contact", "Follow-up", "Interested", "Meeting", "Offer Sent", "Won", "Lost"
]);

export type ResendEmailEntry = SendLedgerEntry & { id?: string };

export function recipientRef(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 10);
}

/** Masks every email address and the recipient's domain in provider text, and caps its length. */
export function scrub(text: string, recipient?: string): string {
  let out = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<address>");
  const domain = recipient?.split("@")[1]?.trim().toLowerCase();
  if (domain) out = out.split(domain).join("<recipient-domain>").split(domain.toUpperCase()).join("<recipient-domain>");
  return out.length > 600 ? out.slice(0, 600) + "…" : out;
}

const PERSONAL_KEYS = new Set(["to", "cc", "bcc", "reply_to", "from", "html", "text", "subject", "headers", "tags", "attachments"]);

/** The provider's email object without addresses or content: only status and diagnostic fields, scrubbed. */
export function providerDetail(detail: Record<string, unknown>, recipient: string): string {
  // The bounce classification first, so the length cap never cuts it off.
  const bounce = detail.bounce;
  if (bounce && typeof bounce === "object") {
    const b = bounce as Record<string, unknown>;
    const head = scrub(JSON.stringify({ type: b.type, subType: b.subType, diagnosticCode: b.diagnosticCode }), recipient);
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(detail)) if (!PERSONAL_KEYS.has(key) && key !== "bounce") kept[key] = value;
    return `bounce=${head} ${scrub(JSON.stringify(kept), recipient)}`;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) if (!PERSONAL_KEYS.has(key)) kept[key] = value;
  return scrub(JSON.stringify(kept), recipient);
}

export type RowState = { recordId: string; leadStatus: string; doNotContact: boolean; exactAddress: boolean };

export function rowStates(records: LiteQueueRecord[], recipient: string): RowState[] {
  const email = recipient.trim().toLowerCase();
  return records.map(record => ({
    recordId: record.id,
    leadStatus: String(record.fields["Lead Status"] ?? ""),
    doNotContact: record.fields["Do Not Contact"] === true,
    exactAddress: typeof record.fields.Email === "string" && record.fields.Email.trim().toLowerCase() === email
  }));
}

/** True when no Airtable path can email this exact address again: every exact row is DNC or in a blocking status, and one exists. */
export function exactAddressBlocked(states: RowState[]): boolean {
  const exact = states.filter(s => s.exactAddress);
  return exact.length > 0 && exact.every(s => s.doNotContact || BLOCKING_STATUSES.has(s.leadStatus));
}

/** Ticks Do Not Contact on one row and verifies it from Airtable's answer. Lead Status is left as history. */
export async function markDoNotContact(cfg: AirtableConfig, recordId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  assertAirtableWritesAllowed(env);
  if (!/^rec[A-Za-z0-9]+$/.test(recordId)) throw new Error("Airtable record ID is invalid.");
  const response = await (cfg.fetchImpl ?? fetch)(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${cfg.apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Do Not Contact": true } }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable could not set Do Not Contact (HTTP ${response.status}).`);
  const payload = await response.json().catch(() => null) as { id?: unknown; fields?: Record<string, unknown> } | null;
  if (payload?.id !== recordId || payload.fields?.["Do Not Contact"] !== true) throw new Error("Airtable's Do Not Contact state could not be verified.");
}

/**
 * Pauses (increasing) before repeating a Resend read that hit a network error, a timeout, 429 or 5xx.
 * A lasting failure still throws, so nothing is decided on missing history.
 */
export const RESEND_READ_PAUSES_MS: readonly number[] = Object.freeze([2_000, 5_000, 15_000]);

/** Resend's sent-email list back to `sinceMs` (bounded pages); fails closed on a malformed page. */
export async function fetchResendEmailsSince(apiKey: string, sinceMs: number, fetchImpl: typeof fetch = fetch, maxPages = 30, pausesMs: readonly number[] = RESEND_READ_PAUSES_MS): Promise<ResendEmailEntry[]> {
  const entries: ResendEmailEntry[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL("https://api.resend.com/emails");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetchReadWithRetry(fetchImpl, url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } }, 15000, pausesMs);
    if (!response.ok) throw new Error(`Resend email list failed (HTTP ${response.status}).`);
    const payload = await response.json().catch(() => null) as { data?: unknown; has_more?: unknown } | null;
    if (!payload || !Array.isArray(payload.data)) throw new Error("Resend returned an invalid email list.");
    const data = payload.data as ResendEmailEntry[];
    entries.push(...data);
    const oldest = Math.min(...data.map(e => Date.parse(e.created_at)).filter(Number.isFinite));
    if (data.length === 0 || payload.has_more !== true || (Number.isFinite(oldest) && oldest < sinceMs)) {
      return entries.filter(e => Date.parse(e.created_at) >= sinceMs);
    }
    after = data[data.length - 1]?.id;
    if (!after) throw new Error("Resend email list page has no cursor.");
  }
  // Fail closed: an incomplete history must never read as a low failure rate.
  throw new Error("Resend history exceeded the page limit; the failure rate cannot be established.");
}

/** The bounce classification of one email (type, subType, diagnosticCode); fails closed on an API error. */
export async function fetchBounceInfo(apiKey: string, id: string, fetchImpl: typeof fetch = fetch, pausesMs: readonly number[] = RESEND_READ_PAUSES_MS): Promise<{ type?: string; subType?: string; diagnosticCode?: string } | undefined> {
  const response = await fetchReadWithRetry(fetchImpl, `https://api.resend.com/emails/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  }, 15000, pausesMs);
  if (!response.ok) throw new Error(`Resend email detail failed (HTTP ${response.status}). Refusing to send.`);
  const payload = await response.json().catch(() => null) as { bounce?: Record<string, unknown> } | null;
  const b = payload?.bounce;
  if (!b || typeof b !== "object") return undefined;
  const code = Array.isArray(b.diagnosticCode) ? b.diagnosticCode.join(" ") : typeof b.diagnosticCode === "string" ? b.diagnosticCode : undefined;
  return { type: typeof b.type === "string" ? b.type : undefined, subType: typeof b.subType === "string" ? b.subType : undefined, diagnosticCode: code };
}

/** When the delivery-health stop (24 h after the newest failure) lifts, or undefined when no failure is in the window. */
export function stopLiftsAt(entries: SendLedgerEntry[], nowMs: number): number | undefined {
  const failed = new Set<string>(FAILED_EVENTS);
  let newest: number | undefined;
  for (const entry of entries) {
    const ts = Date.parse(entry.created_at);
    if (!Number.isFinite(ts) || nowMs - ts >= 24 * 60 * 60 * 1000 || nowMs < ts || !failed.has(entry.last_event ?? "")) continue;
    if (newest === undefined || ts > newest) newest = ts;
  }
  return newest === undefined ? undefined : newest + 24 * 60 * 60 * 1000;
}
