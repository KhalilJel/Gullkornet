import type { LiteSendConfig } from "./schedule.js";
import { LITE_TEMPLATE_VERSION } from "./template.js";
import type { SendLedgerEntry } from "../integrations/outbound-email.js";

// Owner confirmed the Resend agreement and authorized this controlled pilot on 2026-10-16.
// This records the owner's attestation, not an independent review of a provider contract.
export const RESEND_PILOT_IDS: readonly string[] = Object.freeze([
  "rectfKyVUk0WU76CF", "rec0LKTwfaUQnwPIp", "rec3QobEnfGynkMoK",
  "rec3yqPv0SWYN161H", "recbedPgUBXrjE5HQ"
]);

// After five delivered pilot messages, owner requested automatic operation up to 95/day.
export function assertConfirmedResendSending(cfg: LiteSendConfig, env: NodeJS.ProcessEnv): void {
  if (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "pull_request_target") {
    throw new Error("Live sending is forbidden in pull-request environments.");
  }
  if (cfg.dailyLimit > 95 || cfg.maxPerRun > 2 || cfg.hourlyLimit > 15 || cfg.minSpacingMs < 60_000 ||
      cfg.startHour !== 8 || cfg.endHour !== 20 || LITE_TEMPLATE_VERSION !== "2026-10-15.6") {
    throw new Error("Confirmed Resend operation permits at most 95/day, 2/run, 15/hour, 60-second spacing, 08-20 Oslo and template 2026-10-15.6.");
  }
}

/** A known recent delivery failure stops new outreach; never interpret it as permission to retry. */
export function assertResendDeliveryHealthy(entries: SendLedgerEntry[], nowMs: number): void {
  const failed = new Set(["bounced", "complained", "failed", "suppressed"]);
  if (entries.some(entry => {
    const age = nowMs - Date.parse(entry.created_at);
    return age >= 0 && age < 24 * 60 * 60 * 1000 && failed.has(entry.last_event ?? "");
  })) throw new Error("Recent Resend delivery failure or complaint: automatic sending paused. Review provider events before continuing.");
}
