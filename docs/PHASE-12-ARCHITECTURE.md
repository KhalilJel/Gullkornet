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
