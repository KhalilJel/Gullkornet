# Phase 12 — Architecture and contracts

Last updated: 2026-10-09  
Repository: `KhalilJel/Gullkornet`  
Baseline: `9e23236212ae23f67a52fefe3be35d96509edb0e`

## Verified current data flow

```text
KeeLead discovery
  → parse/normalize candidates
  → deduplicate within the run
  → KeeLead enrichment
  → email-format validation + KeeLead deliverability verification
  → Airtable suppression check (fail closed)
  → website audit + public contact research
  → evidence/draft/score validation
  → human-review queue
  → Airtable review-record sync

Optional downstream boundary (only when a lead passes the current gate):
  → authenticated OpenOutSend JSONL ingest
  → ingest-only response assertion: mode=ingest_only, send_triggered=false
```

The workflow is run by `src/cli/run-sales-engine.ts`, with orchestration in `src/integrations/sales-engine.ts` and provider wiring in `src/integrations/sales-engine-runtime.ts`.

## Component ownership

| Component | Responsibility | Contract/boundary |
|---|---|---|
| Gullkornet sales engine | Coordinate discovery, deduplication, verification, suppression, research and review routing | TypeScript interfaces in `sales-engine.ts`; bounded `maxLeads` |
| KeeLead | Prospect discovery, enrichment and email verification | `KeeLeadClient`; provider failures are caught and counted |
| Website audit | Inspect public website metadata and bounded HTML signals | `auditCandidate`; public URL/DNS safety checks, timeout and body-size limits |
| Qualification | Score explicit opportunity evidence and service fit | `evaluateLeadQualification`; deterministic reasons, pilot-area and competitor checks; unknown identity/industry/geography routes to review |
| Contact research | Extract public business contact details and prepare the approved generic draft | `researchContactAndDraft`; output always requires human review |
| Airtable | Suppression source and durable review queue | `createAirtableSuppressionChecker` fails closed and can retry after a failed read; `syncAirtableReviewRecords` paginates and performs idempotent upserts while preserving protected records |
| OpenOutSend | Store accepted leads and maintain mailbox/outreach state | Authenticated ingest-only API; this client exposes no send method |
| Hermes / Railway | Existing runtime/orchestration infrastructure | Do not change runtime config or deploy as part of documentation/contract work |

The existing Railway project is `powerful-patience`. The `cidea-website-intelligence` service is online, but Railway configuration shows it is a one-shot CLI task (`npm run audit:website:intelligence -- https://cidealeads.com CideaLead`), has restart policy `NEVER`, and has no service domain. It is not currently a callable HTTP API. On 2026-10-09, the owner approved using Gullkornet's existing `src/integrations/website-audit.ts` as the Phase 12 provider. No endpoint was guessed, and the separate WIE repository/service was not modified. The in-repository adapter now includes audit provenance and clearly labels flags as automated signals requiring human verification.

## Important current behavior and limitations

1. `runSalesEngine` defaults to dry-run when no options are supplied.
2. `createPhase9SalesEngineDependencies` currently marks every website research result `requiresHumanReview: true`. This is a deliberate safety gate: the runtime creates review records rather than qualifying records for downstream ingest.
3. Qualification now produces a bounded, explainable score and explicit reasons from known website flags, configured pilot geography, identity confidence and industry. Automated flags are only signals for human review, never evidence of lost revenue, business harm, or likely conversion.
4. Website signals and extracted email addresses are not independent verification. Publicly listed addresses still require manual confirmation and legal/contact-policy review.
5. Outreach drafts use the approved generic Norwegian interest-first template. Internal personalization evidence records observed page facts, source URL(s), and check time; website findings are not copied into customer-facing draft text unless a human has verified them. All current drafts require human review.
6. The CLI writes local JSON artifacts with restrictive file mode, including `data/sales-engine-rejected.json` for explainable rejection decisions, and syncs review records to Airtable with qualification score/status/reasons in research notes. It logs counts rather than draft bodies or email addresses.
7. `src/integrations/openoutsend-ingest.ts` can only call `POST /v1/leads` with NDJSON. It asserts accepted count, `mode=ingest_only`, and `send_triggered=false`. Do not add a send method.
8. The daily outreach workflow's send job has a hard false condition. Keep it that way throughout Phase 12.
9. The existing Phase 9 acceptance workflow is scoped to the legacy `phase9/end-to-end-orchestration` branch. A dedicated Phase 12 dry-run acceptance workflow will be needed later; it must never send real email.
10. Airtable suppression reads fail closed for the current attempt. A failed cached read is cleared so a later attempt can retry. CRM sync retries transient GET failures only; create/update writes are not automatically retried.

## Target Phase 12 contracts

- **Candidate:** stable business identity, business name, official website if known, geography/industry, and provenance.
- **Website finding:** source URL, final URL, checked timestamp, observation, evidence excerpt or signal, and a clear distinction between automated signal and human-verified fact.
- **Qualification decision:** `evaluateLeadQualification` returns explicit score/reasons plus a state of qualified, review-required, rejected, or suppressed. Missing/uncertain evidence must not become a qualified lead. The runtime continues to require human review for its current research outputs.
- **Draft:** approved template, source-linked internal rationale, draft text, review state, and no implicit send authorization.
- **CRM operation:** idempotent upsert by duplicate key/domain/name, including legacy rows without a stored key; preserve terminal/suppression states and outreach history; fail closed when suppression or persistence cannot be checked. GET reads may retry transient failures. Writes are not blindly retried because an ambiguous create response could produce duplicates.
- **Outreach boundary:** ingest-only, authenticated, bounded, and incapable of sending from the Gullkornet adapter.
- **Observability:** outcome counts and safe correlation IDs; no secrets, mailbox contents, full email addresses, or full draft bodies in routine logs.

