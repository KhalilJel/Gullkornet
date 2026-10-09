# Phase 9 — End-to-end integration

Status: IN PROGRESS
Last updated: 2026-10-09

## Objective

Connect discovery, enrichment, website intelligence, qualification and the OpenOutreach boundary into one observable, testable pipeline. Phase 9 does not enable unattended bulk sending.

## Existing integration surfaces

- KeeLead HTTP client: `src/integrations/keelead.ts`
- Website/digital-presence research: `src/integrations/digital-presence.ts`
- Website audit and public URL safety checks: `src/integrations/website-audit.ts`
- OpenOutreach JSONL ingestion and explicitly gated send client: `src/integrations/openoutreach.ts`
- Existing tests: KeeLead, digital presence, website audit and OpenOutreach.

## Integration acceptance sequence

1. Discover leads through KeeLead.
2. Normalize and deduplicate candidates.
3. Enrich and verify contact data; reject records without a valid business identity or usable contact.
4. Research website/digital presence using the existing public-URL-safe intelligence path.
5. Score leads and retain evidence. Do not infer that a company lacks social profiles merely because links were not detected on its homepage.
6. Generate drafts only when there is grounded personalization evidence; otherwise mark for review.
7. Pass eligible leads to OpenOutreach as JSONL.
8. Preserve suppression, pacing, draft gate, mailbox/lead state and send authorization inside OpenOutSend.
9. Keep sending disabled in automated integration tests. Use Resend's official test recipient for transport acceptance only.
10. Verify replies through Migadu IMAP and record outcomes before follow-up evaluation.

## Safety and runtime boundaries

- No secrets in GitHub.
- No DNS/MX changes.
- No Resend receiving.
- No automatic bulk sending during Phase 9/10.
- Live sending remains explicitly gated and bounded.
- Provider/source results must be validated; KeeLead demo or placeholder sources cannot be treated as production intelligence.

## Phase 9 completion criteria

- A single orchestration entrypoint invokes the components in the order above.
- Unit tests cover successful flow, duplicate leads, missing/invalid contact, weak evidence, suppression and OpenOutreach failure.
- CI passes.
- Runtime acceptance proves the deployed service path is wired correctly without sending to real prospects.
- Record evidence and commit hashes here. Phase 9 is not complete until all criteria pass.
