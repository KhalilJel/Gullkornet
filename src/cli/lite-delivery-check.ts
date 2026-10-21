import { lookupLiteRecords } from "../lite/airtable-queue.js";
import {
  exactAddressBlocked, FAILED_EVENTS, fetchResendEmailsSince, markDoNotContact, providerDetail, recipientRef, rowStates, stopLiftsAt, SUPPRESS_EVENTS
} from "../lite/delivery-check.js";
import { airtableConfigFromEnv } from "../lite/intake.js";
import { assessDeliveryHealth, type BounceInfo } from "../lite/delivery-health.js";
import { fetchBounceInfo } from "../lite/delivery-check.js";
import { analyzeBounces, bounceFeatures, type AnalysisRow } from "../lite/bounce-analysis.js";
import { Resolver } from "node:dns/promises";

// npm run lite:delivery-check -- [--days 7] [--apply-suppression] [--analyze] [--recent 5]
// Read-only by default: lists the Resend events that trip the delivery-health stop, with the
// provider's diagnostic fields and the matching Airtable rows' state. No addresses are printed.
// --analyze compares the 30-day bounces with the deliveries that went through, per coarse feature
// (local part, website domain match, free mail, source, MX family); it prints counts only.
// --recent N lists the N newest sends one by one with their fresh provider status (hash, no address).
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

  // The policy always needs the complete 30-day denominator, irrespective of the display range.
  const history = await fetchResendEmailsSince(apiKey, now - 30 * 24 * 60 * 60 * 1000);
  const emails = history.filter(e => Date.parse(e.created_at) >= now - days * 24 * 60 * 60 * 1000);
  const byEvent = new Map<string, number>();
  for (const e of emails) byEvent.set(e.last_event ?? "unknown", (byEvent.get(e.last_event ?? "unknown") ?? 0) + 1);
  console.log(`Resend emails in the last ${days} days: ${emails.length} (${[...byEvent].map(([k, v]) => `${k}=${v}`).join(" ")})`);
  const last24 = history.filter(e => now - Date.parse(e.created_at) < 24 * 60 * 60 * 1000);
  console.log(`Last 24 h: ${last24.length} emails.`);
  const lifts = stopLiftsAt(emails, now);
  console.log(lifts === undefined ? "Old global rule: no failure in 24 h." : `Old global rule would stop until ${new Date(lifts).toISOString()}.`);
  const bounces = new Map<string, BounceInfo>();
  for (const e of last24) {
    if (e.last_event === "bounced" && e.id) { const info = await fetchBounceInfo(apiKey, e.id); if (info) bounces.set(e.id, info); }
  }
  const verdict = assessDeliveryHealth(history, bounces, now);
  console.log(verdict.ok
    ? `Delivery-health stop (targeted policy): not active; ${verdict.recipientScoped.length} recipient-scoped failure(s) to reserve.`
    : `Delivery-health stop (targeted policy): ACTIVE: ${verdict.reason}`);

  if (process.argv.includes("--analyze")) await analyze(history, airtable);
  const recentIndex = process.argv.indexOf("--recent");
  if (recentIndex >= 0) {
    const n = Number(process.argv[recentIndex + 1]);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error("--recent must be 1-50.");
    const newest = [...history].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, n);
    console.log(`Newest ${newest.length} sends, fresh status from Resend:`);
    for (const entry of newest) {
      const recipient = (entry.to ?? [])[0]?.trim().toLowerCase() ?? "";
      let detail = "-";
      if (entry.id) {
        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(entry.id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000)
        });
        detail = response.ok ? providerDetail(await response.json() as Record<string, unknown>, recipient) : `detail HTTP ${response.status}`;
      }
      console.log(`- ${entry.created_at} recipient=${recipient ? recipientRef(recipient) : "none"} listEvent=${entry.last_event ?? "-"} detail=${detail}`);
    }
  }

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

async function analyze(history: Awaited<ReturnType<typeof fetchResendEmailsSince>>, airtable: ReturnType<typeof airtableConfigFromEnv>): Promise<void> {
  const resolver = new Resolver({ timeout: 3000, tries: 2 });
  const mxCache = new Map<string, string[] | undefined>();
  const rows: AnalysisRow[] = [];
  for (const entry of history) {
    const email = (entry.to ?? [])[0]?.trim().toLowerCase();
    if (!email || !["delivered", "bounced", "opened", "clicked", "suppressed", "complained"].includes(entry.last_event ?? "")) continue;
    const exact = (await lookupLiteRecords(airtable, email)).find(r => typeof r.fields.Email === "string" && r.fields.Email.trim().toLowerCase() === email);
    const domain = email.split("@")[1] ?? "";
    if (!mxCache.has(domain)) {
      mxCache.set(domain, await resolver.resolveMx(domain).then(mx => mx.sort((a, b) => a.priority - b.priority).map(m => m.exchange), (error: NodeJS.ErrnoException) =>
        error.code === "ENOTFOUND" || error.code === "ENODATA" ? [] : undefined));
    }
    rows.push({
      features: bounceFeatures(email, String(exact?.fields["Research Notes"] ?? ""), typeof exact?.fields.Website === "string" ? exact.fields.Website : undefined, mxCache.get(domain)),
      failed: entry.last_event === "bounced" || entry.last_event === "suppressed"
    });
  }
  const failed = rows.filter(r => r.failed).length;
  console.log(`Bounce analysis (30 days): ${rows.length} settled sends, ${failed} bounced or suppressed (${(100 * failed / Math.max(1, rows.length)).toFixed(1)}%).`);
  for (const line of analyzeBounces(rows)) {
    console.log(`  ${line.feature}=${line.value}: sent=${line.sent} failed=${line.failed} rate=${(100 * line.rate).toFixed(1)}%`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Lite delivery check failed.");
  process.exitCode = 1;
});
