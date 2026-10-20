import { osloClock, SendDeferredError } from "../integrations/send-schedule.js";
import type { SendLedgerEntry } from "../integrations/outbound-email.js";

// Lite schedule: every day (Mon-Sun), one coordinated run in the 11:00 (inclusive) to 12:00
// (exclusive) Europe/Oslo slot that spreads the day's sends evenly across the hour.
// The daily number is a configurable target, not a code ceiling, but it can never exceed the
// configured Resend daily quota, and a monthly quota (when given) must cover 31 days of it.

export type LiteSendConfig = {
  startHour: number;
  endHour: number;
  dailyLimit: number;
  hourlyLimit: number;
  maxPerRun: number;
  minSpacingMs: number;
  resendDailyQuota: number;
  resendMonthlyQuota?: number;
};

export const LITE_DEFAULTS = Object.freeze({
  startHour: 11,
  endHour: 12,
  dailyLimit: 95,
  hourlyLimit: 95,
  maxPerRun: 95,
  minSpacingSeconds: 30
});

// Sanity bounds only, to catch typos such as an extra zero.
const SANITY = Object.freeze({ maxDaily: 1000, maxHourly: 100, maxPerRun: 100, minSpacingSeconds: 20 });

/** A manual run may start this long before the slot and wait for it. */
export const SLOT_LEAD_MS = 30 * 60 * 1000;
/**
 * GitHub delivers this repository's scheduled events hours late and drops most of them, so a
 * scheduled run may arrive up to this long before the slot and wait (job limit 6 h: wait + 60 min slot).
 */
export const MAX_SCHEDULED_LEAD_MS = 285 * 60 * 1000;
/** The owner-authorised one-off run sends within this long of its start. */
export const ONE_OFF_DURATION_MS = 60 * 60 * 1000;

