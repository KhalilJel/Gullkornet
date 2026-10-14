import { businessDomainOf } from "../domain/email-domain.js";
import { LITE_MARKER, LITE_READY_STATUS } from "./intake.js";
import { assessResearch, segmentFromNotes, type SegmentResearch } from "./market-research.js";
import { assessLiteRecipient } from "./recipient-policy.js";
import { orgnrFromNotes } from "./freshness.js";
import { orgFormFromNotes, type LiteQueueRecord } from "./send.js";

// Read-only data-quality and sales overview for Gullkornet Lite. Reports record IDs and issue codes
// only: the repository and its Actions logs are public, so no address or company name is printed.

/** Sales follow-up fields (docs/LITE-SALGSOPPFOLGING.md). Missing fields are reported, never created. */
export const SALES_FIELDS = Object.freeze(["Next Step", "Next Step Date", "Offer NOK", "Paid NOK", "Paid Date"]);
export const SALES_STATUSES = Object.freeze(["Replied", "Interested", "Meeting", "Offer Sent", "Won", "Lost", "Do Not Contact"]);
export const REVENUE_GOAL_NOK = 50_000;

export type RowIssue = { id: string; issues: string[] };

export type LiteAuditReport = {
  liteRows: number;
  statusCounts: Record<string, number>;
  readyRows: number;
  readyClean: number;
  issueCounts: Record<string, number>;
  rowsWithIssues: RowIssue[];
  /** Sum of "Paid NOK" over every row (any pipeline) and the number of paying rows. */
  paidNok: number;
  payingRows: number;
  offeredNok: number;
  /** Rows in an active sales status whose Next Step Date has passed or is missing. */
  overdueFollowUps: string[];
};

function text(record: LiteQueueRecord, field: string): string {
  const value = record.fields[field];
  return typeof value === "string" ? value.trim() : "";
}

function amount(record: LiteQueueRecord, field: string): number {
  const value = record.fields[field];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * `all` is every row in the table (all statuses, both pipelines). Freshness (Brreg/DNS) is checked
 * separately by the CLI, since it needs the network; pass its results in `freshness` (record ID -> reason).
 */
export function auditLiteRows(
  all: LiteQueueRecord[],
  research: Map<string, SegmentResearch>,
  nowMs: number,
  freshness: Map<string, string> = new Map(),
  allowedOrgForms?: readonly string[]
): LiteAuditReport {
  const lite = all.filter(row => text(row, "Research Notes").includes(LITE_MARKER));
  const report: LiteAuditReport = {
    liteRows: lite.length, statusCounts: {}, readyRows: 0, readyClean: 0, issueCounts: {}, rowsWithIssues: [],
    paidNok: 0, payingRows: 0, offeredNok: 0, overdueFollowUps: []
  };

  const byEmail = new Map<string, number>();
  const byDomain = new Map<string, number>();
  const byOrgnr = new Map<string, number>();
  for (const row of all) {
    const email = text(row, "Email").toLowerCase();
    if (email) byEmail.set(email, (byEmail.get(email) ?? 0) + 1);
    const domain = email ? businessDomainOf(email) : undefined;
    if (domain) byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
    const orgnr = orgnrFromNotes(text(row, "Research Notes"));
    if (orgnr) byOrgnr.set(orgnr, (byOrgnr.get(orgnr) ?? 0) + 1);
  }

  for (const row of lite) {
    const status = text(row, "Lead Status") || "(empty)";
    report.statusCounts[status] = (report.statusCounts[status] ?? 0) + 1;
    if (status !== LITE_READY_STATUS) continue;
    report.readyRows++;
    const notes = text(row, "Research Notes");
    const email = text(row, "Email").toLowerCase();
    const issues: string[] = [];
    if (row.fields["Do Not Contact"] === true) issues.push("DNC_TICKED");
    const policy = assessLiteRecipient({ email, orgForm: orgFormFromNotes(notes), websiteUrl: text(row, "Website") || undefined }, allowedOrgForms);
    if (!policy.ok) issues.push(`POLICY_${policy.reason}`);
    const segment = segmentFromNotes(notes);
    const decision = assessResearch(segment, segment && research.get(segment.key), nowMs);
    if (!decision.ok) issues.push(decision.reason);
    if (email && (byEmail.get(email) ?? 0) > 1) issues.push("DUPLICATE_EMAIL");
    const domain = email ? businessDomainOf(email) : undefined;
    if (domain && (byDomain.get(domain) ?? 0) > 1) issues.push("DUPLICATE_DOMAIN");
    const orgnr = orgnrFromNotes(notes);
    if (orgnr && (byOrgnr.get(orgnr) ?? 0) > 1) issues.push("DUPLICATE_ORGNR");
    const stale = freshness.get(row.id);
    if (stale) issues.push(stale);
    for (const issue of issues) report.issueCounts[issue] = (report.issueCounts[issue] ?? 0) + 1;
    if (issues.length) report.rowsWithIssues.push({ id: row.id, issues });
    else report.readyClean++;
  }

  const active = new Set(["Replied", "Interested", "Meeting", "Offer Sent"]);
  for (const row of all) {
    const paid = amount(row, "Paid NOK");
    if (paid) { report.paidNok += paid; report.payingRows++; }
    if (text(row, "Lead Status") === "Offer Sent") report.offeredNok += amount(row, "Offer NOK");
    if (active.has(text(row, "Lead Status"))) {
      const due = Date.parse(text(row, "Next Step Date"));
      if (!Number.isFinite(due) || due < nowMs - 24 * 60 * 60 * 1000) report.overdueFollowUps.push(row.id);
    }
  }
  return report;
}
