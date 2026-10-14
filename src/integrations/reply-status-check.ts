import { randomBytes } from "node:crypto";
import { assertRecipientHasNotReplied } from "./reply-status.js";

export type ReplyCheckResult = "replied=true" | "replied=false" | "error";

/** Same lookup the senders use; a failure is "error", never "replied=false". */
export async function replyStatusOf(recipient: string, env: NodeJS.ProcessEnv = process.env): Promise<ReplyCheckResult> {
  try {
    await assertRecipientHasNotReplied(recipient, env);
    return "replied=false";
  } catch (error) {
    return error instanceof Error && error.message.startsWith("Recipient has replied") ? "replied=true" : "error";
  }
}

/** Fresh address under the reserved .invalid TLD (RFC 2606): no mail can ever come from it. */
export function negativeControlAddress(): string {
  return `gullkornet-negative-${randomBytes(6).toString("hex")}@negative-control.invalid`;
}

export type ReplyCheckReport = { positive: ReplyCheckResult; negative: ReplyCheckResult; pass: boolean };

/** Positive control must answer replied=true and the negative control replied=false. */
export async function runReplyStatusCheck(
  testSender: string,
  check: (recipient: string) => Promise<ReplyCheckResult> = recipient => replyStatusOf(recipient)
): Promise<ReplyCheckReport> {
  const positive = testSender.trim() ? await check(testSender) : "error";
  const negative = await check(negativeControlAddress());
  return { positive, negative, pass: positive === "replied=true" && negative === "replied=false" };
}
