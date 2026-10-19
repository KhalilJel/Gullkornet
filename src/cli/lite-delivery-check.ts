import { lookupLiteRecords } from "../lite/airtable-queue.js";
import {
  exactAddressBlocked, FAILED_EVENTS, fetchResendEmailsSince, markDoNotContact, providerDetail, recipientRef, rowStates, stopLiftsAt, SUPPRESS_EVENTS
} from "../lite/delivery-check.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { assessDeliveryHealth, type BounceInfo } from "../lite/delivery-health.js";
import { fetchBounceInfo } from "../lite/delivery-check.js";

// npm run lite:delivery-check -- [--days 7] [--apply-suppression]
// Read-only by default: lists the Resend events that trip the delivery-health stop, with the
// provider's diagnostic fields and the matching Airtable rows' state. No addresses are printed.
// --apply-suppression ticks Do Not Contact on the exact-address rows of bounced, complained or
// suppressed recipients that are not already DNC (verified from Airtable's answer).

async function main(): Promise<void> {
  const daysIndex = process.argv.indexOf("--days");
  const days = daysIndex >= 0 ? Number(process.argv[daysIndex + 1]) : 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("--days must be 1-30.");
  const apply = process.argv.includes("--apply-suppression");
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is required.");
  const airtable = airtableConfigFromEnv(process.env);
  const now = Date.now();

  const emails = await fetchResendEmailsSince(apiKey, now - days * 24 * 60 * 60 * 1000);
  const byEvent = new Map<string, number>();
  for (const e of emails) byEvent.set(e.last_event ?? "unknown", (byEvent.get(e.last_event ?? "unknown") ?? 0) + 1);
  console.log(`Resend emails in the last ${days} days: ${emails.length} (${[...byEvent].map(([k, v]) => `${k}=${v}`).join(" ")})`);
  const last24 = emails.filter(e => now - Date.parse(e.created_at) < 24 * 60 * 60 * 1000);
  console.log(`Last 24 h: ${last24.length} emails.`);
  const lifts = stopLiftsAt(emails, now);
  console.log(lifts === undefined ? "Old global rule: no failure in 24 h." : `Old global rule would stop until ${new Date(lifts).toISOString()}.`);
  const bounces = new Map<string, BounceInfo>();
  for (const e of last24) {
    if (e.last_event === "bounced" && e.id) { const info = await fetchBounceInfo(apiKey, e.id); if (info) bounces.set(e.id, info); }
  }
  const verdict = assessDeliveryHealth(emails, bounces, now);
  console.log(verdict.ok
    ? `Delivery-health stop (targeted policy): not active; ${verdict.recipientScoped.length} recipient-scoped failure(s) to reserve.`
    : `Delivery-health stop (targeted policy): ACTIVE: ${verdict.reason}`);

  const failedSet = new Set<string>(FAILED_EVENTS);
  const failed = emails.filter(e => failedSet.has(e.last_event ?? ""));
  let unblocked = 0;
  for (const entry of failed) {
    const recipient = (entry.to ?? [])[0]?.trim().toLowerCase() ?? "";
    const ref = recipient ? recipientRef(recipient) : "none";
    let detail = "-";
    if (entry.id) {
      const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(entry.id)}`, {
        headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000)
      });
      detail = response.ok ? providerDetail(await response.json() as Record<string, unknown>, recipient) : `detail HTTP ${response.status}`;
    }
    const inWindow = now - Date.parse(entry.created_at) < 24 * 60 * 60 * 1000;
    console.log(`- ${entry.created_at} event=${entry.last_event} recipient=${ref} inStopWindow=${inWindow} resendId=${entry.id ?? "-"}`);
    console.log(`  provider: ${detail}`);
    if (!recipient) continue;
    const states = rowStates(await lookupLiteRecords(airtable, recipient), recipient);
    for (const s of states) {
      console.log(`  airtable ${s.recordId}: exactAddress=${s.exactAddress} leadStatus=${s.leadStatus || "-"} doNotContact=${s.doNotContact}`);
    }
    const blocked = exactAddressBlocked(states);
    console.log(`  exact address blocked from re-contact: ${blocked}${states.some(s => s.exactAddress) ? "" : " (no exact-address row)"}`);
    if (!SUPPRESS_EVENTS.has(entry.last_event ?? "")) continue;
    const toMark = states.filter(s => s.exactAddress && !s.doNotContact);
    if (toMark.length === 0) continue;
    if (!apply) { unblocked++; console.log(`  would set Do Not Contact on: ${toMark.map(s => s.recordId).join(", ")}`); continue; }
    for (const s of toMark) {
      await markDoNotContact(airtable, s.recordId);
      console.log(`  Do Not Contact set and verified on ${s.recordId}.`);
    }
  }
  console.log(`Failed events: ${failed.length} (${FAILED_EVENTS.map(k => `${k}=${byEvent.get(k) ?? 0}`).join(" ")}). ` +
    `${apply ? "Suppression applied." : `Rows that would get Do Not Contact: ${unblocked}.`}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Lite delivery check failed.");
  process.exitCode = 1;
});
