import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSuppressionList, prepareEmail, sendOneEmail, type OutreachDraft } from "../integrations/outbound-email.js";

type AirtableRecord = { id: string; fields: Record<string, unknown> };
type AirtableListResponse = { records: AirtableRecord[]; offset?: string };

const apiToken = process.env.AIRTABLE_API_TOKEN?.trim();
const baseId = process.env.GULLKORNET_AIRTABLE_BASE_ID?.trim();
const tableName = process.env.GULLKORNET_AIRTABLE_TABLE?.trim() || "Leads";
const dailyLimit = Math.min(20, Math.max(1, Number.parseInt(process.env.GULLKORNET_DAILY_SEND_LIMIT || "20", 10) || 20));
const apiRoot = "https://api.airtable.com/v0";
const defaultSender = "jelassi@smartsvar.no";

async function airtable<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Airtable request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  return await response.json() as T;
}

async function listAll(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`${apiRoot}/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    for (const field of ["Company", "Email", "Lead Status", "Do Not Contact", "Duplicate Key", "Outreach Subject", "Outreach Draft"]) {
      url.searchParams.append("fields[]", field);
    }
    if (offset) url.searchParams.set("offset", offset);
    const page = await airtable<AirtableListResponse>(url.toString());
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

async function updateStatus(recordId: string, status: string): Promise<void> {
  await airtable(`${apiRoot}/${baseId}/${encodeURIComponent(tableName)}/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: { "Lead Status": status } })
  });
}

function normalizedEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function main(): Promise<void> {
  if (process.env.GULLKORNET_ENABLE_LIVE_SEND !== "true") throw new Error("Live sending is disabled. Set GULLKORNET_ENABLE_LIVE_SEND=true to enable the scheduled prototype.");
  if (!apiToken || !baseId) throw new Error("AIRTABLE_API_TOKEN and GULLKORNET_AIRTABLE_BASE_ID are required.");
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) throw new Error("RESEND_API_KEY is required.");
  if ((process.env.OUTREACH_FROM_EMAIL?.trim() || defaultSender).toLowerCase() !== defaultSender) {
    throw new Error(`Sender must remain ${defaultSender} for this pilot.`);
  }

  let suppressed = new Set<string>();
  try { suppressed = parseSuppressionList(await readFile("data/suppressed-emails.txt", "utf8")); } catch { /* Airtable suppression flags still apply. */ }

  // Airtable is the persistent queue. Do not limit sending to the newest research artifact:
  // that artifact may contain only a few leads even when the registry has many ready drafts.
  const airtableRecords = await listAll();
  const candidates: Array<{ draft: OutreachDraft; email: string; record: AirtableRecord }> = [];
  const seen = new Set<string>();
  const counts = { draftReady: 0, missingEmail: 0, missingDraft: 0, suppressed: 0, duplicate: 0, otherStatus: 0 };

  for (const record of airtableRecords) {
    const fields = record.fields;
    const status = String(fields["Lead Status"] || "");
    if (status !== "Draft Ready") { counts.otherStatus++; continue; }
    counts.draftReady++;

    const email = normalizedEmail(fields.Email);
    if (!email) { counts.missingEmail++; continue; }
    if (seen.has(email)) { counts.duplicate++; continue; }
    seen.add(email);
    if (fields["Do Not Contact"] === true || suppressed.has(email)) { counts.suppressed++; continue; }

    const subject = typeof fields["Outreach Subject"] === "string" ? fields["Outreach Subject"].trim() : "";
    const draftBody = typeof fields["Outreach Draft"] === "string" ? fields["Outreach Draft"].trim() : "";
    if (!subject || !draftBody) { counts.missingDraft++; continue; }

    const draft: OutreachDraft = {
      companyName: String(fields.Company || "Ukjent bedrift"),
      emails: [{ email }],
      subject,
      draftBody
    };
    candidates.push({ draft, email, record });
  }

  let sent = 0;
  let failed = 0;
  for (const candidate of candidates.slice(0, dailyLimit)) {
    const email = prepareEmail([candidate.draft], candidate.email, defaultSender);
    const idempotencyKey = "gullkornet-" + createHash("sha256").update(candidate.record.id + "|" + candidate.email).digest("hex");
    try {
      const result = await sendOneEmail(email, resendKey, idempotencyKey);
      await updateStatus(candidate.record.id, "Sent");
      sent++;
      console.log(`SENT company="${candidate.draft.companyName}" email="${candidate.email}" resend_id="${result.id}"`);
    } catch (error) {
      failed++;
      console.error(`SEND_FAILED company="${candidate.draft.companyName}" email="${candidate.email}" error="${error instanceof Error ? error.message : "Unknown error"}"`);
    }
  }
  console.log(JSON.stringify({
    mode: "live", dailyLimit, airtableRecords: airtableRecords.length, ...counts,
    eligible: candidates.length, attempted: Math.min(candidates.length, dailyLimit),
    sent, failed, remainingReady: Math.max(0, candidates.length - sent - failed)
  }));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Daily outreach failed.");
  process.exitCode = 1;
});
