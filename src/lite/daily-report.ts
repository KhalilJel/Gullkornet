import type { ResendEmailEntry } from "./delivery-check.js";
import { osloClock } from "../integrations/send-schedule.js";
import { dailyLiteSlot, type LiteSendConfig } from "./schedule.js";
import { LITE_TEMPLATE } from "./template.js";

// What a day's Lite slot actually did, from the provider's own list: accepted Lite messages in the
// slot, their latest delivery event, and the shortfall against the day's goal (95 per calendar day in
// Europe/Oslo, minus what the account sent earlier that day).
// Counts only; no addresses.

export type DailyReport = {
  date: string;
  slotStartMs: number;
  slotEndMs: number;
  /** Account messages earlier the same Oslo day, before the slot (they count against the day's goal). */
  carriedIn: number;
  /** What the day's goal and the provider's daily quota left for the slot. */
  capacity: number;
  accepted: number;
  byEvent: Record<string, number>;
  /** Lite messages on the same Oslo date outside the slot (one-off runs). */
  outsideSlot: number;
  missing: number;
  status: "pending" | "ok" | "shortfall" | "missed" | "no_capacity";
};

export function isLiteEmail(entry: ResendEmailEntry): boolean {
  return entry.subject === LITE_TEMPLATE.subject;
}

/** date is the Oslo date (YYYY-MM-DD) of the slot. */
export function buildDailyReport(history: ResendEmailEntry[], date: string, nowMs: number, cfg: LiteSendConfig): DailyReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("date must be YYYY-MM-DD.");
  // 10:30 UTC is on the same Oslo date in summer and winter time.
  const slot = dailyLiteSlot(Date.parse(`${date}T10:30:00Z`), cfg);
  const ts = (e: ResendEmailEntry) => Date.parse(e.created_at);
  const inSlot = history.filter(e => ts(e) >= slot.startMs && ts(e) < slot.endMs);
  const carriedIn = history.filter(e => ts(e) < slot.startMs && osloClock(ts(e)).date === date && e.last_event !== "canceled").length;
  const capacity = Math.max(0, Math.min(cfg.maxPerRun, cfg.dailyLimit, cfg.resendDailyQuota) - carriedIn);
  const lite = inSlot.filter(isLiteEmail);
  const byEvent: Record<string, number> = {};
  for (const e of lite) byEvent[e.last_event ?? "unknown"] = (byEvent[e.last_event ?? "unknown"] ?? 0) + 1;
  const outsideSlot = history.filter(e => isLiteEmail(e) && (ts(e) < slot.startMs || ts(e) >= slot.endMs) && osloClock(ts(e)).date === date).length;
  const accepted = lite.length;
  const missing = Math.max(0, capacity - accepted);
  let status: DailyReport["status"];
  if (nowMs < slot.endMs) status = "pending";
  else if (capacity === 0) status = "no_capacity";
  else if (missing === 0) status = "ok";
  else status = accepted === 0 ? "missed" : "shortfall";
  return { date, slotStartMs: slot.startMs, slotEndMs: slot.endMs, carriedIn, capacity, accepted, byEvent, outsideSlot, missing, status };
}
