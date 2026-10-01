import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Lead } from "./lead.js";
import { deduplicateLeads } from "./dedupe.js";
import { qualifyLead } from "./qualification.js";
import type { LeadStore } from "../storage/lead-store.js";

const evidenceSchema = z.object({
  sourceUrl: z.string().url(),
  observation: z.string().trim().min(10).max(1000),
  checkedAt: z.string().datetime().optional()
});

const intakeSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  websiteUrl: z.string().trim().url().optional(),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().email().optional(),
  city: z.string().trim().min(2).max(100).optional(),
  industry: z.string().trim().min(2).max(100).optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  websiteIssue: z.enum([
    "NO_WEBSITE",
    "OUTDATED_DESIGN",
    "UNCLEAR_SERVICES",
    "WEAK_CONTACT_PATH",
    "MOBILE_USABILITY",
    "PERFORMANCE",
    "NONE"
  ]).optional(),
  opportunity: z.string().trim().max(1000).optional(),
  sourceUrl: z.string().trim().url().optional(),
  evidence: z.array(evidenceSchema).default([])
}).strict();

export type LeadIntakeRecord = z.input<typeof intakeSchema>;

export type IntakeSummary = {
  imported: number;
  duplicates: number;
  qualified: number;
  notQualified: number;
  rejected: number;
  issues: Array<{ index: number; companyName?: string; error: string }>;
};

export async function importLeadRecords(
  records: unknown[],
  store: LeadStore,
  now = new Date()
): Promise<IntakeSummary> {
  const summary: IntakeSummary = {
    imported: 0,
    duplicates: 0,
    qualified: 0,
    notQualified: 0,
    rejected: 0,
    issues: []
  };

  const existing = await store.list();
  const accepted: Lead[] = [];

  for (const [index, record] of records.entries()) {
    const parsed = intakeSchema.safeParse(record);
    if (!parsed.success) {
      summary.rejected += 1;
      const candidate = record && typeof record === "object" ? record as Record<string, unknown> : {};
      summary.issues.push({
        index,
        companyName: typeof candidate.companyName === "string" ? candidate.companyName : undefined,
        error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`).join("; ")
      });
      continue;
    }

    const timestamp = now.toISOString();
    const lead: Lead = {
      id: randomUUID(),
      ...parsed.data,
      status: "NEW",
      evidence: parsed.data.evidence.map((item) => ({
        ...item,
        checkedAt: item.checkedAt ?? timestamp
      })),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const qualification = qualifyLead(lead);
    lead.fitScore = qualification.fitScore;
    if (qualification.qualified) {
      lead.status = "QUALIFIED";
      summary.qualified += 1;
    } else {
      lead.status = "RESEARCHED";
      summary.notQualified += 1;
    }
    accepted.push(lead);
  }

  const deduplicated = deduplicateLeads([...existing, ...accepted]);
  const existingIds = new Set(existing.map((lead) => lead.id));
  const retainedNew = deduplicated.uniqueLeads.filter((lead) => !existingIds.has(lead.id));
  summary.duplicates = deduplicated.duplicates.filter((duplicate) =>
    accepted.some((lead) => lead.id === duplicate.duplicateLeadId)
  ).length;
  summary.imported = retainedNew.length;

  if (retainedNew.length > 0) {
    await store.saveAll(deduplicated.uniqueLeads);
  }

  return summary;
}
