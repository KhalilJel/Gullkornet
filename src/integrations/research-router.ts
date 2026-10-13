import type { ProviderAttempt, ResearchProvider } from "../domain/research-evidence.js";

// Cost-aware research escalation for ONE website. The built-in fetch always runs first and is
// free. Only when it did not produce readable content does the router try, in order:
//   1. Firecrawl  (structured scrape, paid per call, needs FIRECRAWL_API_KEY)
//   2. exactly one browser path: JEV Ultrafast for simple repeatable steps, Browser Use for
//      multi-step or interactive pages. Never both for the same company.
// Every step has a timeout, one retry for transient errors, a per-run budget and a safe
// fallback: a failure is recorded and nothing is invented or sent.

export type PageContent = {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
};

export type BuiltinOutcome = {
  ok: boolean;
  /** Visible text length of the homepage the built-in fetch could read. */
  textLength: number;
  /** Error code or reason when not ok, for example URL_BLOCKED_OR_NON_PUBLIC. */
  reason?: string;
  httpStatus?: number;
  /** Set when the page needs clicks or form steps rather than plain reading. */
  interactive?: boolean;
};

export type EscalationReason = "empty_content" | "fetch_failed" | "blocked_by_site" | "interactive_required";

export type BrowserTask = { url: string; goal: string };
export type BrowserResult = {
  status: "success" | "blocked" | "failed";
  finalUrl?: string;
  evidence: string[];
  failureReason?: string;
};

export type ResearchProviders = {
  firecrawl?: (url: string) => Promise<PageContent>;
  jev?: (task: BrowserTask) => Promise<BrowserResult>;
  browserUse?: (task: BrowserTask) => Promise<BrowserResult>;
};

export type RouterPolicy = {
  timeoutMs: number;
  minTextLength: number;
  maxFirecrawlPerRun: number;
  maxBrowserPerRun: number;
};

export const DEFAULT_ROUTER_POLICY: RouterPolicy = Object.freeze({
  timeoutMs: 25_000,
  minTextLength: 200,
  maxFirecrawlPerRun: 10,
  maxBrowserPerRun: 3
});

export function routerPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): RouterPolicy {
  const bounded = (value: string | undefined, fallback: number, max: number) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : fallback;
  };
  return {
    ...DEFAULT_ROUTER_POLICY,
    maxFirecrawlPerRun: bounded(env.FIRECRAWL_MAX_PER_RUN, DEFAULT_ROUTER_POLICY.maxFirecrawlPerRun, 100),
    maxBrowserPerRun: bounded(env.BROWSER_ESCALATION_MAX_PER_RUN, DEFAULT_ROUTER_POLICY.maxBrowserPerRun, 20)
  };
}

export type RouterState = { firecrawlUsed: number; browserUsed: number };

export type EscalationResult = {
  page?: PageContent;
  attempts: ProviderAttempt[];
};

export function classifyEscalation(
  builtin: BuiltinOutcome,
  minTextLength: number = DEFAULT_ROUTER_POLICY.minTextLength
): EscalationReason | "none" | "never" {
  // The safe-URL check protects against requests to private networks. No paid or browser
  // provider may be used to get around it.
  if (builtin.reason === "URL_BLOCKED_OR_NON_PUBLIC" || builtin.reason === "BLOCKED_URL" || builtin.reason === "NO_WEBSITE") return "never";
  if (builtin.interactive) return "interactive_required";
  if (builtin.ok && builtin.textLength >= minTextLength) return "none";
  if (builtin.httpStatus === 401 || builtin.httpStatus === 403 || builtin.httpStatus === 429) return "blocked_by_site";
  if (!builtin.ok) return "fetch_failed";
  return "empty_content";
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /timeout|abort|HTTP_(429|5\d\d)|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

async function withTimeout<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("PROVIDER_TIMEOUT")), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    timeout.catch(() => undefined);
  }
}

async function callWithRetry<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  try {
    return await withTimeout(run, timeoutMs);
  } catch (error) {
    if (!isTransient(error)) throw error;
    return await withTimeout(run, timeoutMs);
  }
}

