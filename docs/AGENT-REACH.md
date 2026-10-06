# Agent Reach Integration

Status: Phase 2 implementation
Last updated: 2026-10-06

## Role

Agent Reach is Gullkornet's broad public-internet research capability layer. It is coordinated by Hermes and provides routed access to upstream read-only research tools.

Agent Reach is not the CRM, evidence store, scoring engine or outreach system. Gullkornet remains responsible for normalized evidence and downstream opportunity handling.

## Runtime boundary

Agent Reach is installed in the Hermes Railway container in a persistent virtual environment:

- Virtual environment: `/opt/data/agent-reach-venv`
- CLI: `/opt/data/agent-reach-venv/bin/agent-reach`
- Skill registration: `/root/.agents/skills/agent-reach`
- Version verified: 1.5.0
- Persistent storage: Railway volume mounted at `/opt/data`

The Node.js Gullkornet application does not add Agent Reach as an npm dependency. This keeps the capability layer independent from the domain model and allows Hermes to route research through the installed skill.

## Current public research capabilities

Verified by Agent Reach doctor during Phase 2 installation:

- Web pages via Jina Reader
- RSS/Atom
- V2EX public API
- Bilibili public search backend
- GitHub CLI installed and authenticated configuration detected
- Exa semantic search configured through mcporter

The Agent Reach doctor reports GitHub and Exa as configured but does not perform their live verification in this environment. YouTube is not currently available because `yt-dlp` is not exposed where Agent Reach's doctor expects it. YouTube is not a Phase 2 blocker for Gullkornet's core business research flow.

Logged-in social channels are intentionally not installed or configured in this phase.

## Gullkornet evidence boundary

Agent Reach output must be normalized before it becomes lead evidence.

Important evidence fields remain:

- `sourceUrl`
- `observation`
- `checkedAt`

Agent Reach observations must not be converted into customer-facing claims automatically. They are research inputs for qualification, opportunity scoring and human review.

## Safety boundaries

- No DNS or MX changes.
- No secrets or cookies in Git.
- No automatic login to social platforms.
- No destructive browser actions.
- No real form submissions.
- No automatic bulk email activation.
- Human review remains required before outbound contact.

## Implementation sequence

Phase 2 establishes Agent Reach as the broad research capability. Firecrawl remains the next specialized layer for website crawling and structured extraction.

The intended flow is:

Discover
→ Agent Reach research
→ normalize evidence
→ qualify
→ opportunity scoring
→ route to CideaLead / CideaMarketing / CideaConsulting.

Agent Reach should not duplicate Firecrawl's later website-crawling responsibility.
