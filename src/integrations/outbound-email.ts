export type OutreachDraft = {
  companyName: string;
  emails: Array<{ email: string; sourceUrl?: string; sourceType?: string }>;
  subject?: string;
  draftBody?: string;
};

export type PreparedEmail = { from: string; to: string; subject: string; text: string };

export const DEFAULT_SENDER = "jelassi@cideamarketing.com";

// Phase 11 shared policy for all future live-send entry points.
export const PHASE11_RATE_LIMITS = Object.freeze({
  maxPerRun: 3,
  maxPerHour: 3,
  maxPerDay: 10
});

export type SendLedgerEntry = {
  created_at: string;
  to?: string[];
  from?: string;
  subject?: string;
  last_event?: string;
};

export type SendLedger = {
  data: SendLedgerEntry[];
  has_more: boolean;
};

export function assertProductionKillSwitchEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.GULLKORNET_ENABLE_LIVE_SEND !== "true") {
    throw new Error("Production kill switch is active: live sending is disabled.");
  }
}

export function assertRecipientNotAlreadySent(
  entries: SendLedgerEntry[],
  recipient: string,
  nowMs = Date.now()
): void {
  const normalized = recipient.trim().toLowerCase();
  for (const entry of entries) {
    const timestamp = Date.parse(entry.created_at);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Send ledger contains an invalid timestamp. Refusing to send.");
    }
    const age = nowMs - timestamp;
    if (age < 0 || age >= 24 * 60 * 60 * 1000) continue;
    const recipients = Array.isArray(entry.to) ? entry.to : [];
    if (recipients.some((value) => typeof value === "string" && value.trim().toLowerCase() === normalized)) {
      throw new Error("Recipient already appears in Resend send history within the last 24 hours. Refusing duplicate outreach.");
    }
  }
}

export function countRecentSends(
  entries: SendLedgerEntry[],
  nowMs = Date.now()
): { lastHour: number; lastDay: number } {
  let lastHour = 0;
  let lastDay = 0;
  for (const entry of entries) {
    const timestamp = Date.parse(entry.created_at);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Send ledger contains an invalid timestamp. Refusing to send.");
    }
    const age = nowMs - timestamp;
    if (age < 0) continue;
    if (age < 60 * 60 * 1000) lastHour++;
    if (age < 24 * 60 * 60 * 1000) lastDay++;
  }
  return { lastHour, lastDay };
}

export function assertRateLimits(
  recent: { lastHour: number; lastDay: number },
  env: NodeJS.ProcessEnv = process.env
): void {
  const maxRun = PHASE11_RATE_LIMITS.maxPerRun;
  const maxHour = PHASE11_RATE_LIMITS.maxPerHour;
  const maxDay = PHASE11_RATE_LIMITS.maxPerDay;
  if (recent.lastHour >= maxHour) {
    throw new Error(`Hourly production rate limit reached (${maxHour}/hour).`);
  }
  if (recent.lastDay >= maxDay) {
    throw new Error(`Daily production rate limit reached (${maxDay}/day).`);
  }
  // Validate configuration eagerly. A single-recipient entry point is 1/run;
  // bulk sender remains hard-disabled until a separate accepted batch runner exists.
  const configuredRun = Number(env.MAX_EMAILS_PER_RUN ?? "1");
  if (!Number.isInteger(configuredRun) || configuredRun < 1 || configuredRun > maxRun) {
    throw new Error(`MAX_EMAILS_PER_RUN must be between 1 and ${maxRun} during Phase 11.`);
  }
}

export async function fetchRecentSendLedger(apiKey: string, nowMs = Date.now()): Promise<SendLedgerEntry[]> {
  if (!apiKey.trim()) throw new Error("RESEND_API_KEY is required to verify the production send ledger.");
  const entries: SendLedgerEntry[] = [];
  let after: string | undefined;
  // Bound the number of pages. If recent history cannot be reached safely, fail closed.
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://api.resend.com/emails");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Could not verify Resend send history (HTTP ${response.status}). Refusing to send.`);
    const payload: unknown = await response.json().catch(() => null);
    if (typeof payload !== "object" || payload === null || !("data" in payload) || !Array.isArray((payload as { data: unknown }).data)) {
      throw new Error("Resend returned an invalid send ledger. Refusing to send.");
    }
    const data = (payload as { data: SendLedgerEntry[] }).data;
    if (!("has_more" in payload) || typeof (payload as { has_more: unknown }).has_more !== "boolean") {
      throw new Error("Resend send ledger omitted pagination state. Refusing to send.");
    }
    const hasMore = (payload as { has_more: boolean }).has_more;
    entries.push(...data);
    if (data.length === 0) {
      if (hasMore) throw new Error("Resend returned an empty page with more history available. Refusing to send.");
      return entries;
    }
    const oldest = Math.min(...data.map(item => Date.parse(item.created_at)).filter(Number.isFinite));
    if (Number.isFinite(oldest) && nowMs - oldest >= 24 * 60 * 60 * 1000) return entries;
    if (!hasMore) return entries;
    const last = data[data.length - 1];
    const cursor = (last as { id?: unknown }).id;
    if (typeof cursor !== "string" || !cursor) {
      throw new Error("Resend history page has no pagination cursor. Refusing to send.");
    }
    after = cursor;
  }
  throw new Error("Could not establish a complete 24-hour send history within the page limit. Refusing to send.");
}


