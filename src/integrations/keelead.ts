export type KeeLeadLead = {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  website?: string;
  linkedin?: string;
  location?: string;
  source?: string;
  confidence?: number;
  verified?: boolean;
  metadata?: Record<string, unknown>;
};

export type KeeLeadSearchInput = {
  query: string;
  count?: number;
  location?: string;
  industry?: string;
  sources?: string[];
};

export type KeeLeadClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type KeeLeadClient = {
  searchLeads(input: KeeLeadSearchInput): Promise<unknown>;
  enrichLead(input: Record<string, unknown>): Promise<unknown>;
  verifyEmail(input: { email?: string; emails?: string[] }): Promise<unknown>;
  researchCompany(query: string): Promise<unknown>;
  scoreLead(input: Record<string, unknown>): Promise<unknown>;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function normalizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("KEELEAD_INVALID_BASE_URL");
  }
  return url.toString().replace(/\/$/, "");
}

export function createKeeLeadClient(options: KeeLeadClientOptions = {}): KeeLeadClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.KEELEAD_API_URL ?? "http://localhost:3000");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(baseUrl + path, {
        method,
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`KEELEAD_HTTP_${response.status}`);
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("KEELEAD_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    searchLeads: (input) => request("/api/leads", "POST", input),
    enrichLead: (input) => request("/api/enrich", "POST", input),
    verifyEmail: (input) => request("/api/verify", "POST", input),
    researchCompany: (query) => request("/api/research", "POST", { query }),
    scoreLead: (input) => request("/api/score", "POST", input)
  };
}
