# Phase 12 — Production-readiness review (Step 11)

Review date: 2026-10-10  
Repository: `KhalilJel/Gullkornet`  
Status: **REVIEW COMPLETE — NOT APPROVED FOR LIVE SENDING**

This is a read-only production-readiness review. It does not authorize or perform a send, change DNS/MX, modify Railway configuration, switch service branches, or deploy.

## Verified current state

- GitHub default branch is `main`; Phase 12 Step 10 was merged in PR #88 at `cdee7e4f0089ca957092c488f40c2f16b62e7569`.
- Railway project `powerful-patience`, production environment: 8 services listed, 0 services with health issues, 0 recent failures in the inspected 24-hour window, and no pending/staged work.
- `openoutreach` is online with 1/1 replicas. Latest deployment is `71dad39b-f961-4e9f-9b3b-23d0a76b9d55` (`SUCCESS`), from `KhalilJel/Gullkornet`, branch `phase11/production`, commit `30358eb488072a7893d385ac83cc78226486f768`. The service branch was not changed.
- Runtime logs show repeated `reply-monitor status=running error=none` messages through 2026-10-10 06:09 UTC.
- The latest Railway deployment is marked rollback-capable by Railway. No rollback was initiated.
- No environment variable values were read or changed in this review. The Phase 11 document records the operator's direct UI confirmation on 2026-10-09 that `OPENOUTREACH_ALLOW_SEND=false` and `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST=false`; those values were not independently reverified for this review.
- `.github/workflows/daily-outreach.yml` still hard-disables the sending job with `if: ${{ false }}`.
- OpenOutSend remains ingest-only. The adapter requires `mode=ingest_only` and `send_triggered=false` and exposes no send method.
- All five checks passed on the final Step 10 code/doc PR head before merge: `test`, `phase10`, `phase11-readiness`, `keelead-live-acceptance`, and `Synthetic non-sending acceptance`.

## Control review

| Area | Finding | Readiness |
|---|---|---|
| Access and runtime boundaries | GitHub workflow permissions for the synthetic acceptance are read-only. OpenOutSend runtime remains on its documented Phase 11 branch. No secrets were exposed. | Pass for current disabled state |
| Suppression | Sales engine fails closed if suppression lookup fails. Airtable upsert preserves suppression and terminal states. Single-send gate also checks the local suppression list and Airtable `Do Not Contact`. | Code controls present; live end-to-end send not exercised |
| Reply handling | Single-send gate checks authenticated reply status and blocks a recipient with a reply or an invalid/unavailable response. Runtime reply monitor is currently reporting healthy status. | Code/runtime evidence pass; no send authorized |
| Human approval | Single-send path requires exact recipient approval, Airtable `Lead Status=Approved`, `Review Status=Ready for outreach`, and `Do Not Contact=false`. Research outputs remain human-review-required. | Code controls present |
| Duplicate protection | Sales engine deduplicates candidates; Airtable review sync is idempotent and preserves protected states; sender checks Resend history and requires an idempotency key. | Controls present; key uniqueness remains an operator responsibility |
| Rate limits | Single-send policy is capped at 3 per run, 3/hour, and 10/day. Bulk sender remains hard-disabled. This does not authorize the future 50–100/day goal. | Conservative limits present; scaling not approved |
| Recovery | Provider read retries are bounded; ambiguous ingest/Airtable writes are not blindly retried. Latest Railway deployment is marked rollback-capable. | Recovery controls documented; no rollback exercised |
| Observability | Structured sales-engine events use correlation IDs, safe counts, stable failure categories, and `emailSent=0`. No centralized alerting or stale-monitor alert is implemented. | Partial; operational alerting is a follow-up |
| Dependency reproducibility | `package-lock.json` is committed on PR #93 and all ten workflows that install Node dependencies now use `npm ci`. All five required workflows passed on commit `7d5deb253332101a87c0e39c136f9976dd44807c`. | **Verified on PR branch; main remains unchanged until approved merge** |
| Data retention/privacy | PR #89 merged and changes Phase 10 artifacts to upload only the structured sales-engine log; the workflow still checks that local files were created. PR #93 records owner-approved internal retention defaults, conditional on confirming applicable Norwegian/EU requirements and provider capabilities before operational deletion. The policy is approved as an internal default; operational deletion remains unauthorized and unimplemented. | Artifact redaction merged; retention policy and deletion controls remain outstanding |
| CLI output | PR #93 (`fix/privacy-safe-cli-preview-2026-10-10`) removes recipient, subject, and draft body from stdout/stderr by default, suppresses recipient identifiers in draft-lookup errors and provider error details, and adds a dry-run-only local preview file with owner-only permissions and no-overwrite behavior. All five required acceptance/check workflows passed on PR head `949a0cd111dc45c464261b8a7c0ba07fc059e8a1` on 2026-10-10: CI, Phase 12 Dry-Run Acceptance, KeeLead Live Acceptance, Phase 10 End to End Testing, and Phase 11 Production Readiness. The PR remains open and unmerged; verify it is merged before treating the fix as present on `main`. | **Fix validated on PR branch; main remains unchanged until approved merge** |
| CRM retention | Internal default periods are documented and owner-approved in `docs/PROSPECT-DATA-RETENTION-POLICY.md`; legal/provider capability checks and operational deletion controls remain outstanding. | **Policy defaults approved; implementation and legal/provider checks required before deletion** |
| Live runtime flags | Connector inspection does not reveal current variable values; this review did not read or change them. The last operator-confirmed values are recorded in Phase 11. | Reverify directly in Railway UI before any separately approved live send |

