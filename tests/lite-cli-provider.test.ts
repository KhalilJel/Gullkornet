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

test("Lite scheduled runs remain harmless no-ops while live is off", () => {
  const result = run("false");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /kill switch is off/);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK/);
});

test("Lite live flag cannot bypass provider refusal, even before invalid config is read", () => {
  const result = run("true");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Resend requires opt-in and prohibits cold outreach/);
  assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_NETWORK|must be an integer|is required/);
});

test("technical preview stays available and explicitly distinguishes readiness from permission", () => {
  const result = run("true", ["--preview", "--limit", "5"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Technical preview only/);
  assert.match(result.stderr, /RESEND_DAILY_QUOTA/);
  assert.doesNotMatch(result.stdout + result.stderr, /Lite live sending is blocked|UNEXPECTED_NETWORK/);
});