## Orchestration retry and restart-safety contract (Phase 12 Step 8)

- Lead processing remains sequential and bounded by the configured `maxLeads` limit; no parallel duplicate processing was introduced.
- Discovery, enrichment, contact verification, suppression reads, and research receive at most one retry, and only when the error clearly indicates a timeout/network failure or HTTP 408/425/429/5xx. Permanent errors fail without retry.
- OpenOutSend ingest and Airtable writes are not wrapped in automatic retry logic because a timeout can leave the write outcome ambiguous. The Airtable adapter's idempotent upsert and protected-record matching allow a later run to resume safely without blindly repeating an uncertain write.
- Suppression remains fail-closed: if the bounded attempt(s) fail, that lead is skipped. Reply-monitor ordering remains owned by the existing reply/follow-up runtime; this step does not add a sender or change Railway configuration.
- Deterministic tests cover transient retry, permanent failure without retry, ingest-write no-retry, suppression blocking/failure, and idempotent CRM resynchronization. All four Phase 12 PR checks passed on `5e26e72ab38aa2f47b91a926feeefd29f229fd53`.

## Failure behavior

- Discovery/enrichment/research timeout or invalid provider response: skip or route to review with a stable error category.
- Suppression lookup unavailable: stop processing that lead; do not assume it is unsuppressed.
- Unverifiable website/contact ownership or weak evidence: human review, not qualification.
- Airtable persistence failure: fail the run visibly and do not claim successful sync.
- OpenOutSend unexpected response or ingest error: fail closed; never retry by switching to a sending path.
- Any change to DNS/MX, Railway runtime config, deployment source branch, or live-send state is outside this phase's default permission boundary.

## Step 2 acceptance

- [x] Existing adapters and entry points identified from the repository.
- [x] Data flow and component ownership documented.
- [x] Existing review gate and ingest-only boundary recorded.
- [x] Railway service inspected: WIE is a one-shot CLI, not a callable API; no endpoint was guessed.
- [x] Owner-approved in-repository provider selected; evidence provenance formatter and tests added.
- [x] Gaps for Phase 12 qualification, evidence and acceptance are documented.

## Observability contract (Phase 12 Step 9)

The sales-engine CLI emits structured start, completion, and failure events from `src/integrations/sales-engine-observability.ts`.

- A per-run correlation ID connects the events; duration and safe aggregate counts are included.
- Failure categories are stable, bounded labels (including timeout, provider unavailable, configuration, persistence, validation, and unknown). Raw exception strings are not emitted by the failure event.
- Routine event payloads do not include prospect email addresses, draft bodies, mailbox contents, provider response bodies, or API keys.
- Completion explicitly reports zero sent email; this is an observability assertion, not permission to send.
- The test suite serializes events and checks for private prospect data, raw error text, and secret-like values.
- Operational limitation: the change does not provide centralized alerting, stale-monitor detection, or a new health endpoint. Existing Railway health/log monitoring and reply-monitor behavior are unchanged.

Step 9 was merged in PR #86 at `de8e5410038fe5b0866521dd9632dc38628441f7`; CI, Phase 10 E2E, Phase 11 readiness, and KeeLead live acceptance passed on the final PR head.


## Synthetic acceptance contract (Phase 12 Step 10)

`.github/workflows/phase12-e2e-acceptance.yml` runs typecheck and the deterministic in-repository test suite without configuring live provider credentials. The tests cover the controlled orchestration path and its suppression, review, persistence-adapter, and ingest-safety boundaries. The workflow also asserts that the scheduled send job remains hard-disabled and that the OpenOutSend adapter remains ingest-only.

The workflow emits only a privacy-safe step summary; it does not upload lead/draft artifacts, contact live providers, send email, or write real prospect records. This is deterministic test acceptance, not proof of live provider availability or authorization for production sending. Phase 10's existing separate acceptance workflow retains its existing bounded provider checks.


## Production-readiness findings (Phase 12 Step 11)

The read-only review is recorded in `docs/PHASE-12-PRODUCTION-READINESS.md`. Key findings:

- The production Railway environment was healthy during inspection, with no pending changes; OpenOutSend remains on the existing Phase 11 branch, ingest-only, and its reply monitor was reporting healthy status.
- Phase 10 CI previously uploaded raw prospect/research/draft JSON artifacts. PR #89 removes those files from artifact upload; the workflow continues to assert that local dry-run outputs exist.
- Production sending remains not approved. The repository has no dependency lockfile, no documented prospect-data retention schedule, and the single-send CLI prints recipient and draft content to stdout during preview. These are documented blockers/follow-ups before a live pilot or automated sender use.
- Current Railway safety-flag values were not read in this review; the latest operator-confirmed values are recorded in the Phase 11 document and must be reverified directly before any separately approved live send.