function intFrom(env: NodeJS.ProcessEnv, name: string, fallback?: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    if (fallback === undefined) throw new Error(`${name} is required for Gullkornet Lite sending.`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

export function loadLiteSendConfig(env: NodeJS.ProcessEnv = process.env): LiteSendConfig {
  const startHour = intFrom(env, "GULLKORNET_LITE_START_HOUR", LITE_DEFAULTS.startHour);
  const endHour = intFrom(env, "GULLKORNET_LITE_END_HOUR", LITE_DEFAULTS.endHour);
  const dailyLimit = intFrom(env, "GULLKORNET_LITE_DAILY_LIMIT", LITE_DEFAULTS.dailyLimit);
  const hourlyLimit = intFrom(env, "GULLKORNET_LITE_HOURLY_LIMIT", LITE_DEFAULTS.hourlyLimit);
  const maxPerRun = intFrom(env, "GULLKORNET_LITE_MAX_PER_RUN", LITE_DEFAULTS.maxPerRun);
  const spacingSeconds = intFrom(env, "GULLKORNET_LITE_MIN_SPACING_SECONDS", LITE_DEFAULTS.minSpacingSeconds);
  // No default: the operator must state the real Resend plan before anything is sent.
  const resendDailyQuota = intFrom(env, "RESEND_DAILY_QUOTA");
  const monthlyRaw = env.RESEND_MONTHLY_QUOTA?.trim();
  const resendMonthlyQuota = monthlyRaw ? intFrom(env, "RESEND_MONTHLY_QUOTA") : undefined;

  if (startHour > 23 || endHour > 24 || startHour >= endHour) throw new Error("Lite send window hours are invalid.");
  if (dailyLimit < 1 || dailyLimit > SANITY.maxDaily) throw new Error(`GULLKORNET_LITE_DAILY_LIMIT must be 1-${SANITY.maxDaily}.`);
  if (hourlyLimit < 1 || hourlyLimit > SANITY.maxHourly) throw new Error(`GULLKORNET_LITE_HOURLY_LIMIT must be 1-${SANITY.maxHourly}.`);
  if (maxPerRun < 1 || maxPerRun > SANITY.maxPerRun) throw new Error(`GULLKORNET_LITE_MAX_PER_RUN must be 1-${SANITY.maxPerRun}.`);
  if (spacingSeconds < SANITY.minSpacingSeconds) throw new Error(`GULLKORNET_LITE_MIN_SPACING_SECONDS must be at least ${SANITY.minSpacingSeconds}.`);
  if (resendDailyQuota < 1) throw new Error("RESEND_DAILY_QUOTA must be at least 1.");
  if (dailyLimit > resendDailyQuota) {
    throw new Error("GULLKORNET_LITE_DAILY_LIMIT exceeds RESEND_DAILY_QUOTA. Raise the Resend plan or lower the limit.");
  }
  if (resendMonthlyQuota !== undefined && dailyLimit * 31 > resendMonthlyQuota) {
    throw new Error("GULLKORNET_LITE_DAILY_LIMIT x 31 exceeds RESEND_MONTHLY_QUOTA. Raise the Resend plan or lower the limit.");
  }
  const windowHours = endHour - startHour;
  if (hourlyLimit * windowHours < dailyLimit) {
    throw new Error("Hourly limit x send window hours is below the daily limit; the daily target is unreachable.");
  }
  return { startHour, endHour, dailyLimit, hourlyLimit, maxPerRun, minSpacingMs: spacingSeconds * 1000, resendDailyQuota, resendMonthlyQuota };
}

/** Every weekday including Saturday and Sunday. */
export function isWithinLiteWindow(ms: number, cfg: Pick<LiteSendConfig, "startHour" | "endHour">): boolean {
  const clock = osloClock(ms);
  return clock.weekday >= 1 && clock.weekday <= 7 && clock.hour >= cfg.startHour && clock.hour < cfg.endHour;
}

/** The instants a run may send in. Sends are spread evenly between startMs and endMs. */
export type LiteSlot = { kind: "daily" | "one_off"; startMs: number; endMs: number };

/**
 * Today's startHour:00-endHour:00 Oslo as instants. Oslo's offset is a whole number of hours and
 * changes only at 02:00/03:00, so wall-clock minute arithmetic is exact for a slot from 04:00 on,
 * in summer (CEST) and winter (CET) time alike.
 */
export function dailyLiteSlot(nowMs: number, cfg: Pick<LiteSendConfig, "startHour" | "endHour">): LiteSlot {
  if (cfg.startHour < 4) throw new Error("A daily Lite slot must start at 04:00 Oslo or later.");
  const clock = osloClock(nowMs);
  const intoMinuteMs = nowMs - Math.floor(nowMs / 60_000) * 60_000;
  const startMs = nowMs - intoMinuteMs - ((clock.hour - cfg.startHour) * 60 + clock.minute) * 60_000;
  return { kind: "daily", startMs, endMs: startMs + (cfg.endHour - cfg.startHour) * 60 * 60 * 1000 };
}

/**
 * The slot this run may send in, or undefined when it is not its time (a no-op, not a failure).
 * oneOffDate (YYYY-MM-DD, Oslo) is the owner's one-off authorisation: it must be today and gives
 * [now, now + 60 min). A stale or malformed date refuses, so a re-run on another day cannot reuse it.
 */
export function resolveLiteSlot(nowMs: number, cfg: Pick<LiteSendConfig, "startHour" | "endHour">, oneOffDate?: string, leadMs = SLOT_LEAD_MS): LiteSlot | undefined {
  const date = oneOffDate?.trim();
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("One-off date must be YYYY-MM-DD.");
    if (date !== osloClock(nowMs).date) throw new Error(`One-off date ${date} is not today in Europe/Oslo. Refusing to send.`);
    return { kind: "one_off", startMs: nowMs, endMs: nowMs + ONE_OFF_DURATION_MS };
  }
  const slot = dailyLiteSlot(nowMs, cfg);
  if (nowMs < slot.startMs - leadMs || nowMs >= slot.endMs) return undefined;
  return slot;
}

export type LedgerCounts = { lastHour: number; lastDay: number; newestMs?: number };

/** Account-wide counts from the Resend ledger (advanced and Lite sends share one quota). Fails closed on bad timestamps. */
export function countLedger(entries: SendLedgerEntry[], nowMs: number): LedgerCounts {
  let lastHour = 0;
  let lastDay = 0;
  let newestMs: number | undefined;
  for (const entry of entries) {
    const ts = Date.parse(entry.created_at);
    if (!Number.isFinite(ts)) throw new Error("Send ledger contains an invalid timestamp. Refusing to send.");
    const age = nowMs - ts;
    if (age < 0) throw new Error("Send ledger contains a future-dated entry. Refusing to send.");
    if (age < 60 * 60 * 1000) lastHour++;
    if (age < 24 * 60 * 60 * 1000) lastDay++;
    if (newestMs === undefined || ts > newestMs) newestMs = ts;
  }
  return { lastHour, lastDay, newestMs };
}

/** Throws SendDeferredError (a normal "not now") when any limit or the spacing would be broken by one more send. */
export function assertLiteCapacity(counts: LedgerCounts, cfg: LiteSendConfig, nowMs: number): void {
  if (counts.lastDay >= cfg.resendDailyQuota) throw new SendDeferredError("Resend daily quota reached.");
  if (counts.lastDay >= cfg.dailyLimit) throw new SendDeferredError(`Daily limit reached (${cfg.dailyLimit}/24h).`);
  if (counts.lastHour >= cfg.hourlyLimit) throw new SendDeferredError(`Hourly limit reached (${cfg.hourlyLimit}/h).`);
  if (counts.newestMs !== undefined && nowMs - counts.newestMs < cfg.minSpacingMs) {
    throw new SendDeferredError("Minimum spacing since the previous email has not passed.");
  }
}

/** Upper bound on sends per day the configuration allows (used by tests and the run summary). */
export function theoreticalDailyCapacity(cfg: LiteSendConfig): number {
  const windowMs = (cfg.endHour - cfg.startHour) * 60 * 60 * 1000;
  const bySpacing = Math.floor(windowMs / cfg.minSpacingMs);
  return Math.min(cfg.dailyLimit, cfg.resendDailyQuota, cfg.hourlyLimit * (cfg.endHour - cfg.startHour), bySpacing);
}

/** Ledger entries that will still be inside the rolling 24 h window at atMs (they limit a slot ending then). */
export function countedAt(entries: SendLedgerEntry[], atMs: number): number {
  return entries.filter(e => Date.parse(e.created_at) > atMs - 24 * 60 * 60 * 1000 && Date.parse(e.created_at) <= atMs).length;
}

/**
 * When the next send becomes allowed by the daily, quota and hourly limits as older entries roll out
 * of their windows (undefined when nothing in the ledger is blocking). Spacing is not considered.
 */
export function capacityFreesAt(entries: SendLedgerEntry[], cfg: LiteSendConfig, nowMs: number): number | undefined {
  const times = entries.map(e => Date.parse(e.created_at)).filter(ts => ts <= nowMs).sort((a, b) => a - b);
  const frees = (windowMs: number, limit: number): number | undefined => {
    const inWindow = times.filter(ts => nowMs - ts < windowMs);
    if (inWindow.length < limit) return undefined;
    return inWindow[inWindow.length - limit]! + windowMs;
  };
  const day = frees(24 * 60 * 60 * 1000, Math.min(cfg.dailyLimit, cfg.resendDailyQuota));
  const hour = frees(60 * 60 * 1000, cfg.hourlyLimit);
  if (day === undefined && hour === undefined) return undefined;
  return Math.max(day ?? 0, hour ?? 0);
}
