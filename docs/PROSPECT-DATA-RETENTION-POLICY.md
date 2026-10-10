# Prospect Data Retention and Deletion Policy

Status: **INTERNAL DEFAULTS APPROVED; operational deletion not yet authorized**  
Last reviewed: 2026-10-10  
Scope: Gullkornet prospect discovery, website research, contact research, review queues, outreach drafts, Airtable CRM, local artifacts, and GitHub Actions logs/artifacts.

The schedule below records the owner's internal defaults. It does not authorize live outreach or automatic deletion. Confirm applicable Norwegian/EU requirements and provider capabilities before operational deletion is enabled.

## Principles

- Store only data needed to evaluate a business opportunity, manage approval/suppression, and deliver an explicitly agreed service.
- Prefer business-level facts and source URLs over unnecessary personal information.
- Do not store secrets, credentials, or full email bodies in logs.
- Keep suppression records long enough to honor opt-outs and prevent re-contact; minimize the record to the fields needed to enforce suppression.
- Apply deletion to all controlled copies, not just the primary CRM record. Provider backups and immutable Git history may have separate limits.

## Approved internal retention defaults

| Data class | Internal default retention | Required handling |
|---|---|---|
| Unqualified discovery candidates | 30 days from last meaningful activity | Delete or re-evaluate; keep only minimal deduplication fields if necessary |
| Website/contact research and evidence | 90 days from last meaningful activity | Retain source URL, observation date, and relevant business-level finding; remove stale or irrelevant personal details |
| Unsent outreach drafts and local review-queue files | 30 days after creation, or 7 days after rejection | Delete local files after the review window; do not upload raw drafts as CI artifacts |
| Approved prospect/outreach record | 90 days after last meaningful activity unless an active client engagement or documented business need requires longer | Review before extending; do not infer permission to contact from retention alone |
| Delivery/provider diagnostic logs | 30 days where configurable | Log event IDs, status, counts, and safe error categories; avoid recipient addresses and message bodies |
| GitHub Actions artifacts | No raw prospect or draft content; metadata-only artifacts expire at the shortest practical configured window (target 7 days) | Confirm workflow artifact retention settings; the policy does not change them automatically |
| Suppression / do-not-contact record | Retain while needed to prevent future contact; review annually | Store only minimal identifier, suppression reason/source, and timestamp; never delete merely because other prospect data expires |
| Client data handled under a CIDEA Leads contract | Contract-specific documented schedule | Contract terms and applicable legal requirements take precedence; define deletion/return at engagement end |

These are internal defaults, not statutory retention periods or legal advice.

## Deletion procedure

1. Mark the prospect as suppressed or deletion-pending as appropriate before removing operational records, so deletion does not accidentally permit re-contact.
2. Delete or anonymize the record in Airtable and remove matching local files and exports.
3. Remove related drafts/research files and any other controlled copies identified in the workflow.
4. Confirm GitHub Actions does not upload raw prospect/draft JSON. If sensitive data was committed to Git, treat it as an incident: revoke exposed credentials if any, restrict access, and use the repository's approved history-remediation process.
5. Record only a minimal deletion audit entry: internal record ID, data classes deleted, date, outcome, and any provider limitation. Do not copy the deleted personal data into the audit log.
6. If a provider backup or immutable log cannot be immediately purged, record the limitation and its expiry/remediation date.

## Timestamp semantics and deletion safety

- The current Airtable review-sync implementation writes `Last Seen` on each sync. A sync/rediscovery is not necessarily meaningful activity by the prospect or a human operator.
- Do **not** use `Last Seen` alone to determine that a record has reached its retention deadline or is eligible for deletion.
- Before any retention automation, define and test an explicit `Last Meaningful Activity` rule (for example, a human review/status transition, reply, or documented client activity), including how suppressed records and active client engagements are handled.
- A dry-run inventory should report aggregate counts and record IDs only where access-controlled; it must not delete or mutate records. Deletion remains disabled until legal/provider checks and separate authorization are complete.

## Operational controls

- Data retention must not override consent, objection, suppression, contract, or legal requirements.
- No live outreach is permitted by this document.
- Confirm the schedule against the intended CIDEA Leads service, provider capabilities, and applicable Norwegian/EU privacy requirements before operational deletion.
- Implementation must be tracked separately; documenting a policy does not automatically delete existing records or configure provider retention.

## Approval record

- Owner approval: **APPROVED AS INTERNAL DEFAULTS on 2026-10-10**, subject to confirming applicable Norwegian/EU requirements and provider capabilities before operational deletion is enabled.
- Implementation status: **PARTIAL**. Contact research now uploads only an aggregate summary. Google discovery now uploads only an allowlisted candidate shape and does not upload discovery history. Digital-presence research now uploads only aggregate metadata. Website-audit artifacts still contain the minimum candidate handoff plus structured audit signals because the downstream contact-research workflow depends on them. Airtable/local retention, deletion automation, and provider log retention are **NOT IMPLEMENTED**.
- Next review: before implementing operational deletion and before any live outreach pilot.

## Implementation boundary

The scheduled sender remains hard-disabled. Its old raw-draft artifact input is intentionally not provided; enabling that job without a separately reviewed data-transfer design must fail closed. Local workflow files and Airtable records are not automatically deleted by artifact minimization.

## Current implementation status — 2026-10-10

- Contact-research workflow uploads only aggregate counts and a timestamp, with a 7-day expiry; raw contact-research drafts and the review queue are not uploaded.
- Google discovery artifact is now limited to company name, website URL, city, industry, and source URL. Discovery history remains in the workflow cache for deduplication but is not uploaded as a workflow artifact.
- Digital-presence workflow now uploads only aggregate metadata with a 7-day expiry; raw research rows are not uploaded.
- Website-audit workflow now uploads one handoff file rather than both the audit output and a duplicate candidate JSON. Downstream workflows reconstruct the minimal candidate input from the audit records. The single handoff still contains business/prospect data and structured audit signals, with a 7-day expiry; no raw page HTML is stored. A persistent, access-controlled data-transfer design is still needed before a live pilot.
- The sender remains hard-disabled. Its prior raw-draft artifact is no longer produced.
- Airtable/local-file retention and deletion automation, plus provider log-retention configuration, remain unimplemented. No automatic deletion is enabled by this policy.
