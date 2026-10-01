import test from "node:test";
import assert from "node:assert/strict";
import type { Lead } from "../src/domain/lead.js";
import { importLeadRecords } from "../src/domain/intake.js";
import type { LeadStore } from "../src/storage/lead-store.js";

class MemoryLeadStore implements LeadStore {
  constructor(private leads: Lead[] = []) {}
  async list(): Promise<Lead[]> {
    return structuredClone(this.leads);
  }
  async saveAll(leads: Lead[]): Promise<void> {
    this.leads = structuredClone(leads);
  }
  get value(): Lead[] {
    return structuredClone(this.leads);
  }
}

const qualifiedRecord = {
  companyName: "Eksempel Regnskap AS",
  websiteUrl: "https://example.no",
  contactEmail: "post@example.no",
  city: "Oslo",
  industry: "Regnskapsbyrå",
  websiteIssue: "WEAK_CONTACT_PATH",
  opportunity: "Make the enquiry route easier to find",
  sourceUrl: "https://example.no",
  evidence: [{
    sourceUrl: "https://example.no",
    observation: "The homepage has no clearly visible contact or enquiry action."
  }]
};

test("imports and qualifies valid lead records", async () => {
  const store = new MemoryLeadStore();
  const summary = await importLeadRecords([qualifiedRecord], store, new Date("2026-10-01T10:00:00.000Z"));

  assert.equal(summary.imported, 1);
  assert.equal(summary.qualified, 1);
  assert.equal(summary.rejected, 0);
  assert.equal(store.value[0]?.status, "QUALIFIED");
  assert.equal(store.value[0]?.fitScore, 100);
});

test("rejects malformed records without saving them", async () => {
  const store = new MemoryLeadStore();
  const summary = await importLeadRecords([{ companyName: "X", contactEmail: "not-an-email" }], store);

  assert.equal(summary.imported, 0);
  assert.equal(summary.rejected, 1);
  assert.equal(store.value.length, 0);
});

test("does not import a lead twice when its domain already exists", async () => {
  const existing: Lead = {
    id: "existing",
    companyName: "Existing Regnskap AS",
    websiteUrl: "https://www.example.no",
    contactEmail: "old@example.no",
    city: "Oslo",
    industry: "Regnskapsbyrå",
    websiteIssue: "WEAK_CONTACT_PATH",
    status: "CONTACTED",
    evidence: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z"
  };
  const store = new MemoryLeadStore([existing]);
  const summary = await importLeadRecords([qualifiedRecord], store);

  assert.equal(summary.imported, 0);
  assert.equal(summary.duplicates, 1);
  assert.equal(store.value.length, 1);
  assert.equal(store.value[0]?.status, "CONTACTED");
});

test("rejects unknown fields instead of silently accepting mistakes", async () => {
  const store = new MemoryLeadStore();
  const summary = await importLeadRecords([{ ...qualifiedRecord, guessedRevenue: 1000000 }], store);

  assert.equal(summary.rejected, 1);
  assert.equal(store.value.length, 0);
});
