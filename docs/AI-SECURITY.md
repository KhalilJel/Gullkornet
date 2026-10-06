# AI Layer Security and Operating Guardrails

Status: Phase 0 — locked

## Non-negotiable guardrails

- No DNS changes.
- No MX changes.
- No email infrastructure migration.
- No production bulk sending during implementation.
- DRY_RUN remains enabled unless a later phase explicitly passes its production gate.
- API keys, tokens, passwords and cookies must never be committed to GitHub.
- Use environment variables or runtime secret stores.
- Browser agents must not be given unnecessary credentials or account access.
- External actions require explicit tool-level boundaries and verification.
- Customer/prospect data must remain separated from unrelated datasets.
- Every automated action must be observable through logs or artifacts where practical.

## Outreach safety

The AI layer may research, qualify and draft before production sending is approved.

Before any live sending phase, verify:
- duplicate protection
- suppression / do-not-contact handling
- reply detection
- retry behavior
- rate limits
- audit logging
- failure handling

## Change discipline

Implementation follows the locked plan. If a blocker is found, resolve it within the current phase rather than changing architecture or adding unrelated tools.

Relevant architectural and operational decisions must be documented in GitHub.
