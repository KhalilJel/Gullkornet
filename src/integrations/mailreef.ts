import type { PreparedEmail } from "./outbound-email.js";

const API = "https://api.mailreef.com";

function authorization(apiKey: string): string {
  if (!apiKey.trim() || /[\r\n:]/.test(apiKey)) throw new Error("A valid MAILREEF_API_KEY is required.");
  return `Basic ${Buffer.from(`${apiKey.trim()}:`).toString("base64")}`;
}

function mailbox(value: string): string {
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value)) {
    throw new Error("Mailreef requires a single bare mailbox address.");
  }
  return value.toLowerCase();
}

/** Only GET requests; never returns the user object, API key, billing cards or mailbox password. */
export async function checkMailreefAccount(
  apiKey: string, sender: string, fetchImpl: typeof fetch = fetch
): Promise<{ apiAccess: true; billingActive: boolean; senderLive: boolean }> {
  const headers = { Authorization: authorization(apiKey) };
  const address = mailbox(sender);
  const userResponse = await fetchImpl(`${API}/users`, {
    headers, redirect: "error", signal: AbortSignal.timeout(15000)
  });
  if (userResponse.status !== 200) throw new Error(`Mailreef account check failed (HTTP ${userResponse.status}).`);
  const user = await userResponse.json().catch(() => null);
  if (!user || !Array.isArray(user.permissions) || !user.permissions.includes("api") ||
      typeof user.billing?.active !== "boolean") throw new Error("Mailreef account response is incomplete.");
  const senderResponse = await fetchImpl(`${API}/mailboxes/${encodeURIComponent(address)}`, {
    headers, redirect: "error", signal: AbortSignal.timeout(15000)
  });
  if (senderResponse.status !== 200) throw new Error(`Mailreef sender check failed (HTTP ${senderResponse.status}).`);
  const box = await senderResponse.json().catch(() => null);
  if (!box || typeof box.id !== "string" || box.id.toLowerCase() !== address || typeof box.live !== "boolean") {
    throw new Error("Mailreef returned an invalid sender response.");
  }
  return { apiAccess: true, billingActive: user.billing.active, senderLive: box.live };
}

/** Supply a persistent, atomic store shared across runs before integrating with any live runner.
 * An attempt is never released automatically: a timeout or error may follow provider acceptance.
 */
export type MailreefAttemptStore = {
  claim: (key: string) => Promise<boolean>;
  accepted: (key: string, providerId: string) => Promise<void>;
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Transport only. Not wired to a CLI, schedule or production secret in this preparation step.
 * Upstream must enforce owner approval, recipient/reply/suppression/rate gates and durable claims.
 * Mailreef documents no idempotency header; this function makes exactly one POST and never retries.
 */
export async function sendMailreefEmail(
  email: PreparedEmail, apiKey: string, key: string,
  attempts: MailreefAttemptStore, fetchImpl: typeof fetch = fetch
): Promise<{ id: string }> {
  const auth = authorization(apiKey);
  const from = mailbox(email.from);
  const to = mailbox(email.to);
  if (!key.trim() || !email.subject.trim() || /[\r\n]/.test(email.subject) || !email.text.trim()) {
    throw new Error("Mailreef message or attempt key is invalid.");
  }
  if (!await attempts.claim(key)) throw new Error("Mailreef attempt already exists. Reconcile before any retry.");
  let response: Response;
  try {
    response = await fetchImpl(`${API}/email`, {
      method: "POST", redirect: "error",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: email.subject,
        text_body: email.text, html_body: escapeHtml(email.text).replace(/\n/g, "<br>\n") }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error("Mailreef send outcome unknown. Attempt remains blocked; do not retry automatically.");
  }
  // Do not echo provider errors: they may contain recipient data or credentials.
  if (response.status !== 201) throw new Error(`Mailreef send not confirmed (HTTP ${response.status}). Reconcile attempt; do not retry automatically.`);
  const payload = await response.json().catch(() => null);
  if (!payload || payload.sent !== true || typeof payload.id !== "string" || !payload.id.trim()) {
    throw new Error("Mailreef send outcome unknown: invalid acceptance response. Reconcile attempt.");
  }
  try {
    await attempts.accepted(key, payload.id);
  } catch {
    throw new Error("Mailreef accepted the message but local confirmation failed. Reconcile attempt; do not resend.");
  }
  return { id: payload.id };
}
