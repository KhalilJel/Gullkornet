import type { LiteSendDeps, LiteQueueRecord } from "./send.js";
import type { LiteSendConfig } from "./schedule.js";
import type { PreparedEmail, SendLedgerEntry } from "../integrations/outbound-email.js";
import type { WebsiteAudit } from "../integrations/website-audit.js";
import { buildSegmentResearch, liteSegment, type SegmentResearch } from "./market-research.js";

// Five synthetic leads on the reserved .example TLD (RFC 2606). Never real recipients.
export const DRY_RUN_RECORDS: LiteQueueRecord[] = [
  { id: "recLiteDry00001", fields: { Email: "post@frisor-a.example", Website: "https://frisor-a.example", "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] source=brreg orgnr=900000001 orgform=AS nace=96.021 kommune=0301" } },
  { id: "recLiteDry00002", fields: { Email: "kontakt@ror-b.example", Website: "https://ror-b.example", "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] source=brreg orgnr=900000002 orgform=AS nace=96.021 kommune=0301" } },
  { id: "recLiteDry00003", fields: { Email: "info@svart-c.example", Website: "https://svart-c.example", "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] source=brreg orgnr=900000003 orgform=AS nace=96.021 kommune=0301" } },
  { id: "recLiteDry00004", fields: { Email: "post@enk-d.example", "Lead Status": "Lite Ready", "Research Notes": "[GK-LITE] source=brreg orgnr=900000004 orgform=ENK nace=96.021 kommune=0301" } },
  { id: "recLiteDry00005", fields: { Email: "post@dnc-e.example", "Lead Status": "Lite Ready", "Do Not Contact": true, "Research Notes": "[GK-LITE] source=brreg orgnr=900000005 orgform=AS nace=96.021 kommune=0301" } }
];

export const DRY_RUN_REPLIED = new Set(["info@svart-c.example"]);

export function dryRunConfig(): LiteSendConfig {
  return { startHour: 8, endHour: 20, dailyLimit: 100, hourlyLimit: 15, maxPerRun: 5, minSpacingMs: 60_000, resendDailyQuota: 100 };
}

/**
 * Synthetic research for the dry-run segment (hairdressers, Oslo og Akershus): ten .example sites,
 * researched the day before `nowMs`. For offline tests only; it is never written to research/.
 */
export function dryRunResearch(nowMs: number): SegmentResearch {
  const segment = liteSegment("96.021", "oslo-akershus")!;
  const units = Array.from({ length: 10 }, (_, i) => ({ organizationNumber: String(910000000 + i), companyName: `Salong ${i} AS`, industry: "Frisering" }));
  const audits: WebsiteAudit[] = units.map((unit, i) => ({
    companyName: unit.companyName, websiteUrl: `https://salong-${i}.example`, checkedAt: new Date(nowMs - 86_400_000).toISOString(),
    status: "AUDITED", httpStatus: 200, finalUrl: `https://salong-${i}.example/`,
    flags: i < 6 ? ["MISSING_META_DESCRIPTION", "NO_OBVIOUS_CONTACT_PATH", "NO_EMAIL_LINK_DETECTED"] : []
  }));
  return buildSegmentResearch(segment, units, audits, new Date(nowMs - 86_400_000));
}

/** In-memory dependencies: a fake clock, fake Resend and fake Airtable. Nothing leaves the process. */
export function dryRunDeps(startMs: number, records = DRY_RUN_RECORDS, replied = DRY_RUN_REPLIED, research: SegmentResearch[] = [dryRunResearch(startMs)]) {
  let clock = startMs;
  const ledger: SendLedgerEntry[] = [];
  const outbox: Array<{ email: PreparedEmail; key: string }> = [];
  const state = new Map(records.map(r => [r.id, { ...r, fields: { ...r.fields } }]));
  const deps: LiteSendDeps = {
    now: () => clock,
    sleep: async ms => { clock += ms; },
    fetchLedger: async () => [...ledger],
    fetchQueue: async () => [...state.values()].filter(r => r.fields["Lead Status"] === "Lite Ready" && r.fields["Do Not Contact"] !== true),
    lookupRecords: async email => {
      const domain = email.split("@")[1];
      return [...state.values()].filter(r => String(r.fields.Email ?? "").toLowerCase().endsWith("@" + domain));
    },
    assertNotReplied: async email => { if (replied.has(email)) throw new Error("Recipient has replied. Follow-up/outreach is blocked."); },
    findResearch: segment => research.find(r => r.segment.key === segment.key),
    send: async (email, key) => {
      outbox.push({ email, key });
      ledger.push({ created_at: new Date(clock).toISOString(), to: [email.to] });
      clock += 1000;
      return { id: `dry-${outbox.length}` };
    },
    markSent: async (id, notes) => { const r = state.get(id); if (r) { r.fields["Lead Status"] = "Sent"; r.fields["Research Notes"] = notes; } },
    markReady: async id => { const r = state.get(id); if (r) r.fields["Lead Status"] = "Lite Ready"; },
    log: () => undefined
  };
  return { deps, outbox, state, ledger, advance: (ms: number) => { clock += ms; } };
}
