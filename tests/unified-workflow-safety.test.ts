import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("manual inputs for paging and Draft-Ready-only creation default to off; the scheduler path keeps the variables", () => {
  const dispatch = workflow.match(/workflow_dispatch:\n    inputs:([\s\S]*?)\n  workflow_call:/)?.[1] ?? "";
  assert.match(dispatch, /places_max_pages:[\s\S]*?default: "1"[\s\S]*?type: choice[\s\S]*?options: \["1", "2", "3"\]/);
  assert.match(dispatch, /create_only_draft_ready:[\s\S]*?default: false[\s\S]*?type: boolean/);
  assert.match(dispatch, /sync_to_airtable:[\s\S]*?default: false/);
  // Manual-only: the reusable (scheduler) interface does not gain these inputs.
  const call = workflow.match(/workflow_call:\n    inputs:([\s\S]*?)\n    secrets:/)?.[1] ?? "";
  assert.doesNotMatch(call, /places_max_pages|create_only_draft_ready/);
  assert.match(workflow, /PLACES_MAX_PAGES_VAR: \$\{\{ vars\.GULLKORNET_PLACES_MAX_PAGES \}\}/);
  assert.match(workflow, /CREATE_ONLY_DRAFT_READY_VAR: \$\{\{ vars\.GULLKORNET_SYNC_CREATE_ONLY_DRAFT_READY \}\}/);
  // Never hard-coded on; neither input can turn on the Airtable sync step or live send.
  assert.doesNotMatch(workflow, /GULLKORNET_PLACES_MAX_PAGES: ["']?[23]/);
  assert.doesNotMatch(workflow, /GULLKORNET_SYNC_CREATE_ONLY_DRAFT_READY: ["']?true/);
  assert.match(workflow, /if: \$\{\{ inputs\.sync_to_airtable \}\}/);
  assert.doesNotMatch(workflow, /GULLKORNET_ENABLE_LIVE_SEND/);
  assert.match(workflow, /DAILY_LEAD_LIMIT < 1 \|\| DAILY_LEAD_LIMIT > 100/);
});

// Runs the real selection/validation shell from the workflow with a stubbed environment.
function runSelection(snippet: string, env: Record<string, string>, varName: string): { status: number | null; value: string } {
  const result = spawnSync("bash", ["-c", `set -euo pipefail\n${snippet}\necho "VALUE=\${${varName}:-}"`], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
  return { status: result.status, value: /VALUE=(.*)/.exec(result.stdout ?? "")?.[1] ?? "" };
}
const hasBash = spawnSync("bash", ["-c", "true"]).status === 0;

test("places_max_pages: input wins and is validated; without input the variable is used", { skip: !hasBash && "bash not available" }, () => {
  const snippet = workflow.match(/( {10}if \[ -n "\$\{PLACES_MAX_PAGES_INPUT:-\}" \]; then[\s\S]*?\n {10}fi\n)/)?.[1] ?? "";
  assert.ok(snippet, "selection block must exist");
  assert.deepEqual(runSelection(snippet, { PLACES_MAX_PAGES_INPUT: "2", PLACES_MAX_PAGES_VAR: "3" }, "GULLKORNET_PLACES_MAX_PAGES"), { status: 0, value: "2" });
  assert.deepEqual(runSelection(snippet, { PLACES_MAX_PAGES_INPUT: "", PLACES_MAX_PAGES_VAR: "" }, "GULLKORNET_PLACES_MAX_PAGES"), { status: 0, value: "" });
  assert.deepEqual(runSelection(snippet, { PLACES_MAX_PAGES_VAR: "3" }, "GULLKORNET_PLACES_MAX_PAGES"), { status: 0, value: "3" });
  for (const bad of ["0", "4", "10", "2; echo x", "abc"]) {
    assert.equal(runSelection(snippet, { PLACES_MAX_PAGES_INPUT: bad }, "GULLKORNET_PLACES_MAX_PAGES").status, 1, bad);
  }
});

test("create_only_draft_ready: input wins and is validated; without input the variable is used", { skip: !hasBash && "bash not available" }, () => {
  const snippet = workflow.match(/( *case "\$\{CREATE_ONLY_DRAFT_READY_INPUT:-\}" in[\s\S]*?\n *esac\n)/)?.[1] ?? "";
  assert.ok(snippet, "selection block must exist");
  const name = "GULLKORNET_SYNC_CREATE_ONLY_DRAFT_READY";
  assert.deepEqual(runSelection(snippet, { CREATE_ONLY_DRAFT_READY_INPUT: "true", CREATE_ONLY_DRAFT_READY_VAR: "" }, name), { status: 0, value: "true" });
  assert.deepEqual(runSelection(snippet, { CREATE_ONLY_DRAFT_READY_INPUT: "false", CREATE_ONLY_DRAFT_READY_VAR: "true" }, name), { status: 0, value: "false" });
  assert.deepEqual(runSelection(snippet, { CREATE_ONLY_DRAFT_READY_VAR: "true" }, name), { status: 0, value: "true" });
  assert.deepEqual(runSelection(snippet, {}, name), { status: 0, value: "" });
  assert.equal(runSelection(snippet, { CREATE_ONLY_DRAFT_READY_INPUT: "yes" }, name).status, 1);
});

test("run log reports discovery and sync as counts only", () => {
  const discovery = workflow.match(/- name: Discover candidates[\s\S]*?(?=\n      - name:)/)?.[0] ?? "";
  assert.match(discovery, /DISCOVERY_STATS_PATH: data\/discovery-stats\.json/);
  assert.match(discovery, /placesRequests: stats\.placesRequests/);
  const sync = workflow.match(/- name: Sync researched drafts[\s\S]*?(?=\n      - name:)/)?.[0] ?? "";
  const printed = sync.match(/console\.log\(JSON\.stringify\(\{([\s\S]*?)\}\)\)/)?.[1] ?? "";
  for (const field of ["created", "updated", "skipped", "notCreated", "createOnlyDraftReady", "duplicateEmail"]) assert.match(printed, new RegExp(`${field}:`));
  // duplicateEmail is forced to a plain number, so nothing but a count can reach the log.
  assert.match(printed, /duplicateEmail: Number\(result\.duplicateEmail\) \|\| 0/);
  // Exactly these keys and nothing else.
  assert.deepEqual([...printed.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]), ["stage", "createOnlyDraftReady", "created", "updated", "skipped", "notCreated", "duplicateEmail"]);
  assert.doesNotMatch(printed, /baseId|tableName|records|\bEmail\b|Company|draftBody|subject|\bemails\b/);
  assert.match(sync, /sync:airtable -- data\/contact-research-drafts\.json > data\/airtable-sync\.stdout\.log/);
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