## Required before any live pilot

1. Dependency lockfile and deterministic CI installation are implemented and verified on PR #93; ensure they reach `main` only after owner approval and merge.
2. Artifact redaction from PR #89 is merged; continue verifying that workflows do not upload raw prospect/draft JSON.
3. Confirm the approved internal schedule against applicable Norwegian/EU requirements and provider capabilities, then separately authorize and implement deletion/retention controls for Airtable, local artifacts, and provider/CI logs. The current policy does not authorize operational deletion.
4. Merge and verify PR #93 (privacy-safe sender CLI output and explicit local preview path) after owner approval; until merged, treat `main` as still containing the old log behavior.
5. Directly reverify both Railway safety flags in the Railway UI immediately before any separately authorized pilot; do not expose their values in logs or commits.
6. For each future single-recipient pilot, verify a fresh, unique idempotency key and exact recipient approval, suppression status, reply status, sender identity, and current rate limits.
7. Do not enable the scheduled/bulk sender or raise limits without a separate reviewed change and explicit authorization.

## Explicit exclusions and result

- No real prospect emails were sent.
- No DNS/MX changes, Railway configuration changes, branch switches, or deployments were performed.
- No secrets or runtime variable values were read into this report.
- Production sending remains **not approved**. The hard-disabled workflow and ingest-only boundary must remain unchanged.

Step 11 review is complete. PR #89 merged at `871bada745d6dda30ab7f798b5acd032861c89f8` after all five checks passed; Phase 10 artifacts now include only the structured sales-engine log, not raw review-queue or draft JSON. PR #90 merged at `711e4df1ad546dd28167c56884a2d8d884893b2c` and enabled Phase 12 synthetic acceptance on relevant pushes to `main`. Final-main synthetic acceptance, CI tests, and KeeLead acceptance passed on that commit.

Phase 12 is complete for controlled, non-sending dry-run acceptance only. Production sending remains **not approved** until all pre-pilot blockers listed above are addressed and a separate explicit authorization is given.


## Follow-up verification — 2026-10-10

- PR #93 adds sender CLI log redaction and an explicit `--preview-file <local-path>` dry-run preview. The preview file is created with mode `0600` where supported and refuses to overwrite an existing file. Live-send and preview-file options cannot be combined.
- Added synthetic coverage for log redaction, local preview contents and permissions, overwrite prevention, incompatible flags, recipient redaction on draft lookup failures, and provider error-body redaction.
- GitHub Actions verification on PR head `7d5deb253332101a87c0e39c136f9976dd44807c` completed successfully: CI, Phase 12 Dry-Run Acceptance, KeeLead Live Acceptance, Phase 10 End to End Testing, and Phase 11 Production Readiness all report `success` (run IDs: `38060028861`, `38060028848`, `38060028841`, `38060028835`, `38060028868`).
- PR #93 remains unmerged pending explicit owner approval. No production email, DNS/MX, Railway configuration, or deployment actions were performed.
- The package lockfile and `npm ci` workflow changes are on the PR branch and all five required workflows passed on commit `d3f152882b7d863ee1879779042721da67853be5`. Remaining blockers include owner approval and implementation of the proposed prospect/research/draft retention and deletion policy in `docs/PROSPECT-DATA-RETENTION-POLICY.md`. Live sending remains not approved.


- Dependency reproducibility follow-up: generated a real npm lockfile using GitHub Actions with `--package-lock-only --ignore-scripts`; committed it to the PR branch and changed all ten workflows that ran `npm install` to `npm ci`. No dependency lifecycle scripts ran during lockfile generation. CI, Phase 12 Dry-Run Acceptance, Phase 11 Production Readiness, Phase 10 End to End Testing, and KeeLead Live Acceptance all passed on commit `d3f152882b7d863ee1879779042721da67853be5`.

- Additional privacy review found that a missing draft could echo the requested recipient and that Resend error messages could include provider-supplied details. Both paths now emit generic errors; regression tests verify recipient and message metadata are not propagated. All five workflows passed on `7d5deb253332101a87c0e39c136f9976dd44807c`.


