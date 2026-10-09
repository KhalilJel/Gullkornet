# Phase 9 — OpenOutSend runtime acceptance runbook

Status: DEPLOYED; partial acceptance passed; authorized synthetic ingest still pending
Last updated: 2026-10-09

## Live deployment and remaining acceptance

The existing Railway `openoutreach` service is now deployed as the authenticated ingest-only API. Deployment ID: `3a8e90f7-2a42-4236-a59e-9be77eefe24c` (SUCCESS). Source is pinned to `KhalilJel/Gullkornet` commit `048a6c955af11066a9438d039c08127fada95e6e` on branch `phase9/openoutsend-ingest-api`. Generated Railway domain: `https://openoutreach-production-ab8b.up.railway.app` on port 8080.

Verified so far: runtime `GET /health` returned 200, and an unauthenticated `POST /v1/leads` returned 401. The deployment includes Python bridge tests and Docker build verification. `OPENOUTREACH_ALLOW_SEND=false` is configured. No DNS/MX/custom-domain changes or real-prospect sends were made.

The repository still has no separate deployed Gullkornet orchestration service. Configure the generated HTTPS URL and the matching bearer token only in the actual Gullkornet execution environment when that environment is ready. Do not put the token in source, GitHub docs, logs, or chat.

## Applied deployment configuration

1. Existing `openoutreach` service points to `KhalilJel/Gullkornet`, branch `phase9/openoutsend-ingest-api`, pinned to commit `048a6c955af11066a9438d039c08127fada95e6e`.
2. Existing Dockerfile build retained; Python unit tests run during image build.
3. Start command: `python /app/openoutsend_ingest_api.py`.
4. Restart policy: `ALWAYS`; health check path: `/health`.
5. Generated Railway HTTPS domain: `https://openoutreach-production-ab8b.up.railway.app`, container port `8080`; no custom domain.
6. Fresh high-entropy `OPENOUTREACH_INGEST_TOKEN` set as a Railway runtime variable. Never commit it or print it to logs.
7. `OPENOUTREACH_ALLOW_SEND=false` is explicitly set. No sending switch was enabled.
8. Still pending: set `OPENOUTREACH_INGEST_URL` and the same token only in the actual environment that runs Gullkornet. No deployed orchestrator service currently exists.

Do not overwrite or recreate existing sealed credentials. Do not change SMTP/IMAP/Resend or DNS/MX settings for this step.

## No-send acceptance sequence

1. PASS: deployment reports SUCCESS; runtime logs confirm `GET /health` returned HTTP 200.
2. PASS: unauthenticated `POST /v1/leads` returned HTTP 401.
3. Bridge unit tests/build passed in CI and Docker build. Live malformed-payload rejection still needs HTTP acceptance.
4. PENDING: submit one authorized synthetic record using a reserved `example.invalid` email address; verify `mode: ingest_only`, `accepted: 1`, and `send_triggered: false`.
5. PENDING: confirm the synthetic record is stored with no outbound email generated. Remove it only through a documented supported data-management path if available.
6. PENDING: configure the orchestrator environment and run bounded dry-run; confirm Airtable review sync without sending.
7. Verify deployment logs contain no bearer token, email addresses, or draft bodies.

## Stop conditions

Stop and roll back if health checks fail, authentication can be bypassed, an ingest request triggers delivery, or the runtime attempts to send to any real prospect. Keep the existing send gate disabled.

## Current state

- Bridge unit tests and Docker build: passed in [workflow 37888603594](https://github.com/KhalilJel/Gullkornet/actions/runs/37888603594).
- TypeScript CI and KeeLead live acceptance: passed on commit `db6352222c055e1bc25139c9559ab47099f90fc0`.
- New documentation-only commits trigger another CI run; check the latest run before merging.
- Production bridge deployment: SUCCESS. Partial runtime acceptance: health 200 and unauthenticated POST 401. Authorized synthetic ingest and orchestrator dry-run: pending.
