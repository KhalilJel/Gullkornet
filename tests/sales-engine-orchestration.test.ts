import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistSalesEngineArtifacts } from "../src/integrations/sales-engine-orchestration.js";
import { writeJsonAtomically } from "../src/storage/json-artifacts.js";

test("writes JSON artifacts atomically with private permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gullkornet-artifact-"));
  try {
    const filePath = join(dir, "review.json");
    await writeJsonAtomically(filePath, { version: 1, records: ["old"] });
    await writeJsonAtomically(filePath, { version: 2, records: ["new", "complete"] });

    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    const metadata = await stat(filePath);
    assert.deepEqual(parsed, { version: 2, records: ["new", "complete"] });
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.deepEqual(await readdir(dir), ["review.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persists all artifacts before starting the idempotent CRM sync", async () => {
  const events: string[] = [];
  await persistSalesEngineArtifacts({
    reviewQueuePath: "data/review.json",
    reviewQueue: [],
    draftsPath: "data/drafts.json",
    drafts: [],
    rejectedPath: "data/rejected.json",
    rejected: []
  }, {
    writeJson: async (path) => { events.push("write:" + path); },
    syncReviewQueue: async (path) => { events.push("sync:" + path); }
  });

  assert.deepEqual(events, [
    "write:data/review.json",
    "write:data/drafts.json",
    "write:data/rejected.json",
    "sync:data/drafts.json"
  ]);
});

test("partial artifact persistence failure prevents CRM sync and propagates", async () => {
  const events: string[] = [];
  await assert.rejects(
    () => persistSalesEngineArtifacts({
      reviewQueuePath: "data/review.json",
      reviewQueue: [],
      draftsPath: "data/drafts.json",
      drafts: [],
      rejectedPath: "data/rejected.json",
      rejected: []
    }, {
      writeJson: async (path) => {
        events.push("write:" + path);
        if (path === "data/drafts.json") throw new Error("DISK_WRITE_FAILED");
      },
      syncReviewQueue: async () => { events.push("sync"); }
    }),
    /DISK_WRITE_FAILED/
  );

  assert.deepEqual(events, ["write:data/review.json", "write:data/drafts.json"]);
  assert.ok(!events.includes("sync"));
});
