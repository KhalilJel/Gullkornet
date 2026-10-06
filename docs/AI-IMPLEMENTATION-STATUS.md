# AI Layer Implementation Status

Last updated: 2026-10-06

## Rule

Follow the locked plan in order. Do not deviate before all phases are completed.

## Workflow for every phase

Implement → test/verify → document → commit → verify → next phase.

## Phase status

- [x] Phase 0 — Architecture and guardrails
- [x] Phase 1 — Hermes
- [ ] Phase 2 — Agent Reach
- [ ] Phase 3 — Firecrawl
- [ ] Phase 4 — JEV Ultrafast
- [ ] Phase 5 — Browser Use
- [ ] Phase 6 — TypeSafe
- [ ] Phase 7 — KeeLead
- [ ] Phase 8 — OpenOutreach
- [ ] Phase 9 — End-to-end integration
- [ ] Phase 10 — End-to-end testing
- [ ] Phase 11 — Production
- [ ] Phase 12 — Autonomous Cidea AI Sales Engine

## Current phase

Phase 2 — Agent Reach remains the active phase until its persistence gate is closed.

Hermes is the runtime owner for Agent Reach. Agent Reach 1.5.0 is installed in the persistent Railway volume at `/opt/data/agent-reach-venv`, and the Agent Reach skill is registered for Hermes.

The installation was performed in an isolated Python 3.11 virtual environment rather than modifying the container's externally managed system Python. The Railway volume is 5 GB and is mounted at `/opt/data`.

The Agent Reach installer completed with the following baseline capabilities:

- Jina Reader for arbitrary public web pages
- RSS/Atom
- V2EX public API
- Bilibili public search backend
- GitHub CLI installed with authentication configuration detected
- Exa semantic search configured through mcporter

The Agent Reach doctor currently reports 4/16 channels directly available. YouTube is not currently detected because `yt-dlp` is not exposed where Doctor expects it. Optional logged-in social channels were deliberately not installed.

## Phase 2 runtime smoke test

The latest Hermes-container smoke test verified:

- Exa semantic search: PASS
- GitHub CLI access to `KhalilJel/Gullkornet`: PASS
- Jina Reader invocation: PASS at the transport level, but the tested `www.cidea.no` hostname could not be resolved by Jina, so this is not counted as a successful website-content read

The Jina result is treated as a target-domain DNS/resolution issue, not evidence that Agent Reach itself is broken.

The remaining Phase 2 gate is persistence verification after a normal Hermes service restart/redeploy. Do not mark Phase 2 complete until that verification is observed.

## Phase 3 preparation

Firecrawl implementation has been prepared on the `feat/firecrawl-phase-3` branch but is intentionally not merged into `main` while the Phase 2 gate remains open.

The Firecrawl adapter:

- keeps provider-specific responses outside the domain layer
- reuses Gullkornet public-URL safety checks
- supports v2 `/scrape` and `/crawl`
- requires `FIRECRAWL_API_KEY` only at runtime
- does not change DNS/MX
- does not replace the existing website audit until real runtime verification succeeds

See `docs/FIRECRAWL.md`.

## Phase 2 safety boundary

No DNS/MX changes are part of this phase.

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

Optional tool integrations such as GitHub token, speech-to-text or paid managed tool providers are not required for the Phase 1 gate.

## Browser Use decision

Browser Use is part of the locked plan. It will be evaluated as the adaptive browser agent alongside JEV Ultrafast. The two should not be treated as interchangeable until benchmark results are available.

## Documentation rule

Each completed phase must update this status file and its relevant component documentation.
