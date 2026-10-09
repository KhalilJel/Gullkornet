# AI Layer Implementation Status

Last updated: 2026-10-08

## Rule

Follow the locked plan in order. Do not deviate before all phases are completed.

## Workflow for every phase

Implement → test/verify → document → commit → verify → next phase.

## Phase status

- [x] Phase 0 — Architecture and guardrails
- [x] Phase 1 — Hermes
- [x] Phase 2 — Agent Reach
- [x] Phase 3 — Firecrawl
- [x] Phase 4 — JEV Ultrafast foundation
- [x] Phase 5 — TypeSafe + JEV autonomous decision layer
- [x] Phase 6 — Browser Use
- [x] Phase 7 — KeeLead
- [ ] Phase 8 — OpenOutreach
- [ ] Phase 9 — End-to-end integration
- [ ] Phase 10 — End-to-end testing
- [ ] Phase 11 — Production
- [ ] Phase 12 — Autonomous Cidea AI Sales Engine

## Current phase

Phase 8 — OpenOutreach is the active phase.

## Current architecture boundary

Website Intelligence Engine is a dedicated website intelligence service, not the lead generation engine.

- Gullkornet / KeeLead: finds and enriches prospects.
- Website Intelligence Engine: analyzes prospect websites and produces evidence-backed improvement opportunities.
- Hermes: orchestrates the AI workflow.
- OpenOutreach: handles qualification, personalization and outreach when its phase is reached.

Deployment decision:

- Keep these services in the existing Railway project `powerful-patience`.
- Do not create a separate Railway project for Website Intelligence Engine unless a concrete isolation requirement appears later.
- Keep the website intelligence service focused on websites only.
- No DNS/MX changes.

This boundary is now part of the implementation architecture and should not be changed while the current implementation plan is being completed.


### Revised implementation order

TypeSafe is now intentionally activated because the installed JEV Ultrafast version requires `TYPESAFE_API_KEY` for its autonomous operation/target decision layer. The previous decision to defer TypeSafe is superseded by the user's decision to purchase credits and create the API key.

The revised locked order is:

1. Hermes — DONE
2. Agent Reach — DONE
3. Firecrawl — DONE
4. JEV Ultrafast foundation — DONE
5. TypeSafe + JEV autonomous decision layer — DONE
6. Browser Use — DONE
7. KeeLead — DONE
8. OpenOutreach — CURRENT
9. End-to-end integration
10. End-to-end testing
11. Production
12. Autonomous Cidea AI Sales Engine

We will not skip the TypeSafe verification. The phase is complete only after the key is configured securely in the Railway runtime, a real TypeSafe request succeeds, JEV completes an autonomous browser task, the additional browser and failure tests pass, and the result is documented and committed.

## Phase 5 — TypeSafe + JEV autonomous decision layer

**Status: COMPLETE (2026-10-08)**

Goal: enable the already-installed JEV Ultrafast agent to make autonomous operation/target decisions without changing DNS/MX or replacing the existing browser runtime.

Implementation sequence:

1. Configure `TYPESAFE_API_KEY` securely in the existing Hermes Railway runtime.
2. Do not place the key in GitHub, source code, screenshots, logs, or chat.
3. Verify the TypeSafe API directly with a minimal authenticated request.
4. Verify JEV can read the TypeSafe configuration and pass the decision step.
5. Run the real JEV acceptance task:
   `https://example.com/ → find Learn more → open IANA Example Domains`.
6. Confirm JEV reaches the correct final URL and reports `done`.
7. Test one additional Cidea-relevant browser task.
8. Test failure handling and confirm a failed JEV decision does not create uncontrolled browser actions.
9. Document the runtime configuration, tests, result, and any limits.
10. Commit the documentation to GitHub.
11. Verify the commit.
12. Only then mark Phase 5 DONE and move to Phase 6 Browser Use.

Security rule:

The value of `TYPESAFE_API_KEY` is a secret. Only the variable name and configuration status belong in GitHub documentation. Never commit the actual key.