function failureCode(error: unknown): string {
  // Provider error text can contain URLs or account details; keep a short code only.
  const message = error instanceof Error ? error.message : "UNKNOWN";
  const match = message.match(/^[A-Z0-9_]{3,60}$/);
  return match ? match[0] : message.replace(/[^A-Za-z0-9_ ]/g, "").slice(0, 60) || "UNKNOWN";
}

function pageHasContent(page: PageContent | undefined, minTextLength: number): page is PageContent {
  const text = (page?.markdown ?? "").trim();
  return Boolean(page && text.length >= minTextLength);
}

/**
 * Decide and run the cheapest further research step for one company. Never throws.
 * `state` is shared across the run so the per-run budgets are real limits.
 */
export async function escalateResearch(
  input: { url: string; builtin: BuiltinOutcome },
  providers: ResearchProviders,
  state: RouterState,
  policy: RouterPolicy = DEFAULT_ROUTER_POLICY,
  now: () => Date = () => new Date()
): Promise<EscalationResult> {
  const attempts: ProviderAttempt[] = [];
  const record = (provider: ResearchProvider, outcome: ProviderAttempt["outcome"], startedAt: number, reason?: string) => {
    attempts.push({ provider, outcome, durationMs: Date.now() - startedAt, at: now().toISOString(), ...(reason ? { reason } : {}) });
  };

  const reason = classifyEscalation(input.builtin, policy.minTextLength);
  if (reason === "none") return { attempts };
  if (reason === "never") {
    record("builtin-fetch", "skipped", Date.now(), "url_not_eligible_for_escalation");
    return { attempts };
  }

  // Step 1: Firecrawl, unless the page needs interaction that a scrape cannot do.
  if (reason !== "interactive_required") {
    const startedAt = Date.now();
    if (!providers.firecrawl) {
      record("firecrawl", "skipped", startedAt, "not_configured");
    } else if (state.firecrawlUsed >= policy.maxFirecrawlPerRun) {
      record("firecrawl", "skipped", startedAt, "run_budget_exhausted");
    } else {
      state.firecrawlUsed += 1;
      try {
        const page = await callWithRetry(() => providers.firecrawl!(input.url), policy.timeoutMs);
        if (pageHasContent(page, policy.minTextLength)) {
          record("firecrawl", "ok", startedAt);
          return { page, attempts };
        }
        record("firecrawl", "failed", startedAt, "insufficient_content");
      } catch (error) {
        record("firecrawl", "failed", startedAt, failureCode(error));
      }
    }
  }

  // Step 2: exactly one browser path. JEV for simple repeatable steps, Browser Use for
  // interactive or multi-step pages. Only one is ever chosen per company.
  const useBrowserUse = reason === "interactive_required";
  const provider: ResearchProvider = useBrowserUse ? "browser-use" : "jev-ultrafast";
  const executor = useBrowserUse ? providers.browserUse : providers.jev;
  const startedAt = Date.now();
  if (!executor) {
    // No executor can be called from this runtime. Record the need so a review can pick it
    // up; do not pretend the research happened.
    record(provider, "escalation_needed", startedAt, "no_executor_available_in_this_runtime");
    return { attempts };
  }
  if (state.browserUsed >= policy.maxBrowserPerRun) {
    record(provider, "skipped", startedAt, "run_budget_exhausted");
    return { attempts };
  }
  state.browserUsed += 1;
  const goal = useBrowserUse
    ? "Read-only: navigate the site and collect the visible business description and public contact details. Do not submit forms."
    : "Read-only: open the page, dismiss any cookie banner, and read the visible business description and public contact details. Do not submit forms.";
  try {
    const result = await callWithRetry(() => executor({ url: input.url, goal }), policy.timeoutMs);
    if (result.status === "success" && result.finalUrl && result.evidence.length > 0) {
      const markdown = result.evidence.join("\n").trim();
      if (markdown.length >= policy.minTextLength) {
        record(provider, "ok", startedAt);
        return { page: { url: result.finalUrl, markdown }, attempts };
      }
      record(provider, "failed", startedAt, "insufficient_content");
    } else {
      record(provider, "failed", startedAt, result.failureReason ? failureCode(new Error(result.failureReason)) : "unsuccessful_result");
    }
  } catch (error) {
    record(provider, "failed", startedAt, failureCode(error));
  }
  return { attempts };
}
