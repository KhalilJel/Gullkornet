import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonLeadStore } from "../src/storage/lead-store.js";
import type { Lead } from "../src/domain/lead.js";

const sampleLead: Lead = {
  id: "storage-test",
  companyName: "Test Regnskap AS",
  city: "Oslo",
  industry: "Regnskapsbyrå",
  status: "NEW",
  evidence: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z"
};

test("returns an empty list when the local store does not exist", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gullkornet-store-"));
  try {
    const store = new JsonLeadStore(join(directory, "nested", "leads.json"));
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists leads and reads them back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gullkornet-store-"));
  try {
    const store = new JsonLeadStore(join(directory, "nested", "leads.json"));
    await store.saveAll([sampleLead]);
    assert.deepEqual(await store.list(), [sampleLead]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
