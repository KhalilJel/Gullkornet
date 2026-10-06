# Cidea AI Stack

Status: Phase 0 — locked

| Component | Primary role | Phase |
|---|---|---:|
| Hermes | Orchestration, memory, context, delegation | 1 |
| Agent Reach | Internet research | 2 |
| Firecrawl | Website crawling/extraction | 3 |
| JEV Ultrafast | Browser actions | 4 |
| TypeSafe | Fast/reliable inference where justified | 5 |
| KeeLead | Lead discovery/enrichment/verification | 6 |
| OpenOutreach | Qualification/personalization/outreach | 7 |

## Existing systems

| System | Role |
|---|---|
| Gullkornet | Lead research and qualification engine |
| Airtable | Persistent lead registry where configured |
| Resend | Email transport |
| Mailopoly/IMAP | Reply detection |
| GitHub | Code, CI and technical documentation |
| Railway | Runtime for services/workers where required |
| Cidea | Customer-facing commercial business |

## Design principle

Prefer one clear responsibility per component. Do not add another AI framework or agent before the locked implementation sequence is complete.

The system should produce evidence-backed observations. It must not invent business problems, promise revenue outcomes, or automatically treat every prospect as a website sale.

## Integration principle

Each component is first tested in isolation, then integrated into the existing Gullkornet pipeline. Existing working functionality must not be casually replaced.
