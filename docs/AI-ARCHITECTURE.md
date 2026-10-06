# Cidea AI Layer Architecture

Status: Phase 0 — architecture locked
Last updated: 2026-10-06

## Purpose

This document defines the target AI architecture for Cidea + Gullkornet. The architecture is implemented incrementally and must follow the locked implementation plan.

## System roles

- **Hermes**: primary agent orchestrator, memory, context and delegation.
- **Agent Reach**: internet research capability across supported public sources.
- **Firecrawl**: website crawling and structured web extraction.
- **JEV Ultrafast**: fast browser interaction and verified browser actions.
- **Browser Use**: general-purpose agentic browser automation for multi-step web workflows, research and actions that benefit from adaptive browser reasoning.
- **TypeSafe**: fast/reliable inference layer where it provides a measurable benefit, especially around browser-agent execution.
- **KeeLead**: lead discovery, enrichment and email verification.
- **OpenOutreach**: qualification, personalization and controlled outreach workflow.
- **Gullkornet**: internal lead discovery and qualification engine.
- **Airtable**: optional persistent lead registry / CRM layer for Gullkornet.
- **Resend**: outbound email transport.
- **Mailopoly/IMAP**: inbound reply detection.
- **Cidea**: commercial delivery layer.

## Browser automation strategy

JEV Ultrafast and Browser Use are complementary rather than duplicate by default.

- **JEV Ultrafast** is the fast path for simple, high-throughput browser tasks.
- **Browser Use** is the adaptive path for complex multi-step browser workflows where the agent must reason about the page and recover from changing layouts.
- The integration phase will benchmark both on representative Cidea/Gullkornet tasks and assign each workload to the appropriate engine.

Browser Use is an official open-source browser-agent project with Python and TypeScript options and hosted browser infrastructure. It can also be connected to coding/agent environments such as Hermes. citeturn0search9

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
6. Browser Use
7. TypeSafe
8. KeeLead
9. OpenOutreach
10. End-to-end integration
11. End-to-end testing
12. Production
13. Autonomous Cidea sales engine

Agency Agents and SEO Agent are explicitly out of scope until this sequence is complete.

## Completion rule

A phase is not complete until implementation, verification/tests and relevant GitHub documentation are complete.