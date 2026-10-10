import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/unified-lead-research.yml", import.meta.url);
const workflow = await readFile(workflowUrl, "utf8");

test("unified lead research is manual-only and cannot activate a sender", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (schedule|push|pull_request):/m);
  assert.doesNotMatch(workflow, /npm run --silent send:(email|daily)/);
  assert.doesNotMatch(workflow, /RESEND_API_KEY|GULLKORNET_ENABLE_LIVE_SEND/);
  assert.match(workflow, /sync_to_airtable:[\s\S]*?default: false/);
  assert.match(workflow, /if: \$\{\{ inputs\.sync_to_airtable \}\}/);
});

test("unified lead research uploads only the aggregate summary", () => {
  const uploadStep = workflow.match(
    /- name: Upload aggregate-only summary[\s\S]*?(?=\n      - name:|$)/
  )?.[0];
  assert.ok(uploadStep, "aggregate summary upload step must exist");
  assert.match(uploadStep, /path: data\/unified-lead-research-summary\.json/);
  assert.match(uploadStep, /retention-days: 7/);
  assert.doesNotMatch(uploadStep, /google-candidates|website-audit|contact-research-drafts|lead-review-queue/);
});

test("raw intermediate data stays in runner-local files with restrictive permissions", () => {
  assert.match(workflow, /chmod 700 data/);
  assert.match(workflow, /chmod 600 data\/google-candidates\.json/);
  assert.match(workflow, /chmod 600 data\/website-audit\.json/);
  assert.match(workflow, /chmod 600 data\/contact-research-drafts\.json/);
  assert.match(workflow, /mode: 0o600/);
  assert.match(workflow, /emailSent: 0/);
});
