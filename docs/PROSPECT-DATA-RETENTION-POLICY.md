# Prospect Data Retention and Deletion Policy — Proposal

Status: **PROPOSED — OWNER APPROVAL REQUIRED BEFORE OPERATIONAL ADOPTION**  
Last reviewed: 2026-10-10  
Scope: Gullkornet prospect discovery, website research, contact research, review queues, outreach drafts, Airtable CRM, local artifacts, and GitHub Actions logs/artifacts.

This proposal is a default minimization schedule for review. It does not authorize live outreach or change any provider configuration.

## Principles

- Store only data needed to evaluate a business opportunity, manage approval/suppression, and deliver an explicitly agreed service.
- Prefer business-level facts and source URLs over unnecessary personal information.
- Do not store secrets, credentials, or full email bodies in logs.
- Keep suppression records long enough to honor opt-outs and prevent re-contact; minimize the record to the fields needed to enforce suppression.
- Apply deletion to all controlled copies, not just the primary CRM record. Provider backups and immutable Git history may have separate limits.

## Proposed retention schedule

| Data class | Proposed default retention | Required handling |
|---|---|---|
| Unqualified discovery candidates | 30 days from last meaningful activity | Delete or re-evaluate; keep only minimal deduplication fields if necessary |
| Website/contact research and evidence | 90 days from last meaningful activity | Retain source URL, observation date, and relevant business-level finding; remove stale or irrelevant personal details |
| Unsent outreach drafts and local review-queue files | 30 days after creation, or 7 days after rejection | Delete local files after the review window; do not upload raw drafts as CI artifacts |
| Approved prospect/outreach record | 90 days after last meaningful activity unless an active client engagement or documented business need requires longer | Review before extending; do not infer permission to contact from retention alone |
| Delivery/provider diagnostic logs | 30 days where configurable | Log event IDs, status, counts, and safe error categories; avoid recipient addresses and message bodies |
| GitHub Actions artifacts | No raw prospect or draft content; metadata-only artifacts expire at the shortest practical configured window (target 7 days) | Confirm workflow artifact retention settings; the policy does not change them automatically |
| Suppression / do-not-contact record | Retain while needed to prevent future contact; review annually | Store only minimal identifier, suppression reason/source, and timestamp; never delete merely because other prospect data expires |
| Client data handled under a CIDEA Leads contract | Contract-specific documented schedule | Contract terms and applicable legal requirements take precedence; define deletion/return at engagement end |

These are proposed internal defaults, not a statement of statutory retention periods or legal advice.

## Deletion procedure

1. Mark the prospect as suppressed or deletion-pending as appropriate before removing operational records, so deletion does not accidentally permit re-contact.
2. Delete or anonymize the record in Airtable and remove matching local files and exports.
3. Remove related drafts/research files and any other controlled copies identified in the workflow.
4. Confirm GitHub Actions does not upload raw prospect/draft JSON. If sensitive data was committed to Git, treat it as an incident: revoke exposed credentials if any, restrict access, and use the repository's approved history-remediation process.
5. Record only a minimal deletion audit entry: internal record ID, data classes deleted, date, outcome, and any provider limitation. Do not copy the deleted personal data into the audit log.
6. If a provider backup or immutable log cannot be immediately purged, record the limitation and its expiry/remediation date.

## Operational controls

- Data retention must not override consent, objection, suppression, contract, or legal requirements.
- No live outreach is permitted by this document.
- Before adoption, the owner must approve the retention periods and confirm the schedule against the intended CIDEA Leads service, provider capabilities, and applicable Norwegian/EU privacy requirements.
- Implementation must be tracked separately; documenting a policy does not automatically delete existing records or configure provider retention.

## Approval record

- Owner approval: **PENDING**
- Implementation status: **NOT IMPLEMENTED**
- Next review: after owner approval and before any live outreach pilot