### Phase 5 verification results (2026-10-08)

Runtime and security:
- `TYPESAFE_API_KEY` configured as a Railway runtime secret on the existing `hermes-agent` production service: PASS
- Secret value was not placed in GitHub, source code, screenshots, logs, or chat: PASS
- No DNS/MX changes: PASS

TypeSafe:
- Authenticated `GET https://api.typesafe.ai/v1/models`: PASS
- Available models returned: `jev-latest` and `jev-preview`
- TypeSafe authentication and model discovery: PASS

JEV + TypeSafe acceptance:
- `https://example.com/` → identify `Learn more` → open IANA Example Domains: PASS
- Final URL: `https://www.iana.org/help/example-domains`
- Final status: `done`
- Decision probability: `1.0`
- Decision confidence: `0.99`
- Page changed after click: `True`

Additional Cidea browser action test:
- Controlled browser workflow executed successfully: PASS
- JEV completed the requested navigation and verification without modifying or submitting anything: PASS

Failure handling:
- Requested a deliberately nonexistent target: PASS
- Final status: `blocked`
- URL remained `https://example.com/`
- History remained empty, confirming no uncontrolled browser action was executed

Important limitation:
- A separate Cidea analysis/reporting test using only an inspection prompt returned `done` with empty history. This does not establish general website-analysis/reporting capability. JEV should be treated as the browser action/decision layer, while website extraction and analysis remain the responsibility of upstream tools such as Firecrawl and Agent Reach.

Phase 5 conclusion:
- TypeSafe + JEV autonomous decision layer: VERIFIED
- Browser action execution: VERIFIED
- Failure containment: VERIFIED
- Phase 5: COMPLETE

## Phase 7 — KeeLead

**Status: COMPLETE (2026-10-08)**

KeeLead is integrated as the lead discovery, enrichment, verification, company research and scoring provider.

Implementation:
- `src/integrations/keelead.ts` provides the provider boundary.
- Lead search, enrichment, email verification, company research and scoring are covered.
- Provider timeout and HTTP error handling are implemented.
- No API keys or secrets are stored in GitHub.
- Unit tests and CI pass.

Runtime:
- KeeLead is deployed on Railway as service `keelead` in the existing `powerful-patience` project.
- The deployment is healthy with 1/1 replica online.
- The deployed `/api/leads` route now uses KeeLead `SourceManager` rather than the legacy lead engine.
- No DNS/MX changes were made.

Live acceptance:
- GitHub Actions workflow: `KeeLead Live Acceptance`
- Production lead search: PASS, returned 32 leads for a web design query in Oslo.
- Enrichment: PASS.
- Email verification: PASS.
- Company research: PASS.
- Lead scoring: PASS, score returned 95 for the test ICP.
- CI: PASS.
- Production endpoint was tested from GitHub Actions because the direct web/container execution environment cannot resolve the Railway hostname.

Important limitation:
- KeeLead's upstream documentation explicitly notes that some data sources are placeholders. Therefore SourceManager routing is verified, but individual premium/placeholder sources are not assumed production-grade without source-specific validation.

Phase 7 conclusion:
- KeeLead runtime: VERIFIED
- SourceManager lead discovery: VERIFIED
- Enrichment: VERIFIED
- Email verification: VERIFIED
- Company research: VERIFIED
- Lead scoring: VERIFIED
- Live acceptance: PASS
- Phase 7: COMPLETE

## Phase 8 — OpenOutreach

**Status: IN PROGRESS (2026-10-08)**

OpenOutSend is integrated as the outreach execution layer after KeeLead.

Architecture:
- KeeLead owns prospect discovery, enrichment, verification and scoring.
- OpenOutSend owns lead ingestion, mailbox state, suppression, pacing and sending guards.
- JSONL is the provider boundary between KeeLead and OpenOutSend.
- OpenOutFind is not used because it would duplicate KeeLead discovery.
- Live sending remains disabled until the controlled acceptance gate is passed.
- No DNS/MX changes.

