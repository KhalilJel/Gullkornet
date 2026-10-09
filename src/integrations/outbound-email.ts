export type OutreachDraft = {
  companyName: string;
  emails: Array<{ email: string; sourceUrl?: string; sourceType?: string }>;
  subject?: string;
  draftBody?: string;
};

export type PreparedEmail = { from: string; to: string; subject: string; text: string };

export const DEFAULT_SENDER = "jelassi@cideamarketing.com";

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
  if (env.GULLKORNET_ENABLE_LIVE_SEND !== "true") {
    throw new Error("Live sending is disabled. Set GULLKORNET_ENABLE_LIVE_SEND=true only for an approved one-off send.");
  }
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
