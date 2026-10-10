import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function withDraft(run: (path: string, directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "gullkornet-phase11-"));
  const draftPath = join(directory, "drafts.json");
  writeFileSync(draftPath, JSON.stringify([{
    companyName: "Synthetic Acceptance",
    emails: [{ email: "pilot@example.no" }],
    subject: "Synthetic no-send acceptance",
    draftBody: "Synthetic test only. No real recipient."
  }]));
  try {
    run(draftPath, directory);
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
    assert.doesNotMatch(result.stdout + result.stderr, /pilot@example\\.no|Synthetic no-send acceptance|Synthetic test only/);
  });
});

test("production CLI defaults to dry-run and suppresses recipient and draft content from logs", () => {
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
    assert.match(result.stdout, /Dry run complete\\. No suppression list or provider credentials were accessed/);
    assert.match(result.stdout, /Recipient and draft content are suppressed/);
    assert.doesNotMatch(result.stdout + result.stderr, /pilot@example\\.no|Synthetic no-send acceptance|Synthetic test only/);
    assert.doesNotMatch(result.stdout + result.stderr, /Resend accepted one email/);
  });
});

test("explicit local preview file contains the draft while logs remain redacted", () => {
  withDraft((draftPath, directory) => {
    const previewPath = join(directory, "operator-preview.txt");
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/send-email.ts", draftPath, "pilot@example.no",
      "--preview-file", previewPath
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
    assert.match(readFileSync(previewPath, "utf8"), /pilot@example\\.no/);
    assert.match(readFileSync(previewPath, "utf8"), /Synthetic no-send acceptance/);
    assert.doesNotMatch(result.stdout + result.stderr, /pilot@example\\.no|Synthetic no-send acceptance|Synthetic test only/);
    if (process.platform !== "win32") {
      assert.equal(statSync(previewPath).mode & 0o777, 0o600);
    }
  });
});

test("preview file cannot overwrite an existing file and cannot be combined with live send", () => {
  withDraft((draftPath, directory) => {
    const previewPath = join(directory, "existing-preview.txt");
    writeFileSync(previewPath, "keep");
    const overwrite = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/send-email.ts", draftPath, "pilot@example.no",
      "--preview-file", previewPath
    ], { encoding: "utf8", timeout: 15000 });
    assert.equal(overwrite.status, 1);
    assert.equal(readFileSync(previewPath, "utf8"), "keep");

    const live = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/send-email.ts", draftPath, "pilot@example.no",
      "--preview-file", join(directory, "live-preview.txt"), "--send"
    ], { encoding: "utf8", timeout: 15000 });
    assert.notEqual(live.status, 0);
    assert.match(live.stderr, /available only in dry-run mode/);
  });
});

test("draft lookup failure does not expose the requested recipient in logs", () => {
  withDraft((draftPath) => {
    const requestedRecipient = "not-the-draft@example.no";
    const result = spawnSync(process.execPath, [
      "--import", "tsx", "src/cli/send-email.ts", draftPath, requestedRecipient
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
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected exactly one matching draft/);
    assert.doesNotMatch(result.stdout + result.stderr, /not-the-draft@example\\.no/);
  });
});

test("post-send Airtable failure never includes provider/CRM error details in the CLI", () => {
  const source = readFileSync("src/cli/send-email.ts", "utf8");
  assert.ok(source.includes("Do not echo provider/CRM error details"));
  assert.equal(source.includes("Detail: ${reason}"), false);
});