Implementation:
- `src/integrations/openoutreach.ts` provides the provider boundary.
- JSONL ingestion, bounded commands, failure handling and explicit send gating are covered by tests.
- CI passes.
- No API keys or mailbox credentials are committed.
- Runtime package: `openoutsend==0.1.39`.
- The Pydantic AI compatibility repair (OpenAIModel -> OpenAIChatModel) is applied in the runtime Docker build.
- Persistent OpenOutSend volume remains mounted at `/app/data`.

Verified:
- OpenOutSend runtime startup: PASS.
- Controlled JSONL ingestion: PASS.
- Re-ingestion of the same `lead_id`: PASS.
- SQLite persistence/idempotency assertion: PASS.
- `outsend send --agent-draft --json` reached the expected draft-pending gate without sending: PASS.
- IMAP TCP connectivity to `imap.migadu.com:993`: PASS.
- SMTP TCP connectivity from Railway: FAIL on port 465 and FAIL on port 587.
- The SMTP failures are network egress/connectivity failures, not OpenOutSend credential validation failures.
- The service start command has been restored to safe `outsend check`.
- `OPENOUTREACH_ALLOW_SEND` remains disabled.

Runtime constraint:
- Railway cannot currently establish the required outbound SMTP connection from this service.
- Resend was evaluated as an HTTPS transport alternative, but the connected Resend account currently has only `smartsvar.no` verified.
- We will not use the SmartSvar domain as a Cidea sender and will not introduce DNS/MX changes solely to work around this.
- No new Railway project/service is being created for this workaround.

Remaining Phase 8 gate:
1. Provide an approved HTTPS email transport for `cideamarketing.com`, or move the OpenOutSend runtime to infrastructure with SMTP egress.
2. Run `outsend check` against the real mailbox.
3. Feed one controlled KeeLead lead through the JSONL boundary.
4. Verify AI draft generation.
5. Verify suppression and pacing.
6. Perform exactly one controlled non-production send to the approved test recipient.
7. Verify delivery and mailbox/reply handling.
8. Immediately disable sending again.
9. Update this document with the final runtime and acceptance results.
10. Commit and verify the documentation.
11. Only then mark Phase 8 COMPLETE.

Phase 8 is **not complete** until the transport gate and controlled send acceptance are complete.

## Phase 6 — Browser Use verification

**Status: COMPLETE (2026-10-08)**

Browser Use is available inside the existing Hermes Railway runtime. A separate Browser Use installation on the Windows workstation is not required.

Verified runtime foundation:

- Hermes Railway service: hermes-agent
- Persistent Railway volume: /opt/data
- Hermes image: nousresearch/hermes-agent:latest
- Browser Use CLI/runtime available at /opt/data/bin/uvx
- Browser Harness 0.1.13: PASS
- Chrome running and Browser Harness daemon alive: PASS
- Active local browser connection: PASS
- Browser Use Cloud authentication: not configured; cloud is optional for the local browser path
- No DNS/MX changes

Acceptance test:

- Open https://example.com
- Identify and click Learn more
- Verify final page is the IANA Example Domains page
- Result: PASS
- Final URL: https://www.iana.org/help/example-domains

Adaptive navigation test:

- Browser Use identified the Learn more target from the live DOM and navigated using the discovered href
- Result: PASS
- This confirms Browser Use can adapt to the page structure rather than depending only on a hardcoded target selector

JEV fallback trigger test:

- JEV was given a deliberately nonexistent target
- Result: blocked
- URL remained https://example.com/
- No uncontrolled browser action occurred
- Result: PASS

Browser Use fallback recovery test:

- Browser Use started from https://example.com/ after the controlled JEV block
- Browser Use identified the live Learn more element, clicked it, and waited for navigation
- Final URL: https://www.iana.org/help/example-domains
- Result: PASS

Fallback conclusion:

The controlled fallback path is now verified at the execution level:

Firecrawl → JEV → if JEV is blocked → Browser Use

This is an execution-path verification, not yet the production orchestration implementation. The actual Gullkornet adapter/orchestrator still needs to be defined and tested before Phase 6 can be marked complete.

