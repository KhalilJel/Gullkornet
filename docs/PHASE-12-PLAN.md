# Phase 12 — Autonomous Cidea AI Sales Engine

Last updated: 2026-10-09  
Repository: `KhalilJel/Gullkornet`  
Authorized: 2026-10-09 by the repository owner in the active ChatGPT session  
Base commit: `9e23236212ae23f67a52fefe3be35d96509edb0e`

## Goal

Complete a reliable, evidence-backed Cidea sales workflow that discovers prospects, enriches and researches them, prioritizes genuine opportunities, creates concise outreach drafts, records all work in the existing review/CRM path, and handles replies and failures safely. Phase 12 does not itself authorize production email sending.

## Non-negotiable controls

- Work only in `KhalilJel/Gullkornet`.
- Follow the order: implement → test/verify → document → commit → verify → next step.
- No DNS or MX changes.
- No secrets in GitHub, logs, documentation, screenshots, or chat.
- No real prospect emails during Phase 12 development, testing, or acceptance.
- Do not enable bulk sending or scheduled batch sending.
- Do not bypass OpenOutSend's authenticated ingest-only boundary or any suppression, reply, approval, duplicate, or pacing checks.
- Do not change Railway configuration, switch service branches, or trigger deployments as a documentation convenience.
- Reuse existing services in Railway project `powerful-patience`; do not create additional services unless a concrete requirement is demonstrated and approved.
- Fail closed if a safety check, suppression lookup, source verification, or persistence operation fails.

## Step 1 — Baseline, safety and architecture verification

Status: **BASELINE VERIFIED; runtime variable values remain connector-redacted**.

### GitHub baseline

- Repository identity verified as `KhalilJel/Gullkornet`.
- Default branch: `main`.
- Main SHA: `9e23236212ae23f67a52fefe3be35d96509edb0e`.
- Phase 11 is marked complete in `docs/AI-IMPLEMENTATION-STATUS.md` and `docs/PHASE-11-PRODUCTION.md`.

### Railway baseline

- Project: `powerful-patience`.
- Environment: `production`.
- Environment inventory: 8 services, no staged changes.
- Latest environment health inspection: all 8 services online, 0 services with issues, 0 recent failed/crashed deployments, no pending work.
- `openoutreach`: 1/1 replicas running, deployment `71dad39b-f961-4e9f-9b3b-23d0a76b9d55` SUCCESS.
- Its configured source is `KhalilJel/Gullkornet`, branch `phase11/production`, commit `30358eb488072a7893d385ac83cc78226486f768`. Do not switch it to `main` or redeploy without a separate technical need and approval.
- Runtime logs at `2026-10-09T17:07:50Z` show `reply-monitor status=running error=none`.
- `OPENOUTREACH_ALLOW_SEND` and `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST` exist in the service environment. The Railway connector withholds their values; the operator previously confirmed both false in the Railway UI on 2026-10-09. Treat these as operator-confirmed, not connector-read values. Do not enable either flag.
- The workflow `.github/workflows/daily-outreach.yml` still hard-disables the send job with `if: ${{ false }}`.

### Existing implementation discovered

- `src/integrations/sales-engine.ts` already provides discovery → deduplication → enrichment → email verification → suppression → website/contact research → gated queue ingestion.
- `src/integrations/sales-engine-runtime.ts` adapts KeeLead, Airtable suppression, website audit/contact research, and OpenOutSend ingest.
- `src/cli/run-sales-engine.ts` defaults to dry-run, persists review artifacts and Airtable review records, and reports `emailSent: 0`.
- Research currently sets `requiresHumanReview: true` for every result. Consequently, the runtime should be treated as a review-queue generator, not a fully autonomous qualification or sending engine.
- `src/integrations/openoutsend-ingest.ts` only exposes lead ingestion and validates the response as `mode=ingest_only` with `send_triggered=false`; it has no sending method.
- Existing website audit and contact research use bounded public-URL fetching, but the results are heuristic signals and require evidence-aware qualification.
- The existing `phase9-sales-engine-acceptance.yml` is scoped to the legacy `phase9/end-to-end-orchestration` branch and runs in dry-run mode; acceptance must be made relevant to Phase 12 without introducing live sending.

