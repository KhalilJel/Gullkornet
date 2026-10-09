import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function withDraft(run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "gullkornet-phase11-"));
  const draftPath = join(directory, "drafts.json");
  writeFileSync(draftPath, JSON.stringify([{
    companyName: "Synthetic Acceptance",
    emails: [{ email: "pilot@example.no" }],
    subject: "Synthetic no-send acceptance",
    draftBody: "Synthetic test only. No real recipient."
  }]));
  try {
    run(draftPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("production CLI kill switch stops before suppression, CRM, or provider access", () => {
  withDraft((draftPath) => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/send-email.ts", draftPath, "pilot@example.no", "--send"
    ], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        GULLKORNET_ENABLE_LIVE_SEND: "false",
        AIRTABLE_API_TOKEN: "",
        RESEND_API_KEY: "",
        OPENOUTREACH_INGEST_TOKEN: "",
        OPENOUTREACH_REPLY_STATUS_URL: ""
      }
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Production kill switch is active/);
    assert.doesNotMatch(result.stderr, /Airtable approval check|Resend send history|reply-status/);
    assert.doesNotMatch(result.stdout, /Resend accepted one email/);
  });
});

test("production CLI defaults to dry-run without opening provider or CRM connections", () => {
  withDraft((draftPath) => {
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/send-email.ts", draftPath, "pilot@example.no"
    ], {
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        GULLKORNET_ENABLE_LIVE_SEND: "false",
        AIRTABLE_API_TOKEN: "",
        RESEND_API_KEY: "",
        OPENOUTREACH_INGEST_TOKEN: "",
        OPENOUTREACH_REPLY_STATUS_URL: ""
      }
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /DRY RUN — nothing sent/);
    assert.match(result.stdout, /Dry run complete\. No suppression list or provider credentials were accessed/);
    assert.doesNotMatch(result.stdout + result.stderr, /Resend accepted one email/);
  });
});
