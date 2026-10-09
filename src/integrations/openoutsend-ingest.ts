export type OpenOutSendLead = {
  lead_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  title?: string;
  website?: string;
  linkedin_url?: string;
  reason?: string;
  profile_text?: string;
  qualified_at?: string;
  [key: string]: unknown;
};

export type OpenOutSendIngestResult = {
  accepted: number;
  mode: "ingest_only";
  send_triggered: false;
};

export type OpenOutSendIngestClientOptions = {
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Remote, ingest-only adapter for the authenticated OpenOutSend bridge.
 * This client can store leads but has no method capable of sending email.
 */
export function createOpenOutSendIngestClient(options: OpenOutSendIngestClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? process.env.OPENOUTREACH_INGEST_URL ?? "").trim().replace(/\/$/, "");
  const token = (options.token ?? process.env.OPENOUTREACH_INGEST_TOKEN ?? "").trim();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async ingestLeads(leads: OpenOutSendLead[]): Promise<OpenOutSendIngestResult> {
      if (!baseUrl) throw new Error("OPENOUTREACH_INGEST_URL_NOT_CONFIGURED");
      if (!token) throw new Error("OPENOUTREACH_INGEST_TOKEN_NOT_CONFIGURED");
      if (!Array.isArray(leads) || leads.length < 1 || leads.length > 100) {
        throw new Error("OPENOUTSEND_INGEST_INVALID_BATCH_SIZE");
      }

      const seen = new Set<string>();
      for (const lead of leads) {
        if (!lead || typeof lead !== "object" || typeof lead.lead_id !== "string" || !lead.lead_id.trim()) {
          throw new Error("OPENOUTSEND_INGEST_LEAD_ID_REQUIRED");
        }
        if (typeof lead.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email.trim())) {
          throw new Error("OPENOUTSEND_INGEST_VALID_EMAIL_REQUIRED");
        }
        if (seen.has(lead.lead_id)) throw new Error("OPENOUTSEND_INGEST_DUPLICATE_LEAD_ID");
        seen.add(lead.lead_id);
      }

      const body = leads.map((lead) => JSON.stringify(lead)).join("\n") + "\n";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(baseUrl + "/v1/leads", {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/x-ndjson",
            Accept: "application/json"
          },
          body
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error("OPENOUTSEND_INGEST_HTTP_" + response.status);
        if (
          typeof payload !== "object" || payload === null ||
          !("accepted" in payload) || (payload as { accepted: unknown }).accepted !== leads.length ||
          !("mode" in payload) || (payload as { mode: unknown }).mode !== "ingest_only" ||
          !("send_triggered" in payload) || (payload as { send_triggered: unknown }).send_triggered !== false
        ) {
          throw new Error("OPENOUTSEND_INGEST_UNEXPECTED_RESPONSE");
        }
        return payload as OpenOutSendIngestResult;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("OPENOUTSEND_INGEST_TIMEOUT");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
