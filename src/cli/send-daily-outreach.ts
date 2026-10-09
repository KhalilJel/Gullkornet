/**
 * Legacy batch sending is intentionally disabled until Phase 11 acceptance.
 * Do not reintroduce batch execution here without durable global rate limits,
 * reply-aware follow-up blocking, and per-recipient human approval.
 */
import { assertBulkSendDisabledForPhase11 } from "../integrations/outbound-email.js";

try {
  assertBulkSendDisabledForPhase11();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Bulk outreach is disabled.");
  process.exitCode = 1;
}