### Step 1 exit criteria

- [x] Correct repository and main baseline verified.
- [x] Railway environment health and absence of pending changes verified.
- [x] Existing OpenOutreach deployment branch/commit documented.
- [x] Send job hard-disabled in GitHub workflow.
- [x] Safety variable names exist; operator's same-day false confirmation recorded, with connector redaction explicitly noted.
- [x] Existing code and architecture boundaries inspected.
- [x] No runtime configuration, DNS/MX, or email sending performed during this baseline inspection.

## Locked implementation sequence

Do not skip or reorder steps. Each step must pass its own tests and be documented before the next begins.

### Step 2 — Establish Phase 12 architecture and contracts
- Map current TypeScript adapters, KeeLead, Website Intelligence Engine, Hermes orchestration, Airtable review records, and OpenOutSend ingest-only boundary.
- Reuse the current Railway project and services; do not add a new service by default.
- Define typed contracts, evidence provenance, timeouts, error categories, and fail-closed behavior.
- Acceptance: architecture and data-flow notes match the code that actually exists.

### Step 3 — Reliable lead discovery and normalization
- Reuse KeeLead discovery and enrichment; validate and normalize company identity, website, geography, industry, and source.
- Deduplicate on stable business identity/domain and preserve existing CRM terminal states.
- Bound each run and avoid logging personal contact details.
- Acceptance: deterministic unit tests for malformed records, missing identity, duplicates, and configured limits.

### Step 4 — Evidence-backed Website Intelligence integration
- **Decision (owner approved 2026-10-09):** use Gullkornet's existing `src/integrations/website-audit.ts` as the Phase 12 website-intelligence provider. Do not edit the separate WIE repository or change Railway service configuration.
- The adapter remains separate from lead discovery and formats audit results into traceable evidence: requested/final URL when available, checked timestamp, HTTP status when available, HTTPS signal, title/description observations, audit status, and explicitly labeled automated flags.
- Automated signals are not verified claims. Weak evidence and all current contact-research results still require human review.
- Preserve public-URL/DNS safety checks, manual redirect validation, timeout, response-body cap, and concurrency limits in the existing audit implementation.
- Acceptance: unit tests verify provenance fields, explicit automated-signal labels, and omission of unavailable final URL/HTTP status; existing website audit tests cover basic signals and unsafe URLs. CI/typecheck/test suite must pass before step completion.

### Step 5 — Qualification and prioritization
- Separate raw candidates, researched candidates, qualified leads, and human-review-required records.
- Score only on explicit, explainable evidence and fit for Cidea's website/branding/digital-presence services.
- Do not treat an automated audit flag as proof of business harm or expected revenue gain.
- Acceptance: stable score explanations and tests for low evidence, wrong geography/industry, no opportunity, and uncertain identity.

### Step 6 — Personalization and draft quality
- Produce short Norwegian outreach drafts grounded in verified business facts and Cidea's approved interest-first tone.
- Keep website findings internal unless a human has verified them for customer-facing use.
- Do not invent a named contact, role, problem, or expected outcome.
- Acceptance: drafts cite internal source evidence, avoid unsupported claims, and route weak research to manual review.

### Step 7 — CRM and suppression correctness
- Ensure Airtable writes are idempotent and preserve `Sent`, `Replied`, `Suppressed`, and `Do Not Contact` states.
- Treat missing/unavailable suppression data as a hard stop.
- Preserve audit trail for source, research, score, draft, review decision, and status changes.
- Acceptance: tests for pagination, duplicate sync, terminal-state preservation, suppression, retries, and persistence failures.

### Step 8 — Orchestration and retry safety
- Orchestrate the validated adapters without parallel duplicate work or unbounded retries.
- Use timeouts and bounded retries; make partial progress restart-safe.
- Keep reply monitoring ahead of any follow-up evaluation.
- OpenOutSend remains ingest-only; do not add or call a send endpoint.
- Acceptance: deterministic tests for provider timeout, transient failure, repeated run, partial persistence, and reply/suppression blocks.

