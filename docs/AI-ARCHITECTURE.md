# Cidea AI Layer Architecture

Status: Phase 0 — architecture locked
Last updated: 2026-10-06

## Purpose

This document defines the target AI architecture for Cidea + Gullkornet. The architecture is implemented incrementally and must follow the locked implementation plan.

## System roles

- **Hermes**: primary agent orchestrator, memory, context and delegation.
- **Agent Reach**: internet research capability across supported public sources.
- **Firecrawl**: website crawling and structured web extraction.
- **JEV Ultrafast**: browser interaction and verified browser actions.
- **TypeSafe**: fast/reliable inference layer where it provides a measurable benefit, especially for JEV.
- **KeeLead**: lead discovery, enrichment and email verification.
- **OpenOutreach**: qualification, personalization and controlled outreach workflow.
- **Gullkornet**: internal lead discovery and qualification engine.
- **Airtable**: optional persistent lead registry / CRM layer for Gullkornet.
- **Resend**: outbound email transport.
- **Mailopoly/IMAP**: inbound reply detection.
- **Cidea**: commercial delivery layer.

## Target flow

Lead discovery
→ enrichment
→ website/reputation research
→ qualification
→ personalization
→ controlled outreach
→ reply detection
→ human follow-up.

Hermes coordinates agent work. It does not replace the specialized tools.

## Deployment boundaries

GitHub is the source of truth for code and relevant technical documentation.

Railway is the intended runtime for backend services/workers where required.

Secrets must remain in runtime secret stores and never be committed to Git.

No DNS or MX changes are part of this project.

No automatic bulk email activation is allowed during implementation or testing.

## Locked implementation order

1. Architecture
2. Hermes
3. Agent Reach
4. Firecrawl
5. JEV Ultrafast
6. TypeSafe
7. KeeLead
8. OpenOutreach
9. End-to-end integration
10. Production testing
11. Autonomous Cidea sales engine

Agency Agents and SEO Agent are explicitly out of scope until this sequence is complete.

## Completion rule

A phase is not complete until implementation, verification/tests and relevant GitHub documentation are complete.
