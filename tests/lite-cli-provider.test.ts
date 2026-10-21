import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function run(live: string, args: string[] = []) {
  return spawnSync(process.execPath, [
    "--import", "tsx",
    "--import", "data:text/javascript,globalThis.fetch=()=>{process.stderr.write('UNEXPECTED_NETWORK');process.exit(99)}",
    "src/cli/send-lite.ts", ...args
  ], {
    encoding: "utf8", timeout: 15000,
    env: { ...process.env, GULLKORNET_LITE_ENABLE_LIVE_SEND: live,
      RESEND_DAILY_QUOTA: "invalid", RESEND_API_KEY: "", AIRTABLE_API_TOKEN: "" }
  });
}

test("there is no live switch any more: an invalid configuration still fails before any network or CRM access", () => {
  const result = run("false");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /kill switch/);
  assert.match(result.stderr, /RESEND_DAILY_QUOTA/);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK/);
});

test("exact pilot selection cannot be used in live mode or truncated silently", () => {
  for (const args of [["--preview-record-ids", "recA"],
    ["--preview", "--preview-record-ids", "recA,recB", "--limit", "1"]]) {
    const result = run("true", args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /read-only|cover every selected/);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK/);
  }
});

test("live pilot rejects invalid capacity before any network or CRM access", () => {
  const result = run("true");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /RESEND_DAILY_QUOTA/);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK/);
});

test("technical preview stays available and explicitly distinguishes readiness from permission", () => {
  const result = run("true", ["--preview", "--limit", "5"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Technical preview only/);
  assert.match(result.stderr, /RESEND_DAILY_QUOTA/);
  assert.doesNotMatch(result.stdout + result.stderr, /Lite live sending is blocked|UNEXPECTED_NETWORK/);
});
