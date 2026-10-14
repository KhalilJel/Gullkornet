import { auditLiteRows, REVENUE_GOAL_NOK, SALES_FIELDS, SALES_STATUSES } from "../lite/audit.js";
import { checkLiteFreshness } from "../lite/freshness.js";
import { airtableConfigFromEnv, LITE_READY_STATUS, type AirtableConfig } from "../lite/intake.js";
import { loadResearchIndex } from "../lite/market-research.js";
import { parseAllowedOrgForms } from "../lite/recipient-policy.js";
import { fetchAllTableRows } from "../lite/airtable-queue.js";
import { planLiteRetention } from "../lite/retention.js";
import { lookupFingerprints } from "../lite/fingerprint.js";

// npm run lite:audit
// Read-only. Data quality of every Lite Ready row (recipient policy, duplicates, research, and a
// fresh Brreg + MX check) and the sales overview (statuses, offers, paid revenue against the goal).
// Writes nothing, sends nothing. Prints record IDs and counts only (public Actions logs).

/** Field names and Lead Status options, if the token may read the schema; otherwise the HTTP status. */
async function readSchema(cfg: AirtableConfig): Promise<{ fields: Set<string>; statuses: Set<string> } | { httpStatus: number }> {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${cfg.baseId}/tables`, {
    headers: { Authorization: `Bearer ${cfg.apiToken}` }, signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) return { httpStatus: response.status };
  const payload = await response.json() as { tables?: Array<{ name?: string; fields?: Array<{ name?: string; options?: { choices?: Array<{ name?: string }> } }> }> };
  const table = payload.tables?.find(t => t.name === cfg.tableName);
  if (!table?.fields) return { httpStatus: 404 };
  const status = table.fields.find(f => f.name === "Lead Status");
  return {
    fields: new Set(table.fields.map(f => f.name ?? "")),
    statuses: new Set((status?.options?.choices ?? []).map(c => c.name ?? ""))
  };
}

/** Read-only field probe without schema access: Airtable answers 422 to an unknown field name. */
async function fieldExists(cfg: AirtableConfig, field: string): Promise<boolean | undefined> {
  const url = new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
  url.searchParams.set("maxRecords", "1");
  url.searchParams.append("fields[]", field);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiToken}` }, signal: AbortSignal.timeout(20000) });
  if (response.ok) return true;
  if (response.status === 422) return false;
  return undefined;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const env = process.env;
  const cfg = airtableConfigFromEnv(env);
  const allowedOrgForms = parseAllowedOrgForms(env.GULLKORNET_LITE_ORG_FORMS);
  const research = await loadResearchIndex();
  const rows = await fetchAllTableRows(cfg);
  const now = Date.now();

  const freshness = new Map<string, string>();
  for (const row of rows) {
    const notes = typeof row.fields["Research Notes"] === "string" ? row.fields["Research Notes"] : "";
    const email = typeof row.fields.Email === "string" ? row.fields.Email.trim().toLowerCase() : "";
    if (row.fields["Lead Status"] !== LITE_READY_STATUS || !notes.includes("[GK-LITE]") || !email) continue;
    try {
      const reason = await checkLiteFreshness(notes, email, allowedOrgForms);
      if (reason) freshness.set(row.id, reason);
    } catch (error) {
      // Only the error category (e.g. "DNS lookup failed (ETIMEOUT)"), never an address.
      const category = error instanceof Error ? /^(DNS lookup|Brreg lookup) failed \(([A-Z0-9 ]+)\)/.exec(error.message) : null;
      freshness.set(row.id, "FRESHNESS_CHECK_UNAVAILABLE" + (category ? `:${category[1].split(" ")[0].toUpperCase()}_${category[2].replace(/\s+/g, "_")}` : ""));
    }
    await sleep(200); // gentle on Brreg's open API
  }

  const report = auditLiteRows(rows, research, now, freshness, allowedOrgForms);
  const lines: string[] = [];
  lines.push(`Gullkornet Lite audit (${new Date(now).toISOString()})`);
  lines.push(`Table rows: ${rows.length}; Lite rows: ${report.liteRows}; documented segments: ${research.size}`);
  lines.push(`Lite status: ${Object.entries(report.statusCounts).map(([s, n]) => `${s}=${n}`).join(", ") || "-"}`);
  lines.push(`Lite Ready: ${report.readyRows}; clean (would pass every data check): ${report.readyClean}`);
  lines.push(`Issues: ${Object.entries(report.issueCounts).map(([s, n]) => `${s}=${n}`).join(", ") || "none"}`);
  for (const row of report.rowsWithIssues) lines.push(`  ${row.id}: ${row.issues.join(", ")}`);
  lines.push(`Sales: paid ${report.paidNok} NOK from ${report.payingRows} customer(s); goal ${REVENUE_GOAL_NOK} NOK (${Math.round(100 * report.paidNok / REVENUE_GOAL_NOK)} %); open offers ${report.offeredNok} NOK`);
  lines.push(`Follow-ups without a future Next Step Date: ${report.overdueFollowUps.length}${report.overdueFollowUps.length ? " (" + report.overdueFollowUps.join(", ") + ")" : ""}`);

  const tableStatus: Record<string, number> = {};
  for (const row of rows) {
    const status = typeof row.fields["Lead Status"] === "string" ? row.fields["Lead Status"] : "(empty)";
    tableStatus[status] = (tableStatus[status] ?? 0) + 1;
  }
  lines.push(`Table status (all pipelines): ${Object.entries(tableStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}=${n}`).join(", ")}`);
  const liteDnc = rows.filter(r => String(r.fields["Research Notes"] ?? "").includes("[GK-LITE]") && r.fields["Do Not Contact"] === true).length;
  lines.push(`Lite rows with Do Not Contact: ${liteDnc}`);
  for (const r of research.values()) {
    const days = Math.floor((Date.parse(r.researchedAt) + 90 * 86_400_000 - now) / 86_400_000);
    lines.push(`Research ${r.id}: ${days} days left of 90`);
  }

  const retention = planLiteRetention(rows, now);
  const count = (kind: string) => retention.actions.filter(a => a.action === kind).length;
  lines.push(`Retention (dry-run, 90 days): delete=${count("delete")} minimize=${count("minimize")} keptActive=${retention.keptActive.length} undated=${retention.undated.length} alreadyMinimized=${retention.alreadyMinimized}`);

  const schema = await readSchema(cfg).catch(() => ({ httpStatus: 0 }));
  if ("httpStatus" in schema) {
    lines.push(`Schema API: HTTP ${schema.httpStatus} (needs scope schema.bases:read); Lead Status options not verified.`);
    const probes = await Promise.all(SALES_FIELDS.map(async f => [f, await fieldExists(cfg, f).catch(() => undefined)] as const));
    lines.push(`Sales fields (probe): ${probes.map(([f, ok]) => `${f}=${ok === undefined ? "unknown" : ok ? "present" : "MISSING"}`).join(", ")}`);
  } else {
    const missingFields = SALES_FIELDS.filter(f => !schema.fields.has(f));
    const missingStatuses = SALES_STATUSES.filter(s => !schema.statuses.has(s));
    lines.push(`Schema: missing sales fields: ${missingFields.join(", ") || "none"}; missing Lead Status options: ${missingStatuses.join(", ") || "none"}`);
  }
  // Optional: status of specific businesses, asked for by keyed domain fingerprints (src/lite/fingerprint.ts).
  const lookup = (env.LITE_AUDIT_LOOKUP ?? "").split(",").map(v => v.trim()).filter(Boolean);
  if (lookup.length) {
    const key = env.GULLKORNET_LITE_RESEARCH_KEY?.trim() ?? "";
    for (const match of lookupFingerprints(rows, lookup, key)) {
      lines.push(`Lookup ${match.fingerprint}: ${match.statuses.length ? match.statuses.join("+") : "not in Airtable"}${match.doNotContact ? " DNC" : ""}`);
    }
  }
  console.log(lines.join("\n"));
  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(env.GITHUB_STEP_SUMMARY, "```\n" + lines.join("\n") + "\n```\n");
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Gullkornet Lite audit failed.");
  process.exitCode = 1;
});
