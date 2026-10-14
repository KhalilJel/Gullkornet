import { osloClock, SendDeferredError } from "../integrations/send-schedule.js";
import type { SendLedgerEntry } from "../integrations/outbound-email.js";

// Lite schedule: every day (Mon-Sun), 08:00 (inclusive) to 20:00 (exclusive) Europe/Oslo.
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
  startHour: 8,
  endHour: 20,
  dailyLimit: 100,
  hourlyLimit: 15,
  maxPerRun: 5,
  minSpacingSeconds: 60
});

// Sanity bounds only, to catch typos such as an extra zero.
const SANITY = Object.freeze({ maxDaily: 1000, maxHourly: 100, maxPerRun: 20, minSpacingSeconds: 20 });

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
