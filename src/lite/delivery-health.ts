import type { SendLedgerEntry } from "../integrations/outbound-email.js";

// Delivery-health policy. Owner decisions: 19.10.2026 (targeted policy), 21.10.2026 (no stop on a
// single bounce, no fixed daily count of recipient failures, no 30-day failure-rate stop).
//   complained, failed (last 24 h)             -> global stop (spam complaint / provider fault)
//   any bounce, suppressed                     -> recipient-scoped: that address is reserved (Do Not
//                                                 Contact, verified; it also blocks its business) and
//                                                 other sending continues.

const DAY_MS = 24 * 60 * 60 * 1000;

export type HealthEntry = SendLedgerEntry & { id?: string };
export type BounceInfo = { type?: string; subType?: string; diagnosticCode?: string };
export type HealthVerdict =
  | { ok: true; recipientScoped: Array<{ id: string; recipient: string; event: string }> }
  | { ok: false; reason: string };

// RFC 3463 enhanced codes for a mailbox or address that does not exist. Microsoft 365 answers
// "550 5.4.1 Recipient address rejected: Access denied" for an address its directory does not know.
const INVALID_MAILBOX_CODES = /\b5\.1\.(1|2|3|6|10)\b|\b5\.4\.1\b.*recipient address rejected/i;

/** A bounce is permanent-invalid when Resend says Permanent, or its SMTP diagnostic names a non-existent mailbox. */
export function isPermanentInvalidAddress(info: BounceInfo | undefined): boolean {
  if (!info) return false;
  if (info.type === "Permanent") return true;
  const code = Array.isArray(info.diagnosticCode) ? info.diagnosticCode.join(" ") : String(info.diagnosticCode ?? "");
  return INVALID_MAILBOX_CODES.test(code);
}

const FAILURES = new Set(["bounced", "complained", "failed", "suppressed"]);

export function assessDeliveryHealth(history: HealthEntry[], bounces: Map<string, BounceInfo>, nowMs: number): HealthVerdict {
  const recent = history.filter(e => {
    const age = nowMs - Date.parse(e.created_at);
    return age >= 0 && age < DAY_MS && FAILURES.has(e.last_event ?? "");
  });
  if (recent.some(e => e.last_event === "complained")) return { ok: false, reason: "Spam complaint in the last 24 h." };
  if (recent.some(e => e.last_event === "failed")) return { ok: false, reason: "Provider send failure in the last 24 h." };
  const scoped: Array<{ id: string; recipient: string; event: string }> = [];
  for (const e of recent) {
    const recipient = (e.to ?? [])[0]?.trim().toLowerCase();
    if (!e.id || !recipient) return { ok: false, reason: "A recent failure has no ID or recipient; cannot reserve it." };
    let event = e.last_event ?? "";
    if (event === "bounced") {
      const info = bounces.get(e.id);
      // Labelled for the log only; the classification is never changed (Undetermined stays Undetermined).
      event = isPermanentInvalidAddress(info) ? "bounced (permanent)" : `bounced (${info?.type ?? "no detail"})`;
    }
    scoped.push({ id: e.id, recipient, event });
  }
  return { ok: true, recipientScoped: scoped };
}

/** A delivery-health stop; liftsAtMs is when it ends if no new event arrives (undefined: not within 31 days). */
export class DeliveryStopError extends Error {
  constructor(message: string, readonly liftsAtMs?: number) { super(message); }
}

/** First moment at which the policy no longer stops sending, assuming no new provider events. */
export function deliveryStopLiftsAt(history: HealthEntry[], bounces: Map<string, BounceInfo>, nowMs: number): number | undefined {
  const candidates = new Set<number>();
  for (const e of history) {
    const ts = Date.parse(e.created_at);
    if (!Number.isFinite(ts) || !FAILURES.has(e.last_event ?? "")) continue;
    candidates.add(ts + DAY_MS + 1);
    candidates.add(ts + 30 * DAY_MS + 1);
  }
  for (const at of [...candidates].filter(t => t > nowMs).sort((a, b) => a - b)) {
    if (at > nowMs + 31 * DAY_MS) break;
    if (assessDeliveryHealth(history, bounces, at).ok) return at;
  }
  return undefined;
}
