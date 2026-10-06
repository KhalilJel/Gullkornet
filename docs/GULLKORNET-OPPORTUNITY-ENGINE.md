# Gullkornet Opportunity Engine

Status: Design locked for implementation
Last updated: 2026-10-06

## Purpose

Gullkornet is the shared intelligence engine for all three Cidea business units:

- CideaLead
- CideaMarketing
- CideaConsulting

One company should be researched once. The resulting evidence should be reusable across all three units.

## Core pipeline

DISCOVER
→ ENRICH
→ RESEARCH
→ AUDIT
→ EVIDENCE FILTER
→ OPPORTUNITY SCORING
→ ROUTE TO CIDEA UNIT
→ PERSONALIZE
→ HUMAN REVIEW
→ OUTREACH / DELIVERY

The system optimizes for qualified Cidea opportunities, not raw lead volume.

## Shared company record

Every researched company should have one canonical record containing:

- company_name
- organization_number when available
- website
- industry
- location
- contacts when publicly and appropriately available
- research findings
- evidence
- source URLs
- confidence
- timestamp

## Three Cidea outputs

### CideaLead

Question: Is this a qualified prospect for Cidea's website, branding or digital presence services?

Signals include website quality and clarity, contact path, mobile experience, SEO signals, branding/digital profile weaknesses, social presence, business activity and fit with Cidea services.

Output:
- lead score
- fit score
- recommended service
- evidence
- confidence

### CideaMarketing

Question: Is there a meaningful marketing opportunity for this company?

Signals include SEO opportunities, content gaps, search opportunities, competitor positioning, social opportunities, conversion opportunities and campaign opportunities.

Output:
- marketing opportunity score
- opportunity
- target
- channel
- evidence
- expected impact
- confidence

### CideaConsulting

Question: Is there a broader digital, operational or AI opportunity?

Signals include digital maturity, AI adoption, operational inefficiencies, technology stack, customer experience, business processes and competitive positioning.

Output:
- consulting opportunity score
- business problem
- AI/digital opportunity
- recommended solution
- potential impact
- complexity
- confidence

## Opportunity scoring

A company can score highly in more than one Cidea unit.

Example:

CideaLead: 87
CideaMarketing: 79
CideaConsulting: 61

Website opportunity: 91
SEO opportunity: 82
Marketing opportunity: 77
AI consulting opportunity: 55

The system must not force a company into one category.

Routing:
- Highest Lead opportunity → CideaLead
- Highest Marketing opportunity → CideaMarketing
- Highest Consulting opportunity → CideaConsulting
- Multiple high scores → STRATEGIC_ACCOUNT

## Strategic account

A company becomes STRATEGIC_ACCOUNT when multiple Cidea opportunities are materially strong.

Example:

Website: 90
SEO: 85
Marketing: 88
AI opportunity: 81

Strategic accounts receive deeper research and should not be treated like ordinary automated outreach prospects.

## Evidence rules

Every important opportunity must have:

1. A concrete observation
2. A source URL or traceable source
3. Confidence
4. Timestamp

Separate:

FACT
INFERENCE
RECOMMENDATION

The system must never turn an inference into a fact.

## Research escalation

Use the cheapest reliable research method first.

Simple website:
Firecrawl → structured evidence

Complex or interactive website:
Firecrawl → missing evidence → Browser Use

JEV Ultrafast should remain the high-throughput browser path where appropriate. Browser Use is the adaptive escalation path for multi-step interaction.

Agent Reach supplies broader public intelligence where website data alone is insufficient.

JEV and Browser Use must not both be invoked automatically for every company.

## Human control

Initial operating mode:

Research → Score → Generate → Human review → Send / deliver

No live automated outreach is enabled by this design.

## CRM

Airtable remains the intended operational registry where configured.

The company record should support:

- Lead score
- Marketing score
- Consulting score
- Opportunity scores
- Recommended Cidea unit
- Recommended service
- Evidence
- Outreach status
- Reply status
- Customer status
- Strategic account flag

Duplicate prevention is mandatory.

## Safety

- No DNS changes
- No MX changes
- No secrets in Git
- No destructive browser actions
- No real form submissions without explicit approval
- No duplicate outreach
- Stop automated follow-ups after a reply
- Preserve DRY_RUN/LIVE separation

## Implementation principle

Do not build three independent research pipelines.

Build one shared intelligence pipeline with three specialized outputs.

The measurable goal is:

1. Find better companies
2. Understand them better
3. Identify the strongest Cidea opportunity
4. Route the opportunity to the right business unit
5. Generate better human-reviewed actions
6. Convert more qualified opportunities into customers
