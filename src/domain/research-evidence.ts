// One shared shape for everything the research pipeline learns about a company, whichever
// component produced it. A finding without a public source URL, a valid timestamp and a
// confidence is not evidence and is dropped rather than repaired or guessed.

export type FindingKind = "fact" | "inference" | "recommendation";

export type ResearchProvider =
  | "google-places"
  | "builtin-fetch"
  | "firecrawl"
  | "jev-ultrafast"
  | "browser-use"
  | "cidea-rules";

export type Finding = {
  kind: FindingKind;
  statement: string;
  sourceUrl: string;
  retrievedAt: string;
  confidence: number;
  provider: ResearchProvider;
  /** Machine-readable signal such as MISSING_META_DESCRIPTION, when the finding comes from one. */
  signal?: string;
};

export type AttemptOutcome = "ok" | "skipped" | "failed" | "escalation_needed";

export type ProviderAttempt = {
  provider: ResearchProvider;
  outcome: AttemptOutcome;
  reason?: string;
  durationMs: number;
  at: string;
};

const KINDS: ReadonlySet<string> = new Set(["fact", "inference", "recommendation"]);

/** Returns the finding when it is well formed, otherwise undefined. Never invents missing fields. */
export function validateFinding(value: unknown): Finding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.kind !== "string" || !KINDS.has(item.kind)) return undefined;
  if (typeof item.statement !== "string" || !item.statement.trim()) return undefined;
  if (typeof item.provider !== "string" || !item.provider) return undefined;
  if (typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) return undefined;
  if (typeof item.retrievedAt !== "string" || !Number.isFinite(Date.parse(item.retrievedAt))) return undefined;
  if (typeof item.sourceUrl !== "string") return undefined;
  try {
    const url = new URL(item.sourceUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  } catch {
    return undefined;
  }
  return {
    kind: item.kind as FindingKind,
    statement: item.statement.trim(),
    sourceUrl: item.sourceUrl,
    retrievedAt: item.retrievedAt,
    confidence: item.confidence,
    provider: item.provider as ResearchProvider,
    ...(typeof item.signal === "string" && item.signal ? { signal: item.signal } : {})
  };
}

export function validFindings(values: unknown[]): Finding[] {
  return values.map(validateFinding).filter((item): item is Finding => item !== undefined);
}
