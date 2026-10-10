# Access-Controlled Prospect Handoff Design

Status: **MANUAL-ONLY PROTOTYPE ADDED — AUTOMATED CUTOVER NOT APPROVED**  
Date: 2026-10-10  
Scope: Google Places discovery, website audit, contact research, draft preparation, and Airtable sync.

## Problem

The current workflow chain transfers candidate and audit records through GitHub Actions artifacts. The website-audit artifact is minimized and expires after 7 days, but it still contains prospect/business data and structured audit signals. Artifact expiry reduces exposure duration; it is not a substitute for access minimization or an operational deletion policy.

Airtable is already the persistent review CRM, but its current sync schema does not establish a dedicated, approved schema for audit handoff records. Do not assume new fields exist in the live base or write them without a separately reviewed migration.

## Decision: prefer one ephemeral processing workflow

The preferred target is a single discovery-to-review workflow that runs the following steps in one job:

1. Discover candidate businesses.
2. Write the minimal candidate input to a runner-local file.
3. Audit public websites.
4. Research public business contact channels and prepare drafts for human review.
5. Sync reviewed research records to the existing Airtable CRM when explicitly configured.
6. Upload only aggregate operational metadata (counts, timestamps, safe failure categories), with a 7-day expiry.

Candidate and audit JSON should remain in the ephemeral runner workspace and must not be uploaded as artifacts, included in job summaries, or printed to logs. Create temporary files with restrictive permissions where supported. Do not include recipient addresses, draft text, page excerpts, or full research rows in artifacts or logs.

This is preferred over a new persistent handoff service because it avoids introducing another database, credential, access-control surface, and deletion process. The existing Airtable CRM remains the persistent system of record for the human review process.

## Migration plan

### Phase A — inventory and preconditions

- Confirm all current workflow triggers, artifact names, manual-dispatch behavior, timeouts, and downstream consumers.
- Confirm the Airtable table/field schema without exposing values or changing live records.
- Keep the sender workflow hard-disabled. This migration must not enable sending or change send approval gates.
- Keep all current workflows intact until the replacement passes non-sending acceptance tests.

### Phase B — implement replacement workflow

- **Prototype added:** `.github/workflows/unified-lead-research.yml` composes discovery, audit, and contact research in a single manually triggered job using existing CLI commands.
- Use only runner-local intermediate files; do not upload raw intermediate JSON. The prototype sets restrictive permissions on its data directory and intermediate files, and redirects CLI stdout/stderr into runner-local files rather than exposing diagnostic text in Actions logs.
- Retain the existing Airtable sync as a human-review persistence step, with sending explicitly outside this workflow.
- Add tests or workflow checks that fail if raw candidate, audit, contact-research, or draft JSON is included in uploaded artifact paths, or if CLI stdout/stderr is printed to Actions logs.
- Upload only a metadata summary and keep its expiry at 7 days. The prototype does this.
- The prototype is `workflow_dispatch`-only; Airtable sync defaults to off and requires an explicit input to turn on. It has no sender credentials or send command.
- Do not alter DNS/MX, Railway, secrets, live sending, or production deployments.

### Phase C — acceptance and cutover

- Run CI, unit/privacy tests, Phase 10, Phase 11, Phase 12, and KeeLead acceptance on the PR branch.
- Verify the replacement creates expected local intermediates, completes the research/Airtable step in a non-sending test, and uploads only aggregate metadata.
- Verify no downstream workflow still requires the old candidate/audit artifacts.
- Only after passing checks, propose retiring the old artifact-transfer triggers in a separately reviewed commit. Do not merge without owner approval.

## Retention clock: separate follow-up

The current Airtable sync writes `Last Seen` each time a business is rediscovered/synced. That field must not be used as the retention clock.

Before building any deletion automation, define a separate `Last Meaningful Activity` rule and test its behavior for at least these cases:

- New candidate discovered or rediscovered without human interaction.
- Human review/status transition.
- Reply or opt-out/suppression.
- Active client engagement / contracted CIDEA Leads delivery.
- Terminal outcomes and records protected from contact.
- Missing, malformed, or contradictory timestamps.

Until the rule, legal/provider checks, and field availability are confirmed, retention work is read-only design only. No automatic deletion, anonymization, or status mutation is authorized.

## Risks and controls

| Risk | Control |
|---|---|
| Raw intermediate data leaks into workflow logs | Redirect CLI output to runner-local files; print counts only; test logs and artifact paths |
| A replacement breaks manual re-runs | Preserve explicit source inputs and document the supported manual entry point before retiring old workflows |
| Airtable schema differs from assumptions | Read-only schema/field verification before any schema-dependent implementation |
| Human-review state is overwritten | Reuse existing Airtable protection rules and test suppression/sent/replied/approved cases |
| A future change accidentally enables sending | Keep scheduled sender hard-disabled; add an explicit acceptance assertion that no send occurs |
| Retention removes records needed for suppression or active clients | No deletion until legal/provider checks and separately authorized retention implementation |

## Exit criteria

- No raw prospect or draft JSON is uploaded as a workflow artifact.
- No raw prospect/draft content appears in workflow logs or job summaries.
- Only aggregate metadata artifacts remain, with a 7-day expiry.
- Existing Airtable review-state protection tests pass.
- All five required acceptance workflows pass on the same PR head.
- Sender remains hard-disabled; no real emails, infrastructure changes, or deployment actions occur.

## Current status

This document records the target design and the first manual-only prototype. The existing scheduled workflow chain is unchanged; its website-audit artifact still contains minimized prospect data. The new workflow has not been manually run or end-to-end validated against live services. Static safety tests were added to enforce manual-only operation, no sender path, opt-in Airtable sync, restrictive local file permissions, private CLI stdout/stderr, and aggregate-only artifact upload. No live Airtable records were read or changed as part of this work, and no deletion or outreach was performed.
