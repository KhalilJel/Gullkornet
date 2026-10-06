# Cidea AI Stack

Status: Phase 0 — locked
Last updated: 2026-10-06

| Component | Primary role | Phase |
|---|---|---:|
| Hermes | Orchestration, memory, context, delegation | 1 |
| Agent Reach | Internet research | 2 |
| Firecrawl | Website crawling/extraction | 3 |
| JEV Ultrafast | Fast browser actions | 4 |
| Browser Use | Adaptive multi-step browser automation | 5 |
| TypeSafe | Fast/reliable inference where justified | 6 |
| KeeLead | Lead discovery/enrichment/verification | 7 |
| OpenOutreach | Qualification/personalization/outreach | 8 |

## Browser Use role

Browser Use is added as the adaptive browser layer. Its official project supports browser agents that navigate and interact with websites, with local/open-source and hosted options. citeturn0search9

For Cidea/Gullkornet, Browser Use should be evaluated for tasks such as multi-step research, interacting with sites that require real browser state, extracting information after navigation, and controlled browser actions.

Do not automatically use Browser Use for every browser task. JEV remains the high-speed candidate for simple repetitive actions. The end-to-end phase decides the routing rules based on measured reliability, speed and cost.

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