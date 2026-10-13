# Cidea AI Stack

Last verified against code: 2026-10-13 (`main` plus the pipeline orchestration pull request).

This page states what is **actually connected**, not what was planned. Status words are strict:

- **documented**: described in a doc or plan only.
- **implemented**: code exists in this repository and is covered by tests.
- **wired**: called by the scheduled pipeline.
- **deployed**: running as a service.
- **verified in operation**: proven by a run on the real service, with the evidence named.

## What can be called from the pipeline

Gullkornet's workflows run on GitHub Actions. They can only call components that expose a public HTTPS API and whose credentials are available to the workflow. Hermes, Agent Reach, JEV Ultrafast, Browser Use and TypeSafe run inside one private Railway container (`hermes-agent`) that has **no public domain**, so nothing in this repository can call them. Docs that say they were verified describe tests run from inside that container, not from the pipeline.

> Gateway code exists and is unit-tested with a mocked Hermes (`docs/AGENT-GATEWAY.md`), but it is **not deployed and not verified against a live Hermes**. The pipeline uses it only when `AGENT_GATEWAY_URL` and `AGENT_GATEWAY_TOKEN` are both set; today they are not, so the run prints "Browser escalation: OFF" and the router records `escalation_needed`. The table below describes what is actually active.

## Components

| Component | Role in the pipeline | Code | Wired | Deployed | Verified in operation |
|---|---|---|---|---|---|
| Google Places | Find businesses, keep source URL, deduplicate (`discover:google`) | implemented | yes (`Google Places Discovery`) | n/a (API) | yes: scheduled runs succeeded until 2026-10-11 |
| KeeLead | Enrich and verify contacts (`sales-engine`) | implemented | only in the Phase 9/10 acceptance dry run, not in the scheduled chain | Railway | dry run in CI |
| Built-in website fetch | Free default website analysis (`website-audit`, `contact-research`) | implemented, now with a body-read deadline | yes | n/a | yes |
| Firecrawl | Fallback when the built-in fetch returns nothing readable | implemented, **wired as optional fallback** in `research-router` (needs `FIRECRAWL_API_KEY`, capped by `FIRECRAWL_MAX_PER_RUN`) | yes, inert without the key | n/a (API) | no: the key is not configured in GitHub |
| Browser Use | Escalation for interactive, multi-step sites | router executor via the gateway client (code + mock tests only); without gateway config the router records `escalation_needed` | no executor reachable from CI | inside Hermes container only | no |
| JEV Ultrafast | Simple repeatable browser steps | router executor via the gateway client (code + mock tests only); otherwise `escalation_needed` | no | inside Hermes container only | no |
| TypeSafe | Model inference | no code | no | key lives in the Hermes runtime | no. No measured need: the routing and qualification rules are deterministic, so no extra model round was added |
| Hermes | Orchestration and memory | gateway server calls its OpenAI-compatible API (mock tests only; API not enabled) | no | Railway, no public domain | no. Not used per lead |
| Agent Reach | Broad public research | no code | no | inside Hermes container only | no |
| Cidea routing rules | Score a researched company for CideaLead, CideaMarketing, CideaConsulting | implemented (`cidea-routing.ts`, rule version `cidea-routing-rules@1`) | yes, run for every researched company | n/a | not yet (needs a research workflow run) |
| Airtable AI Assessment | Decide APPROVE or not and write the AI fields | not in this repository (an Airtable automation) | the repository resets the AI fields on each refresh and the sender enforces the result | draft, off | no |
| Resend | Email transport for the daily sender | implemented | yes, only when the kill switch is on | n/a | one pilot email (2026-10-09) |
| OpenOutSend (Railway `openoutreach`) | Ingest API and reply-status check | implemented (Python bridge, TypeScript client) | reply check is used by the sender; ingest is used only by `sales-engine` | Railway, still on an older commit | ingest and health yes; the reply check with the new code is not yet verified |

`src/integrations/openoutreach.ts` is a legacy client that nothing imports. OpenOutSend does not send mail: its own send command is locked and its delivery switch is off. Sending is done by `send-daily-outreach` through Resend.

## Responsibilities and routing

1. **Google Places** finds one business and its source URL. Duplicates are removed by the existing dedupe rules.
2. **Built-in fetch** analyses the website first. It is free.
3. **Firecrawl** is tried only when the built-in fetch returned no readable content, and only while the per-run budget lasts.
4. **One browser path at most**, only after Firecrawl failed: Browser Use for interactive pages, JEV for simple steps. Both are *requested*, not executed, in CI until the gateway is deployed and configured. The requests are recorded so nothing is guessed.
5. A URL blocked by the public-URL safety check is **never** escalated to any provider.
6. **Cidea routing** turns source-backed facts into scores per unit with a confidence. Facts, inferences and recommendations are separate, and every one carries a source URL and timestamp. A unit without supporting facts scores 0 with confidence 0.
7. The routing summary is written to the existing Airtable `Research Notes` field. The AI fields stay reset until the Airtable assessment writes them. The human-only `Verified Observation` field is never touched.
8. A `STRATEGIC_ACCOUNT` route (two or more strong units) is refused by the sender: it needs deeper research, not ordinary automated outreach.

Failure of any provider is recorded as an attempt and never produces findings, a draft or a send.

## Existing systems

| System | Role |
|---|---|
| Gullkornet | Lead research, routing and the send gates |
| Airtable | Persistent lead registry and the AI assessment |
| Resend | Email transport |
| Migadu (IMAP) | Reply detection through the OpenOutSend monitor |
| GitHub | Code, CI and the scheduled pipeline |
| Railway | Runtime for OpenOutSend, KeeLead and the private Hermes container |

## Design principle

One clear responsibility per component. Do not add another AI framework or a model round without a measured gain in quality or cost. The system produces evidence-backed observations; it must not invent business problems, promise revenue outcomes, or treat every prospect as a website sale.
