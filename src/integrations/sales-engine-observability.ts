import { type SalesEngineResult } from "./sales-engine.js";

export type SalesEngineFailureCategory =
  | "timeout"
  | "provider_unavailable"
  | "configuration"
  | "persistence"
  | "validation"
  | "unknown";

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** Deliberately returns a stable category, never the raw exception or provider response. */
export function classifySalesEngineFailure(error: unknown): SalesEngineFailureCategory {
  const code = errorCode(error).toUpperCase();
  if (/TIMEOUT|ETIMEDOUT|ECONNRESET/.test(code)) return "timeout";
  if (/HTTP_(408|425|429|5\d\d)|ECONNREFUSED|EAI_AGAIN|FETCH FAILED|UNAVAILABLE/.test(code)) {
    return "provider_unavailable";
  }
  if (/NOT_CONFIGURED|MISSING_CONFIG|TOKEN_NOT/.test(code)) return "configuration";
  if (/AIRTABLE|PERSIST|INGEST/.test(code)) return "persistence";
  if (/INVALID|VALIDATION|REQUIRED/.test(code)) return "validation";
  return "unknown";
}

export function salesEngineStartedEvent(input: {
  correlationId: string;
  dryRun: boolean;
  maxLeads: number;
}): Record<string, unknown> {
  return {
    event: "sales_engine.started",
    correlationId: input.correlationId,
    mode: input.dryRun ? "dry-run" : "queue-ingest",
    maxLeads: input.maxLeads,
    emailSent: 0
  };
}

export function salesEngineCompletedEvent(input: {
  correlationId: string;
  durationMs: number;
  result: SalesEngineResult;
  airtableReviewRecords: number;
}): Record<string, unknown> {
  return {
    event: "sales_engine.completed",
    correlationId: input.correlationId,
    durationMs: Math.max(0, Math.floor(input.durationMs)),
    discovered: input.result.discovered,
    deduplicated: input.result.deduplicated,
    researched: input.result.researched,
    qualified: input.result.qualified,
    rejected: input.result.rejected,
    reviewRequired: input.result.reviewRequired.length,
    airtableReviewRecords: input.airtableReviewRecords,
    skipped: input.result.skipped,
    emailSent: 0
  };
}

export function salesEngineFailedEvent(input: {
  correlationId: string;
  durationMs: number;
  error: unknown;
}): Record<string, unknown> {
  return {
    event: "sales_engine.failed",
    correlationId: input.correlationId,
    durationMs: Math.max(0, Math.floor(input.durationMs)),
    failureCategory: classifySalesEngineFailure(input.error),
    emailSent: 0
  };
}
