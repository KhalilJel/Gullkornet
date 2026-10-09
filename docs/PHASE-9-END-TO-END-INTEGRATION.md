# Phase 9 — End-to-end integration

Status: IN PROGRESS
Last updated: 2026-10-09

## Objective

Connect discovery, enrichment, website intelligence, qualification and the OpenOutreach boundary into one observable, testable pipeline. Phase 9 does not enable unattended bulk sending.

## Existing integration surfaces

- KeeLead HTTP client: `src/integrations/keelead.ts`
- Website/digital-presence research: `src/integrations/digital-presence.ts`
- Website audit and public URL safety checks: `src/integrations/website-audit.ts`
- OpenOutreach JSONL ingestion and explicitly gated send client: `src/integrations/openoutreach.ts`
- Existing tests: KeeLead, digital presence, website audit and OpenOutreach.

## Integration acceptance sequence

1. Discover leads through KeeLead.
2. Normalize and deduplicate candidates.
3. Enrich and verify contact data; reject records without a valid business identity or usable contact.
4. Research website/digital presence using the existing public-URL-safe intelligence path.
5. Score leads and retain evidence. Do not infer that a company lacks social profiles merely because links were not detected on its homepage.
6. Generate drafts only when there is grounded personalization evidence; otherwise mark for review.
7. Pass eligible leads to OpenOutreach as JSONL.
8. Preserve suppression, pacing, draft gate, mailbox/lead state and send authorization inside OpenOutSend.
9. Keep sending disabled in automated integration tests. Use Resend's official test recipient for transport acceptance only.
10. Verify replies through Migadu IMAP and record outcomes before follow-up evaluation.

## Safety and runtime boundaries

- No secrets in GitHub.
- No DNS/MX changes.
- No Resend receiving.
- No automatic bulk sending during Phase 9/10.
- Live sending remains explicitly gated and bounded.
- Provider/source results must be validated; KeeLead demo or placeholder sources cannot be treated as production intelligence.

## Phase 9 completion criteria

- A single orchestration entrypoint invokes the components in the order above.
- Unit tests cover successful flow, duplicate leads, missing/invalid contact, weak evidence, suppression and OpenOutreach failure.
- CI passes.
- Runtime acceptance proves the deployed service path is wired correctly without sending to real prospects.
- Record evidence and commit hashes here. Phase 9 is not complete until all criteria pass.


## Audit update — 2026-10-09

### Step 1: existing component and runtime audit

- The TypeScript CI workflow runs `npm run typecheck` and `npm test`.
- KeeLead client adapter exists at `src/integrations/keelead.ts`; the deployed service is reachable at `https://keelead-production-9f05.up.railway.app`. Its upstream source repository is not available through the connected GitHub integration, and placeholder sources remain a qualification risk.
- Website audit, digital-presence research, contact research, Firecrawl, Browser Use and OpenOutreach command adapters exist. They are not yet composed into one production runtime pipeline.
- The existing `OpenOutreachClient` executes a local `openoutreach` command. It is not an HTTP client for the deployed Railway service.
- Railway inspection confirms the deployed `openoutreach` service currently has no public or private service domain configured and starts with `outsend check` under `restartPolicyType=NEVER`. It is therefore a one-shot check process, not an ingestion API or continuously running worker. The TypeScript process cannot safely ingest into it using the current local-command adapter.
- PR #66 (OpenOutSend runtime/Resend transport) remains open as a draft and is not merged into `main`. The currently deployed OpenOutSend service is pinned to the `fix/openoutsend-pydantic-compat` branch. Its deployed state must not be confused with the repository's `main` state.
- PR #67 is the Phase 9 work branch. Earlier CI for its initial commit passed; CI for the latest hardened orchestration commit must be verified independently.

### Consequence / required integration boundary

Do not claim end-to-end integration or runtime acceptance until a supported, authenticated handoff exists between the Gullkornet orchestrator and OpenOutSend. The next implementation must choose and test a boundary that preserves OpenOutSend's existing draft gate, suppression, pacing, lead state and send authorization. Do not add a new Railway service merely to bypass repository access. No secrets in GitHub, no DNS/MX changes, and no real-prospect sends during Phase 9/10.

### Orchestration hardening

- Email syntax is validated before provider verification.
- Candidates are deduplicated by normalized email and normalized company identity.
- Suppression lookup failures fail closed.
- Weak/empty evidence, incomplete drafts, human-review-required results, and invalid scores are excluded from the queue.
- The orchestration default remains dry-run; its ingest callback is a queue boundary only and never sends email.


### Step 2 progress — queue handoff implementation