export function prepareEmail(
  records: OutreachDraft[],
  recipient: string,
  sender = process.env.OUTREACH_FROM_EMAIL?.trim() || DEFAULT_SENDER
): PreparedEmail {
  const normalizedRecipient = recipient.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecipient)) {
    throw new Error("A valid single recipient email address is required.");
  }
  const matches = records.filter((record) =>
    record.emails.some((entry) => entry.email.trim().toLowerCase() === normalizedRecipient)
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one draft for ${normalizedRecipient}; found ${matches.length}. Refusing to send.`);
  }
  const draft = matches[0];
  if (!draft.subject?.trim() || !draft.draftBody?.trim()) {
    throw new Error("The selected record has no complete subject/body draft.");
  }
  if (/[\r\n]/.test(sender) || !sender.includes("@")) {
    throw new Error("OUTREACH_FROM_EMAIL is not a valid sender address.");
  }
  return { from: sender, to: normalizedRecipient, subject: draft.subject.trim(), text: draft.draftBody.trim() };
}

export function parseSuppressionList(contents: string): Set<string> {
  return new Set(contents.split(/\r?\n/).map((line) => line.trim().toLowerCase())
    .filter((line) => line.length > 0 && !line.startsWith("#")));
}

export function assertLiveSendAllowed(
  email: PreparedEmail,
  env: NodeJS.ProcessEnv = process.env,
  suppressedEmails: Set<string> = new Set()
): void {
  assertProductionKillSwitchEnabled(env);
  if (env.GULLKORNET_APPROVED_RECIPIENT?.trim().toLowerCase() !== email.to) {
    throw new Error("Recipient does not exactly match GULLKORNET_APPROVED_RECIPIENT.");
  }
  if (env.GULLKORNET_RECIPIENT_REVIEWED !== "true") {
    throw new Error("Recipient review confirmation missing. Confirm recipient suitability and applicable marketing rules first.");
  }
  if (!env.RESEND_API_KEY?.trim()) throw new Error("RESEND_API_KEY is required for live sending.");
  if (email.from.toLowerCase() !== DEFAULT_SENDER) throw new Error(`Sender must remain ${DEFAULT_SENDER} for this pilot.`);
  if (suppressedEmails.has(email.to)) throw new Error("Recipient is on the suppression list. Refusing to send.");
  if (!env.GULLKORNET_SEND_IDEMPOTENCY_KEY?.trim()) {
    throw new Error("GULLKORNET_SEND_IDEMPOTENCY_KEY is required to prevent duplicate sends on retries.");
  }
}

export async function sendOneEmail(email: PreparedEmail, apiKey: string, idempotencyKey: string): Promise<{ id: string }> {
  if (!idempotencyKey.trim()) throw new Error("An idempotency key is required.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey.trim()
    },
    body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text }),
    signal: AbortSignal.timeout(15000)
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body === "object" && body !== null && "message" in body
      ? String((body as { message: unknown }).message)
      : `Resend returned HTTP ${response.status}`;
    throw new Error(`Resend send failed: ${detail}`);
  }
  if (typeof body !== "object" || body === null || !("id" in body) || typeof (body as { id: unknown }).id !== "string") {
    throw new Error("Resend returned an unexpected success response without an email ID.");
  }
  return { id: (body as { id: string }).id };
}


/**
 * Phase 11 fails closed for the legacy batch sender. Its historical implementation
 * does not provide a durable global rate ledger, reply-aware suppression, or a
 * per-recipient approval flow. Keep batch sending disabled until those controls
 * are implemented and accepted end to end.
 */
export function assertBulkSendDisabledForPhase11(): never {
  throw new Error(
    "Bulk outreach is disabled during Phase 11. Use only the guarded single-recipient path after explicit approval."
  );
}
