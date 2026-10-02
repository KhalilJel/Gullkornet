export type OutreachDraft = {
  companyName: string;
  emails: Array<{ email: string; sourceUrl?: string; sourceType?: string }>;
  subject?: string;
  draftBody?: string;
};

export type PreparedEmail = { from: string; to: string; subject: string; text: string };

export const DEFAULT_SENDER = "jelassi@smartsvar.no";

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
  return {
    from: sender,
    to: normalizedRecipient,
    subject: draft.subject.trim(),
    text: draft.draftBody.trim()
  };
}

export function assertLiveSendAllowed(
  email: PreparedEmail,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.GULLKORNET_ENABLE_LIVE_SEND !== "true") {
    throw new Error("Live sending is disabled. Set GULLKORNET_ENABLE_LIVE_SEND=true only for an approved one-off send.");
  }
  if (env.GULLKORNET_APPROVED_RECIPIENT?.trim().toLowerCase() !== email.to) {
    throw new Error("Recipient does not exactly match GULLKORNET_APPROVED_RECIPIENT.");
  }
  if (env.GULLKORNET_RECIPIENT_REVIEWED !== "true") {
    throw new Error("Recipient review confirmation missing. Set GULLKORNET_RECIPIENT_REVIEWED=true only after checking recipient and applicable marketing rules.");
  }
  if (env.RESEND_API_KEY?.trim() === undefined || env.RESEND_API_KEY.trim() === "") {
    throw new Error("RESEND_API_KEY is required for live sending.");
  }
  if (email.from.toLowerCase() !== DEFAULT_SENDER) {
    throw new Error(`Sender must remain ${DEFAULT_SENDER} for this pilot.`);
  }
}

export async function sendOneEmail(email: PreparedEmail, apiKey: string): Promise<{ id: string }> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: email.from,
      to: [email.to],
      subject: email.subject,
      text: email.text
    }),
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