Next Phase 6 work:

1. Test Browser Use on a real Cidea website intelligence scenario.
2. Test Browser Use failure handling on a dynamic/unavailable target.
3. Define the minimal standard Browser Use interface for the orchestrator. — PASS (`src/integrations/browser-use.ts`)
4. Keep Browser Use as an escalation/fallback path, not the default tool for every lead. — PASS
5. Document the final interface and security boundaries. — PASS
6. Run CI. — PASS
7. Commit and verify. — PASS
8. Mark Phase 6 DONE only after all acceptance criteria pass. — COMPLETE


Phase 6 conclusion:
- Browser Use runtime: VERIFIED
- Acceptance navigation: VERIFIED
- Adaptive navigation: VERIFIED
- JEV blocked → Browser Use recovery path: VERIFIED
- Failure containment: VERIFIED
- Standard provider boundary: IMPLEMENTED and CI VERIFIED
- No DNS/MX changes
- Phase 6: COMPLETE

## Phase 2 — Agent Reach verification

Hermes is the runtime owner for Agent Reach. Agent Reach 1.5.0 is installed in the persistent Railway volume at `/opt/data/agent-reach-venv`, and the Agent Reach skill is registered for Hermes.

The installation was performed in an isolated Python 3.11 virtual environment. The Railway volume is 5 GB and is mounted at `/opt/data`.

Runtime smoke tests verified:

- Exa semantic search: PASS
- GitHub CLI access to `KhalilJel/Gullkornet`: PASS
- Jina Reader transport: PASS; the tested `www.cidea.no` hostname could not be resolved by Jina, so that specific website read is not counted as a content-read success.
- Persistence after normal Hermes restart: PASS
- `/opt/data/agent-reach-venv/bin/agent-reach --version`: Agent Reach v1.5.0 after restart

The Agent Reach Doctor reported 4/16 channels directly available. Optional logged-in social channels were deliberately not installed. YouTube was not detected in the Doctor environment and is not a Phase 2 blocker.

**Phase 2 is complete.**

## Phase 3 — Firecrawl verification

Firecrawl is implemented in `src/integrations/firecrawl.ts` with tests in `tests/firecrawl.test.ts`.

The adapter:

- keeps provider-specific responses outside the domain layer
- reuses Gullkornet public-URL safety checks
- supports v2 `/scrape` and `/crawl`
- requires `FIRECRAWL_API_KEY` only at runtime
- does not change DNS/MX
- does not replace the existing website audit path yet

Runtime verification completed on 2026-10-06:

- Firecrawl API key configured in Railway runtime secret store: PASS
- Hosted `/v2/scrape` against `https://example.com`: PASS, HTTP 200
- Hosted `/v2/crawl` with limit 2: PASS, job completed 2/2
- Hermes restart: PASS
- Firecrawl scrape after restart: PASS
- Hermes Railway health after restart: 1/1 online, 0 crashes, 0 warnings, 0 critical issues
- GitHub Actions typecheck: PASS
- GitHub Actions test suite: PASS
- CI workflow added in PR #63 and merged to `main`
- DNS/MX: unchanged

**Phase 3 is complete.**

## Phase 4 — JEV Ultrafast foundation verification

JEV Ultrafast 0.1.0 is installed in the persistent Railway volume at `/opt/data/jev-venv` using Python 3.13.5. The package is installed from the official upstream GitHub repository `browser-use/jev-ultrafast`.

Verified:

- `jev-ultrafast` package import: PASS
- `jev_ultrafast.model` import: PASS
- Browser Harness 0.1.13 dependency: installed and importable
- Chromium 154.0.8037.92: installed from Debian 13 package
- Chromium CDP endpoint `127.0.0.1:9222`: PASS
- Browser Harness `BU_CDP_URL=http://127.0.0.1:9222`: configured for the runtime session
- Browser Harness daemon: PASS
- Active browser connection: PASS, 1 local connection
- Browser Harness log confirms attachment to Chromium and local socket availability
- Real-tab creation: PASS
- Navigation to `https://example.com/`: PASS
- Page state retrieval: PASS; URL, title, viewport and document dimensions returned
- Tab enumeration: PASS; active tab returned with target ID, title and URL
- Accessibility tree inspection: PASS; semantic link `Learn more` identified with backend DOM node ID 27
- Browser Use Cloud authentication: not configured; cloud is optional for the local browser path