### Step 9 — Observability and operational recovery
- Add structured, privacy-safe outcome counts and correlation IDs without emails, draft bodies, API keys, or mailbox contents in logs.
- Define health and stale-monitor handling and actionable failure categories.
- Acceptance: test assertions for failure observability and ensure logs contain no secrets or prospect message content.

### Step 10 — Phase 12 end-to-end dry-run acceptance
- Run a bounded test against controlled/test inputs and existing providers only where safe.
- Verify discovery → enrichment → evidence research → qualification → draft → review queue/CRM persistence.
- Assert that no real prospect emails are sent and the ingest contract always reports `send_triggered=false`.
- Acceptance: automated workflow on the Phase 12 branch, all tests pass, artifacts are privacy-safe, and the sending workflow remains hard-disabled.

### Step 11 — Production-readiness review (no activation)
- Review code, dependency changes, access controls, data retention, costs, rate limits, suppression, replies, idempotency, and rollback/recovery.
- Verify current Railway state and flags where access permits; document any connector redaction.
- Do not switch service source branches or deploy without explicit, separate authorization.
- Acceptance: all release criteria documented; no live send performed.

### Step 12 — Phase 12 closeout
- Update implementation status, architecture docs, test evidence, limitations, and known follow-ups.
- Run and verify CI and the Phase 12 dry-run acceptance workflow on the final commit.
- Confirm all changes are committed and merged through a reviewed PR.
- Mark Phase 12 complete only if every preceding acceptance criterion passes.
- Production sending remains separately gated and is not implied by Phase 12 completion.

## Current execution status

- Phase 12 has been explicitly authorized on 2026-10-09.
- Step 1 baseline verification is complete.
- Step 2 architecture and contract mapping is complete in `docs/PHASE-12-ARCHITECTURE.md`.
- Step 3 implementation is complete: candidates are deduplicated by normalized website domain as well as company/email identity, and explicit non-HTTP schemes or credential-bearing website URLs are rejected.
- Step 3 tests were added for domain normalization/deduplication and unsafe URL normalization.
- Validation on code commit `a1953539bdc614ade7ab9f6da48cc3ac6e997360`: CI typecheck and test suite PASS; Phase 10 E2E PASS; Phase 11 Production Readiness PASS; KeeLead Live Acceptance PASS.
- Step 4 is implemented and merged via PR #76 (merge commit `4c4d4e0f3a04cada848cea8936c3f60d548d8965`). CI, Phase 10 E2E, Phase 11 readiness, and KeeLead acceptance passed on the PR head; the transient KeeLead timeout passed on retry. No Railway runtime/configuration changes or deployments were made.
- Step 5 is complete and merged via PR #77 (merge commit `2f7dd0d3233e796e0917949529e2614ebc6e3176`). Deterministic scoring includes explicit reasons, target-area/industry checks, opportunity-signal checks, and separate qualified/rejected/review-required outcomes. Score/reason/status are attached to research; rejected decisions are retained in `result.rejectedLeads` and persisted to `data/sales-engine-rejected.json` with restrictive file permissions. Review queue/CRM notes include qualification reasons. CI typecheck/tests, Phase 10 E2E including the bounded live dry-run non-sending assertion, Phase 11 readiness, and KeeLead Live Acceptance all passed on final PR head `c2a69cf315b5df737619b0e430403c464ce247db`. Step 6 is next.
- Step 6 is complete and merged via PR #79 (merge commit `bde2740bc7d6d87dac4f7eb9d3af85d46f20a638`). The approved Norwegian interest-first template remains generic; internal personalization evidence now carries observed page facts, source URL(s), and check time. Website observations are not inserted into customer-facing copy, and weak/no-website research stays in manual review. CI typecheck/tests, Phase 10 E2E including the non-sending assertion, Phase 11 readiness, and KeeLead Live Acceptance all passed on final PR head `c4d43516098f21c67f30f6caba5af4eafb4e1a08`. Step 7 is next.
- No prospect emails were sent during Phase 12 execution.
- No DNS/MX or Railway configuration changes were made.