- Hardened `src/integrations/sales-engine.ts`: normalized email/company deduplication, email syntax checks, fail-closed verification and suppression errors, score/evidence/draft validation, and explicit `reviewRequired` results.
- Added `src/integrations/openoutsend-ingest.ts`, an HTTP client that can only submit bounded NDJSON to the ingest endpoint. It has no send method and verifies the remote acknowledgement says `send_triggered: false`.
- Added tests for authorization headers, NDJSON format, missing runtime configuration, invalid batches, HTTP errors and unexpected acknowledgements.
- Added the separate draft PR #68, `feat: Phase 9 authenticated OpenOutSend ingest bridge`, based on the Phase 8 runtime branch. It adds a bearer-authenticated, ingest-only HTTP bridge to the existing OpenOutSend container and tests the handler inside the Docker build. It has not been deployed.
- CI on the latest Phase 9 orchestration commit passed TypeScript typecheck and unit tests; the current commit's complete workflow status must be confirmed after all checks finish.
- The bridge's Python CI run is pending at the time of this update. Do not treat it as passed until its workflow reports success.

### Remaining before runtime acceptance

1. Verify PR #68 Python tests and image build.
2. Review the KeeLead response parsing and compose the actual runtime dependencies.
3. Add an Airtable-backed suppression lookup that fails closed.
4. Connect eligible lead records to the new ingest-only client using stable `lead_id` values.
5. Configure the existing OpenOutSend service for the authenticated endpoint and a private Railway address only after tests pass. Keep sending disabled.
6. Run a no-send runtime acceptance test and record deployment/commit evidence.


### Runtime composition added

- Added `src/integrations/sales-engine-runtime.ts` to compose KeeLead discovery/enrichment/verification, public website audit/contact research, Airtable suppression checks, and the ingest-only OpenOutSend client.
- The runtime adapter defaults to the currently deployed KeeLead API URL but allows `KEELEAD_API_URL` override.
- Airtable suppression lookup is paginated, cached per run, and fails closed when configuration or API access is unavailable.
- Email verification accepts only an explicit valid/deliverable result and rejects disposable addresses.
- Added `npm run sales-engine` as a dry-run-by-default entrypoint. It writes a local, permission-restricted review queue under the ignored `data/` directory and prints counts only, not email addresses or draft text.
- The contact research adapter intentionally marks findings for human review. As a result, those findings are not handed to OpenOutSend automatically. This is deliberate until a review/approval step is implemented and verified.
- The latest TypeScript CI and KeeLead live acceptance workflows are running for the newest CLI commit; record final status only after the checks settle.


### Step 2 progress — CRM persistence and checks

- The `npm run sales-engine` CLI now maps human-review findings into the existing Airtable sync format and calls `sync-airtable-leads.ts`. Records are marked `Needs Review` through the existing `MANUAL REVIEW:` status rule; no email is sent.
- The local review JSON files are under ignored `data/` and created with owner-only permissions. Logs include counts only, not contact emails or draft content.
- TypeScript CI passed on commit `fd0366ebc181c8a69ebf7c8f45bbdb06a96c7ad8` (typecheck and unit tests).
- KeeLead live acceptance was passing on the previous functionally equivalent commit and is running again for the latest commit.
- PR #68's Python unit tests and Docker image build both passed. The API bridge remains a draft and is not deployed.
- No live prospect outreach has been run through the new pipeline. Phase 9 remains IN PROGRESS until the authenticated bridge is configured in the existing Railway service and a no-send runtime acceptance passes.


### Verified CI checkpoint — 2026-10-09 09:xx Europe/Oslo

- TypeScript CI and KeeLead Live Acceptance passed for Phase 9 orchestration commit `66da0cba614a0222a77bfc9c1ae46c0083cbf717`.
- OpenOutSend ingest API workflow passed Python unit tests and Docker build for bridge commit `048a6c955af11066a9438d039c08127fada95e6e`.
- Links: [Phase 9 CI](https://github.com/KhalilJel/Gullkornet/actions/runs/37888723577), [KeeLead acceptance](https://github.com/KhalilJel/Gullkornet/actions/runs/37888723636), [ingest bridge tests/build](https://github.com/KhalilJel/Gullkornet/actions/runs/37888603594).
- The ingest bridge remains a draft PR and is not deployed. The existing Railway `openoutreach` service is still configured with start command `outsend check`, restart policy `NEVER`, and no service domain. No runtime endpoint is reachable yet.
- Runtime composition deliberately marks research results for human review, so it will not send these records to the ingest queue automatically. This gate must remain until an explicit review/approval flow is tested.
- Next: prepare the existing service's private-only ingest runtime and a shared bearer token, then deploy only after explicit confirmation. Configure Gullkornet to use the private Railway address. Verify `/health`, authenticated ingest with a synthetic test record, Airtable review persistence, and that no email was sent. No public domain, DNS/MX changes, or real-prospect sends.
