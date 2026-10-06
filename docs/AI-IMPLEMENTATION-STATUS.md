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

Phase 2 — Agent Reach is in implementation and verification.

Hermes is the runtime owner for Agent Reach. Agent Reach 1.5.0 is installed in the persistent Railway volume at `/opt/data/agent-reach-venv`, and the Agent Reach skill is registered for Hermes.

The installation was performed in an isolated Python 3.11 virtual environment rather than modifying the container's externally managed system Python. The Railway volume is 5 GB and is mounted at `/opt/data`.

The Agent Reach installer completed with the following baseline capabilities:

- Jina Reader for arbitrary public web pages
- RSS/Atom
- V2EX public API
- Bilibili public search backend
- GitHub CLI installed with authentication configuration detected
- Exa semantic search configured through mcporter

The Agent Reach doctor currently reports 4/16 channels directly available. GitHub and Exa are configured but not live-probed by Doctor in this environment. YouTube is not currently detected because `yt-dlp` is not exposed where Doctor expects it. Optional logged-in social channels were deliberately not installed.

Gullkornet's existing evidence model remains the normalization boundary. Agent Reach is a research capability layer, not a replacement for Gullkornet's evidence, qualification or opportunity logic.

See `docs/AGENT-REACH.md` for the integration boundary and safety rules.

## Phase 2 gate

Phase 2 is **not marked complete yet**.

The remaining verification is a runtime smoke test from the Hermes container for the installed upstream research backends, followed by persistence verification when the service is next restarted/redeployed through the normal Railway workflow.

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