- Additional CLI privacy review: post-send Airtable state-update failures now return a reconciliation warning without echoing provider/CRM error details, which could contain prospect data. A regression test guards against reintroducing detailed error output. This change remains on PR #93 until separately approved and merged; no live send was performed.


- Retention-policy decision (2026-10-10): owner approved the proposed periods as internal defaults, subject to confirming applicable requirements and provider capabilities before operational deletion. PR #93 now changes `.github/workflows/contact-research-drafts.yml` from uploading raw prospect/draft JSON and a review queue for 30 days to uploading only aggregate metadata with a 7-day expiry. This change is on the PR branch pending CI/merge. Airtable/local retention and deletion automation remain unimplemented. The daily sender remains hard-disabled; its former artifact input is intentionally not restored, and any future sender reactivation needs a separate reviewed transfer design and explicit authorization.

- Artifact-retention follow-up: Google-discovery, website-audit, and digital-presence research artifacts now expire after 7 days instead of 30. They still contain business/prospect research data because they are current workflow handoffs; this is a documented transitional gap, not full compliance with the metadata-only target. The contact-research workflow now uploads only aggregate metadata with a 7-day expiry. Redesign the remaining handoffs and implement Airtable/local retention controls before any live pilot. The scheduled sender remains hard-disabled and its previous raw-draft artifact is no longer produced.

## Follow-up artifact minimization — 2026-10-10

- Phase 10 End to End Testing completed successfully on prior PR head `31d18db6ac95769186bd6ef38229eaf6ae41a197`; the five required workflows passed on that head before the latest artifact-minimization commits.
- Google discovery now projects its artifact to an allowlist: company name, website URL, city, industry, and source URL. Discovery history remains in the cache for deduplication but is no longer included in the uploaded artifact.
- Digital-presence research now uploads aggregate counts and a timestamp only; raw result rows remain transient within the runner and are not uploaded as an artifact.
- Contact research continues to upload only aggregate metadata. Website audit still hands off minimized candidate fields and structured audit signals to downstream research for functional continuity; it expires after 7 days and contains no raw HTML. This remains a prospect-data artifact and needs a future persistent, access-controlled handoff design before live outreach.
- The retention policy now distinguishes approved internal defaults from implementation status. Airtable/local deletion and provider log-retention controls remain unimplemented. No automatic deletion, live sending, DNS/MX changes, Railway changes, or deployment was performed.
- These latest changes are on PR #93 and require fresh CI/acceptance verification. PR remains open and unmerged pending explicit owner approval.

## Audit handoff minimization follow-up — 2026-10-10

- Website Audit now uploads only `website-audit.json`; the duplicate `google-candidates.json` artifact file was removed.
- Contact Research and Digital Presence reconstruct their minimal candidate input (company name, website URL, city, industry, source URL) from the audit records inside their runner, with restrictive local file mode where supported. This avoids storing a second copy in the cross-workflow artifact while preserving downstream processing.
- The single audit handoff still contains business/prospect data and structured audit signals and expires after 7 days. It does not contain raw HTML. This is a minimization improvement, not full metadata-only compliance; persistent, access-controlled transfer and Airtable/local deletion controls remain open blockers.
- These changes are on PR #93 and require fresh CI and acceptance verification. PR remains open and unmerged; no live sending, DNS/MX, Railway configuration, or deployment actions were performed.


## Latest verification — 2026-10-10

- On PR head `a0be791f3f2d0d2b0f6da7702ea5b2d396032073`, all five required workflows passed: CI (`38063682923`), Phase 10 End to End Testing (`38063682928`), Phase 11 Production Readiness (`38063682930`), Phase 12 Dry-Run Acceptance (`38063682876`), and KeeLead Live Acceptance (`38063682926`).
- PR #93 remains open and unmerged pending explicit owner approval. The scheduled sender remains hard-disabled; no real prospect emails, DNS/MX changes, Railway configuration changes, or deployments were performed.
- Internal retention defaults are approved, but automatic deletion is not authorized or implemented. Before any operational deletion, confirm applicable Norwegian/EU requirements and provider capabilities. The website-audit handoff still contains minimized prospect data and structured audit signals; a persistent access-controlled transfer design remains a pre-pilot blocker.
- Retention timestamp review found that Airtable `Last Seen` is rewritten on every sync and does not reliably mean meaningful activity. Do not use it alone to determine deletion eligibility; define and test a separate `Last Meaningful Activity` rule before any retention automation.
- `docs/ACCESS-CONTROLLED-PROSPECT-HANDOFF-DESIGN.md` now records the preferred migration: consolidate discovery, website audit, and contact research into one ephemeral runner job and upload only aggregate metadata. This is design-only; current artifact workflows remain unchanged until a replacement passes acceptance.
