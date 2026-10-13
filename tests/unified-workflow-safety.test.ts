import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/unified-lead-research.yml", import.meta.url);
const workflow = (await readFile(workflowUrl, "utf8")).replace(/\r\n/g, "\n");

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
  assert.match(uploadStep, /retention-days: 90/);
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

test("unified lead research rejects unsafe or accidental discovery limits", () => {
  assert.match(workflow, /A non-empty search term is required/);
  assert.match(workflow, /DAILY_LEAD_LIMIT must be an integer from 1 to 100/);
});

test("paging and Draft-Ready-only creation come only from repository variables (unset = off)", () => {
  assert.match(workflow, /GULLKORNET_PLACES_MAX_PAGES: \$\{\{ vars\.GULLKORNET_PLACES_MAX_PAGES \}\}/);
  assert.match(workflow, /GULLKORNET_SYNC_CREATE_ONLY_DRAFT_READY: \$\{\{ vars\.GULLKORNET_SYNC_CREATE_ONLY_DRAFT_READY \}\}/);
  // Never hard-coded on, and the per-run limit stays at 100.
  assert.doesNotMatch(workflow, /GULLKORNET_PLACES_MAX_PAGES: ["']?[23]/);
  assert.doesNotMatch(workflow, /GULLKORNET_SYNC_CREATE_ONLY_DRAFT_READY: ["']?true/);
  assert.match(workflow, /DAILY_LEAD_LIMIT < 1 \|\| DAILY_LEAD_LIMIT > 100/);
});

test("unified workflow keeps CLI stdout and stderr private", () => {
  assert.match(workflow, /discover:google -- "\$SEARCH_TERM" > data\/google-candidates\.json 2> data\/discovery\.stderr\.log/);
  assert.match(workflow, /audit:websites -- data\/google-candidates\.json > data\/website-audit\.json 2> data\/website-audit\.stderr\.log/);
  assert.match(workflow, /research:contacts -- data\/google-candidates\.json data\/website-audit\.json > data\/contact-research-drafts\.json 2> data\/contact-research\.stderr\.log/);
  assert.match(workflow, /sync:airtable -- data\/contact-research-drafts\.json > data\/airtable-sync\.stdout\.log 2> data\/airtable-sync\.stderr\.log/);
  assert.match(workflow, /umask 077/);
  assert.match(workflow, /private diagnostics were not printed/);
  assert.doesNotMatch(workflow, /tee\s/);
});

test("aggregate run summary contains counts and control metadata only", () => {
  const summaryStep = workflow.match(
    /- name: Create aggregate-only run summary[\s\S]*?(?=\n      - name:|$)/
  )?.[0];
  assert.ok(summaryStep, "aggregate summary step must exist");
  assert.match(summaryStep, /candidates: candidates\.length/);
  assert.match(summaryStep, /websitesAudited: audits\.length/);
  assert.match(summaryStep, /recordsWithPublicEmail:/);
  assert.match(summaryStep, /recordsWithDraft:/);
  assert.match(summaryStep, /recordsRequiringHumanReview:/);
  assert.match(summaryStep, /emailSent: 0/);
  const summaryObject = summaryStep.match(/const summary = \{([\s\S]*?)\n          \};/)?.[1];
  assert.ok(summaryObject, "summary object must be explicit");
  assert.doesNotMatch(summaryObject, /(?:companyName|websiteUrl|sourceUrl|draftBody|subject|recipient|pageTitle|personalizationEvidence|emails)\s*:/);
  assert.doesNotMatch(summaryObject, /searchTerm\s*:/, "user-provided search text should not be persisted in the summary artifact");
});

test("every workflow shell stage uses a restrictive umask", () => {
  assert.equal((workflow.match(/umask 077/g) ?? []).length, 5);
});

test("scheduled lead pipeline is inert without its variable and cannot send", async () => {
  const scheduled = (await readFile(new URL("../.github/workflows/scheduled-lead-pipeline.yml", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(scheduled, /GULLKORNET_ENABLE_SCHEDULED_PIPELINE/);
  assert.match(scheduled, /if: \$\{\{ needs\.plan\.outputs\.enabled == 'true' \}\}/);
  assert.match(scheduled, /sync_to_airtable: \$\{\{ vars\.GULLKORNET_SCHEDULED_AIRTABLE_SYNC == 'true' \}\}/);
  assert.match(scheduled, /uses: \.\/\.github\/workflows\/unified-lead-research\.yml/);
  assert.doesNotMatch(scheduled, /RESEND|GULLKORNET_ENABLE_LIVE_SEND|send:(email|daily)|OPENOUTREACH/);
  assert.doesNotMatch(scheduled, /^  (push|pull_request):/m);
  assert.doesNotMatch(scheduled, /secrets: inherit/);
  assert.deepEqual([...new Set([...scheduled.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort(), ["AIRTABLE_API_TOKEN", "GOOGLE_MAPS_API_KEY"]);
  // The called workflow itself must never gain its own schedule.
  assert.doesNotMatch(workflow, /^  (schedule|push|pull_request):/m);
});
