# Digital Market Insight — Product Pilot

## Purpose

Validate a repeatable market-insight service using the same public-data research engine as Gullkornet, without creating a separate platform before customers demonstrate willingness to pay.

## Customer promise

A structured, source-backed view of businesses in a chosen niche and geography, including public business information, website and digital-visibility observations, prioritized opportunities, and a refreshed report or dataset on an agreed weekly or monthly cadence.

Do not promise complete market coverage, guaranteed lead volume, sales outcomes, or that a digital weakness causes lost revenue.

## Initial target customers

Start with one narrow B2B customer segment that already needs prospecting data:
- Small sales and marketing agencies
- B2B service providers selling to a defined industry
- Consultants or recruiters targeting specific business categories

The buyer should be able to explain how the report will be used in their sales or market-planning workflow.

## Minimum viable deliverable

Deliver a spreadsheet plus a short summary. Every material observation should include a source URL and a date checked.

Recommended columns:
- Business name
- Industry / niche
- City / service area
- Official website
- Public business source
- Public business contact route (only when clearly published)
- Website / visibility observation
- Social profile observation (only when verified)
- Opportunity category
- Why the business may be relevant
- Suggested next research step
- Evidence URL(s)
- Last checked
- Confidence / review status

Separate verified observations from hypotheses. A missing search result is not proof that a business has no website or social profile. Avoid collecting personal data unless necessary and appropriate.

## Sample report structure

### Market snapshot
- Scope: selected niche and geography
- Research date and sources
- Coverage limitations
- Number of businesses found, verified, and manually reviewed

### Priority opportunities
For each selected business:
- What was observed (factual, neutral)
- Source link
- Why it may matter to the buyer
- Recommended follow-up or opportunity
- Confidence and any caveats

### Dataset
A clean CSV/XLSX with source URLs, review status, and last-checked dates.

### Method and limitations
Explain public sources used, the date of research, what was not checked, and that rankings indicate research priority—not guaranteed commercial value.

## Pricing validation

Do not set permanent pricing before customer conversations. Test a one-off sample or pilot first, then offer a recurring weekly or monthly update if the customer finds the data useful. Price based on niche complexity, verified coverage, research depth, and refresh frequency.

## Shared engine, two use cases

1. Gullkornet internal mode: prioritize potential Cidea customers based on verified digital improvement opportunities.
2. Market-insight customer mode: build a source-backed niche dataset and opportunity report for a paying customer.

Reuse discovery, deduplication, public-source research, evidence tracking, and review logic. Keep customer datasets separated from Cidea's internal lead records and from SmartSvar production state.

## Pilot plan

1. Pick one niche and one geography.
2. Build a sample dataset of 20–30 businesses using existing discovery tools.
3. Manually verify a small subset and record evidence URLs.
4. Create a short, polished report and dataset.
5. Show it to 5 potential buyers and ask how they would use it, what is missing, and whether they would pay for a recurring update.
6. Automate only the parts proven useful by the pilot.

## Safety and operating boundaries

- No email sending is required for this pilot.
- Do not change DNS or MX records.
- Do not connect to SmartSvar production state.
- Do not overwrite or repurpose the existing Gullkornet lead registry for external customer datasets.
- Keep human review for customer-facing findings until accuracy is demonstrated.
- Follow source terms, applicable privacy rules, and reasonable request/rate limits.
