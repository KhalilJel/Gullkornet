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
- [ ] Phase 5 — TypeSafe + JEV autonomous decision layer
- [ ] Phase 6 — Browser Use
- [ ] Phase 7 — KeeLead
- [ ] Phase 8 — OpenOutreach
- [ ] Phase 9 — End-to-end integration
- [ ] Phase 10 — End-to-end testing
- [ ] Phase 11 — Production
- [ ] Phase 12 — Autonomous Cidea AI Sales Engine

## Current phase

Phase 5 — TypeSafe + JEV autonomous decision layer is the active phase.

### Revised implementation order

TypeSafe is now intentionally activated because the installed JEV Ultrafast version requires `TYPESAFE_API_KEY` for its autonomous operation/target decision layer. The previous decision to defer TypeSafe is superseded by the user's decision to purchase credits and create the API key.

The revised locked order is:

1. Hermes — DONE
2. Agent Reach — DONE
3. Firecrawl — DONE
4. JEV Ultrafast foundation — DONE
5. TypeSafe + JEV autonomous decision layer — CURRENT
6. Browser Use
7. KeeLead
8. OpenOutreach
9. End-to-end integration
10. End-to-end testing
11. Production
12. Autonomous Cidea AI Sales Engine

We will not skip the TypeSafe verification. The phase is complete only after the key is configured securely in the Railway runtime, a real TypeSafe request succeeds, JEV completes an autonomous browser task, and the result is documented and committed.

## Phase 5 — TypeSafe + JEV autonomous decision layer

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

## Phase 6 — Browser Use verification

Browser Use is already available inside the existing Hermes Railway runtime. A separate Browser Use installation on the Windows workstation is not required.

Verified runtime foundation:

- Hermes Railway service: hermes-agent
- Persistent Railway volume: /opt/data
- Hermes image: nousresearch/hermes-agent:latest
- Hermes exposes the browser_exec Browser Use tool
- Packaged Chromium is available in the Hermes runtime
- Browser Harness/CDP foundation was previously verified at 127.0.0.1:9222
- Previous Browser Use smoke test successfully reached https://example.com
- Previous model test reached Browser Use execution but failed with OpenRouter HTTP 402 because the selected Mercury model had insufficient credits
- Intended retry: openrouter/free with use_vision=false

Acceptance test:

1. Open https://example.com
2. Click Learn more
3. Verify the final page is the IANA Example Domains page

Current blocker:

- The available Railway integration exposes service configuration and logs but does not provide an interactive terminal/session into the Hermes container.
- Hermes Browser Use mode requires terminal access for browser_exec.
- Therefore the acceptance test has not yet been rerun from the actual Hermes runtime.
- Phase 5 remains IN PROGRESS until the acceptance test is executed and passes.

No production changes were made while investigating this blocker.

No DNS/MX changes were made.

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
