export type ReplyStatusResponse = {
  replied: boolean;
  mode: "read_only_reply_check";
  send_triggered: false;
};

export async function assertRecipientHasNotReplied(
  recipient: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const endpoint = env.OPENOUTREACH_REPLY_STATUS_URL?.trim();
  const token = env.OPENOUTREACH_INGEST_TOKEN?.trim();
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
    throw new Error(`OpenOutSend reply-status check failed with HTTP ${response.status}. Refusing to send.`);
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
  if ((payload as ReplyStatusResponse).replied) {
    throw new Error("Recipient has replied. Follow-up/outreach is blocked.");
  }
}
