# Phase 10 — End-to-end testing

Status: IN PROGRESS
Last updated: 2026-10-09

## Objective

Prove safe behavior across discovery, enrichment, verification, suppression, research, human review, CRM persistence and the OpenOutSend ingest boundary.

Phase 10 does not enable production sending.

## Safety boundaries

- No real prospect email is sent.
- OpenOutSend remains ingest-only for automated acceptance.
- Sending remains disabled.
- Runtime credentials remain outside Git.
- No DNS/MX changes.
- No new Railway service.

## Tests implemented

Added `tests/phase10-e2e.test.ts` covering:

1. Required orchestration order.
2. Suppression before research.
3. Provider failure fail-closed behavior.
4. Human-review outbound gate.
5. Duplicate discovery collapse.
6. Dry-run non-mutation.
7. Send-claim acknowledgement rejection.
8. Transport timeout handling.
9. Invalid batches blocked before network access.
10. Outbound handoff failure propagation.

Added `.github/workflows/phase10-end-to-end-testing.yml` covering typecheck, unit/safety tests, OpenOutSend health, unauthorized ingest rejection and a bounded live Gullkornet dry run.

## Acceptance evidence

### Automated suite

- Typecheck: PASS
- 98 tests: PASS
- OpenOutSend health: PASS
- Unauthorized ingest: HTTP 401 PASS

### Railway OpenOutSend boundary

Controlled synthetic acceptance:

- Deployment: SUCCESS
- accepted=1
- mode=ingest_only
- send_triggered=false
- Send endpoint not exposed
- Acceptance flag reset to false afterward
- Follow-up deployment: SUCCESS

### Bounded live Gullkornet dry run

Latest run:

- 30 discovered
- 25 deduplicated
- 2 researched
- 2 human-review records
- 0 eligible OpenOutSend records
- 0 emails sent
- Airtable sync: 1 updated, 1 skipped

The first Phase 10 workflow exposed a test-harness assertion mismatch. The assertion was corrected from a nonexistent `dryRun` output field to the actual `mode: dry-run` field. Runtime behavior was correct.

## Final gates

1. Corrected Phase 10 workflow passes.
2. TypeScript CI passes on the final Phase 10 head.
3. KeeLead Live Acceptance passes on the final Phase 10 head.
4. Final documentation is committed and verified.
5. Only then mark Phase 10 COMPLETE.

Phase 11 Production remains locked until this signoff.
