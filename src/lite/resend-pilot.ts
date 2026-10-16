import type { LiteSendConfig } from "./schedule.js";
import { LITE_TEMPLATE_VERSION } from "./template.js";

// Owner confirmed the Resend agreement and authorized this controlled pilot on 2026-10-16.
// This records the owner's attestation, not an independent review of a provider contract.
export const RESEND_PILOT_IDS: readonly string[] = Object.freeze([
  "rectfKyVUk0WU76CF", "rec0LKTwfaUQnwPIp", "rec3QobEnfGynkMoK",
  "rec3yqPv0SWYN161H", "recbedPgUBXrjE5HQ"
]);

export function assertConfirmedResendPilot(cfg: LiteSendConfig, env: NodeJS.ProcessEnv): void {
  if (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "pull_request_target") {
    throw new Error("Live pilot is forbidden in pull-request environments.");
  }
  if (cfg.dailyLimit > 5 || cfg.maxPerRun !== 1 || LITE_TEMPLATE_VERSION !== "2026-10-15.6") {
    throw new Error("Confirmed Resend pilot permits at most 5/day, exactly 1/run and template 2026-10-15.6.");
  }
}
