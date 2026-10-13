import type { BrowserResult, BrowserTask } from "./research-router.js";

// Client for the Cidea agent gateway (see docs/AGENT-GATEWAY.md). The gateway is the only
// public door to the private Hermes container. This client sends a URL and a hint about the
// engine; the gateway chooses the instructions itself. Whatever comes back is untrusted page
// text: it is validated and size-capped here and is never treated as instructions.

export type GatewayEngine = "jev-ultrafast" | "browser-use";

const MAX_EVIDENCE_ITEMS = 20;
const MAX_EVIDENCE_CHARS = 4000;

export function parseGatewayBaseUrl(raw: string | undefined): URL | undefined {
  if (!raw?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("AGENT_GATEWAY_URL_INVALID");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("AGENT_GATEWAY_URL_MUST_BE_HTTPS");
  if (url.username || url.password) throw new Error("AGENT_GATEWAY_URL_INVALID");
  return url;
}

export function validateGatewayResult(payload: unknown): BrowserResult {
  const body = (payload ?? {}) as Record<string, unknown>;
  const status = body.status;
  if (status !== "success" && status !== "blocked" && status !== "failed") throw new Error("GATEWAY_BAD_RESPONSE");
  const evidence = Array.isArray(body.evidence)
    ? body.evidence.filter((item): item is string => typeof item === "string").slice(0, MAX_EVIDENCE_ITEMS).map((item) => item.slice(0, MAX_EVIDENCE_CHARS))
    : [];
  let finalUrl: string | undefined;
  if (typeof body.finalUrl === "string") {
    try {
      const parsed = new URL(body.finalUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") finalUrl = parsed.toString();
    } catch {
      // Treated as missing.
    }
  }
  const failureReason = typeof body.failureReason === "string" ? body.failureReason.replace(/[^A-Za-z0-9_ ]/g, "").slice(0, 60) : undefined;
  if (status === "success") {
    if (!finalUrl || evidence.length === 0) throw new Error("GATEWAY_SUCCESS_WITHOUT_EVIDENCE");
    return { status, finalUrl, evidence };
  }
  return { status, evidence: [], failureReason: failureReason || "GATEWAY_UNSPECIFIED" };
}

export function createGatewayExecutor(options: {
  baseUrl: URL;
  token: string;
  engine: GatewayEngine;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): (task: BrowserTask) => Promise<BrowserResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 90_000;
  return async (task) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL("/v1/browse", options.baseUrl), {
        method: "POST",
        signal: controller.signal,
        headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
        body: JSON.stringify({ url: task.url, engine: options.engine })
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return validateGatewayResult(await response.json());
    } finally {
      clearTimeout(timer);
    }
  };
}
