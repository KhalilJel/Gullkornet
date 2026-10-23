export type ReplyStatusResponse = {
  replied: boolean;
  mode: "read_only_reply_check";
  send_triggered: false;
};

/**
 * The service's own reason for refusing (e.g. REPLY_MONITOR_UNHEALTHY, or REPLY_LOOKUP_FAILED with the
 * exception type). Only fixed-format codes are kept, so a body can never put text into public logs.
 */
export async function replyStatusFailureReason(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown; failure_type?: unknown } | null;
  const code = typeof payload?.error === "string" && /^[A-Z_]{1,60}$/.test(payload.error) ? payload.error : "";
  const type = typeof payload?.failure_type === "string" && /^[A-Za-z_]{1,60}$/.test(payload.failure_type) ? payload.failure_type : "";
  return code ? ` (${code}${type ? `/${type}` : ""})` : "";
}

/** Read-only lookup: true when the business has replied. Throws (fails closed) on any doubt. */
export async function fetchRecipientReplied(
  recipient: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const endpoint = env.OPENOUTREACH_REPLY_STATUS_URL?.trim();
  // A dedicated read-only token: the ingest token is deliberately never read here.
  const token = env.OPENOUTREACH_REPLY_STATUS_TOKEN?.trim();
  if (!endpoint || !token) {
    throw new Error("Authenticated OpenOutSend reply-status URL and token are required. Refusing to send.");
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("OpenOutSend reply-status URL is invalid. Refusing to send.");
  }
  if (url.protocol !== "https:" || !url.pathname.endsWith("/v1/reply-status")) {
    throw new Error("OpenOutSend reply-status URL must use HTTPS and end in /v1/reply-status. Refusing to send.");
  }

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email: recipient.trim().toLowerCase() }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`OpenOutSend reply-status check failed with HTTP ${response.status}${await replyStatusFailureReason(response)}. Refusing to send.`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("replied" in payload) ||
    typeof (payload as { replied: unknown }).replied !== "boolean" ||
    !("mode" in payload) ||
    (payload as { mode: unknown }).mode !== "read_only_reply_check" ||
    !("send_triggered" in payload) ||
    (payload as { send_triggered: unknown }).send_triggered !== false
  ) {
    throw new Error("OpenOutSend returned an invalid reply-status response. Refusing to send.");
  }
  return (payload as ReplyStatusResponse).replied;
}

export async function assertRecipientHasNotReplied(
  recipient: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (await fetchRecipientReplied(recipient, env)) {
    throw new Error("Recipient has replied. Follow-up/outreach is blocked.");
  }
}

/** Max addresses per batch request (REPLY_STATUS_BATCH_MAX in openoutsend_ingest_api.py). */
export const REPLY_STATUS_BATCH_MAX = 500;

/**
 * Read-only batch lookup: one mailbox read on the reply service for many addresses.
 * Returns replied=true/false for every requested address; throws (fails closed) on any doubt,
 * including a response that leaves out an address.
 */
export async function fetchRepliedBatch(
  recipients: string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, boolean>> {
  const emails = [...new Set(recipients.map(r => r.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return new Map();
  if (emails.length > REPLY_STATUS_BATCH_MAX) throw new Error(`At most ${REPLY_STATUS_BATCH_MAX} addresses per reply-status batch.`);
  const endpoint = env.OPENOUTREACH_REPLY_STATUS_URL?.trim();
  const token = env.OPENOUTREACH_REPLY_STATUS_TOKEN?.trim();
  if (!endpoint || !token) throw new Error("Authenticated OpenOutSend reply-status URL and token are required.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/v1/reply-status")) {
    throw new Error("OpenOutSend reply-status URL must use HTTPS and end in /v1/reply-status.");
  }
  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ emails }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`OpenOutSend reply-status batch failed with HTTP ${response.status}${await replyStatusFailureReason(response)}.`);
  const payload = await response.json().catch(() => null) as { replied_by_email?: unknown; mode?: unknown; send_triggered?: unknown } | null;
  if (!payload || payload.mode !== "read_only_reply_check" || payload.send_triggered !== false ||
      typeof payload.replied_by_email !== "object" || payload.replied_by_email === null) {
    throw new Error("OpenOutSend returned an invalid reply-status batch.");
  }
  const answers = payload.replied_by_email as Record<string, unknown>;
  const result = new Map<string, boolean>();
  for (const email of emails) {
    if (typeof answers[email] !== "boolean") throw new Error("OpenOutSend reply-status batch left out an address.");
    result.set(email, answers[email] as boolean);
  }
  return result;
}