Important dependency boundary:

- OpenRouter `TEXT_MODEL_API_KEY` is used by JEV's OpenAI-compatible text helper.
- TypeSafe `TYPESAFE_API_KEY` is a separate requirement for JEV's operation/target decision layer.
- OpenRouter does not replace TypeSafe.
- TypeSafe API access was initially deferred because it has a cost.
- The user has now intentionally purchased/activated TypeSafe credits and created a TypeSafe API key.
- The TypeSafe key must be stored only as the Railway runtime secret `TYPESAFE_API_KEY`; it must never be committed to GitHub.
- Actual JEV autonomous operation/target selection is now the active Phase 5 work.

Current JEV status: **browser/runtime foundation READY; autonomous decision layer BLOCKED only on secure TypeSafe runtime configuration and verification**.

No DNS/MX changes were made.

## Phase 1 verification summary

- Railway service: LIVE
- Persistent volume: `/opt/data`
- Gateway: `hermes gateway run`
- Nous Portal: authenticated
- Model: GPT-6 Astra
- Browser: Local Browser
- Web search: DDGS
- Post-restart web search: verified
- Railway post-restart health: 1/1 replicas, 0 crashes, 0 warnings, 0 critical issues
- DNS/MX: unchanged

## Browser Use decision

Browser Use is part of the locked plan. It will be evaluated as the adaptive browser agent alongside JEV Ultrafast. The two should not be treated as interchangeable until benchmark results are available.

The current Browser Harness runtime provides the local browser foundation for this evaluation. A separate Browser Use stack has not been added because JEV already brings `browser-harness==0.1.13`.

## Documentation rule

Each completed phase must update this status file and its relevant component documentation.

## Phase 5 — execution-path clarification (2026-10-08)

The current Hermes documentation confirms that Browser Use mode exposes `browser_exec`, which executes model-written Python and is only offered to sessions that also have terminal access. Local Browser Use mode drives Hermes' packaged Chromium rather than the user's Windows Chrome.

This confirms that the current blocker is an access-path problem, not an installation problem.

Accepted ways to complete the Phase 5 acceptance test:

1. Execute the existing Browser Use test from a terminal-enabled Hermes session using the existing local Chromium/browser-harness runtime.
2. If terminal access to that runtime cannot be provided, explicitly enable a supported cloud browser path for Hermes and test the browser automation there. This requires intentional provider/credential configuration and is not being enabled automatically.

The preferred path remains option 1 because Browser Use is already installed and the local Chromium/CDP foundation is verified.

Official Hermes Browser Automation documentation:
https://hermes-agent.nousresearch.com/docs/user-guide/features/browser/

Phase 6 is now **NOT STARTED**. No Browser Use provider, API key, DNS/MX record, or production deployment was changed during this clarification.

### KeeLead validation findings

- KeeLead is deployed and healthy on Railway.
- A live acceptance workflow is now committed at `.github/workflows/keelead-live-acceptance.yml`.
- The GitHub connector currently reports no workflow run for the acceptance commit, so the live HTTP acceptance test has not been falsely marked as passed.
- Direct runtime inspection of the upstream KeeLead implementation shows that several advertised sources and enrichment paths are demo/placeholder implementations. These must not be treated as production intelligence until replaced or validated against real data.
- Phase 7 therefore remains incomplete.

### KeeLead implementation boundary

The deployed KeeLead service points to `KhalilJel/keelead`, but the connected GitHub integration cannot read or modify that repository (404/403). The upstream KeeLead repository documents 35 free sources and explicitly notes that some data sources are placeholder implementations. The current deployed `/api/leads` path was inspected from the upstream source and uses the legacy lead engine rather than the newer SourceManager. Therefore the next required implementation is to switch the deployed API route to the SourceManager based pipeline before production use. No new Railway service should be created just to work around repository access.


