import { JsonLeadStore } from "../storage/lead-store.js";

const storePath = process.env.LEAD_STORE_PATH?.trim() || "data/leads.json";

try {
  const leads = await new JsonLeadStore(storePath).list();
  const byStatus = Object.fromEntries(
    leads.reduce((counts, lead) => {
      counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())
  );

  const qualified = leads
    .filter((lead) => lead.status === "QUALIFIED")
    .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
    .map((lead) => ({
      companyName: lead.companyName,
      organizationNumber: lead.organizationNumber ?? null,
      city: lead.city ?? null,
      industry: lead.industry ?? null,
      websiteUrl: lead.websiteUrl ?? null,
      contactEmail: lead.contactEmail ?? null,
      fitScore: lead.fitScore ?? null,
      websiteIssue: lead.websiteIssue ?? null,
      evidenceCount: lead.evidence.length,
      sourceUrl: lead.sourceUrl ?? lead.evidence[0]?.sourceUrl ?? null
    }));

  console.log(JSON.stringify({
    storePath,
    total: leads.length,
    byStatus,
    qualified
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to report leads");
  process.exitCode = 1;
}