## Phase 9 — runtime boundary audit (2026-10-09)

Phase 9 is **IN PROGRESS**. The orchestration unit boundary and tests have been hardened on `phase9/end-to-end-orchestration`, but this is not yet end-to-end integration.

Verified architecture finding:
- The deployed KeeLead service is reachable at `https://keelead-production-9f05.up.railway.app`; its source repository remains inaccessible to the connected GitHub integration, and documented placeholder sources are not production evidence.
- The current OpenOutreach TypeScript adapter invokes a local CLI. The deployed Railway `openoutreach` service has no domain and starts `outsend check` with restart policy `NEVER`; it does not currently expose a remote queue-ingestion endpoint.
- PR #66 remains an open draft. Its runtime changes are deployed from the phase-8 branch but are not merged into `main`.
- Therefore, the current code must not be described as a live integrated sales engine. A secure queue handoff and real runtime acceptance remain required.

No real-prospect email was sent. No secrets were committed. No DNS/MX changes were made.


### Phase 9 update — authenticated OpenOutSend handoff (2026-10-09)

- Added a remote ingest-only TypeScript client on `phase9/end-to-end-orchestration`; it validates batches and requires the server acknowledgement to confirm no send was triggered.
- Added PR #68 (`phase9/openoutsend-ingest-api` → `fix/openoutsend-pydantic-compat`) for the corresponding bearer-authenticated API in the existing OpenOutSend runtime. This PR is a draft and has not been deployed.
- The endpoint is designed to invoke only `outsend` with NDJSON on stdin, never `outsend send`. The API requires a runtime-only `OPENOUTREACH_INGEST_TOKEN`, has bounded request sizes, and contains no secrets in source.
- Python API tests and Docker image verification are still pending. No production service source/configuration has been changed for this bridge.


### Phase 9 runtime composition (2026-10-09)

- Added the Phase 9 runtime composition adapter and a dry-run-by-default `npm run sales-engine` entrypoint on the Phase 9 branch.
- The entrypoint uses KeeLead for discovery/enrichment/email verification, the existing public-URL-safe website audit/contact research, and Airtable Do Not Contact flags. Airtable lookup fails closed.
- Human-review-required findings are preserved in a local ignored review-queue file; they are not sent to OpenOutSend. The runtime entrypoint has not yet been run against live prospect data.
- Latest CI and KeeLead live acceptance checks are pending for the newest commit. The separate OpenOutSend ingest API unit tests have passed, but that API has not been deployed.


### Phase 9 CRM sync and verification checkpoint (2026-10-09)

- `npm run sales-engine` now persists human-review findings through the existing Airtable sync path, using the existing CRM duplicate-key and do-not-contact rules. The record is marked for review; this does not send email.
- TypeScript CI passed on `fd0366ebc181c8a69ebf7c8f45bbdb06a96c7ad8` (typecheck and unit tests).
- The separate OpenOutSend ingest bridge's Python unit tests and Docker image build passed. PR #68 remains draft and is not deployed.
- KeeLead live acceptance is being rechecked on the latest commit. End-to-end runtime acceptance is still outstanding because the bridge has not been configured/deployed on the existing Railway service.


### Phase 9 verification checkpoint (2026-10-09)

- Phase 9 TypeScript CI and KeeLead Live Acceptance passed on commit `66da0cba614a0222a77bfc9c1ae46c0083cbf717`.
- OpenOutSend ingest bridge Python tests and Docker build passed on commit `048a6c955af11066a9438d039c08127fada95e6e`.
- The bridge is not deployed; the current Railway service still starts `outsend check` with restart policy `NEVER` and has no service domain. Phase 9 remains IN PROGRESS until private runtime acceptance passes.
- The research adapter requires human review by design. Do not bypass that gate to make the queue appear active.
