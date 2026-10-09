# Phase 9 — OpenOutSend runtime acceptance runbook

Status: PREPARED, NOT DEPLOYED
Last updated: 2026-10-09

## Why this step is still blocked

The OpenOutSend ingest bridge is tested in CI, but the existing Railway `openoutreach` service still starts `outsend check`, uses restart policy `NEVER`, and has no service domain. The TypeScript client cannot reach a live `/v1/leads` endpoint yet.

The repository currently has no separate deployed Gullkornet orchestration service. The orchestrator is invoked from the repository runtime/CI. Therefore a Railway private-only hostname would not be reachable from GitHub-hosted runners. If the orchestrator continues to run outside Railway, use the generated HTTPS Railway service domain with bearer-token authentication. Do not add a custom domain or change DNS/MX.

## Deployment changes to the existing service

Only after the deployment is explicitly approved:

1. Point the existing `openoutreach` service at `KhalilJel/Gullkornet`, branch `phase9/openoutsend-ingest-api`.
2. Keep the existing Dockerfile build.
3. Set the start command to `python /app/openoutsend_ingest_api.py`.
4. Set restart policy to `ALWAYS`.
5. Expose container port `8080` using a generated Railway service domain only; do not attach a custom domain.
6. Set a newly generated, high-entropy `OPENOUTREACH_INGEST_TOKEN` as a sealed/runtime secret. Never commit it or print it to logs.
7. Explicitly set `OPENOUTREACH_ALLOW_SEND=false` for the acceptance deployment. Do not enable any sending switch.
8. Set `OPENOUTREACH_INGEST_URL` and the same token in the environment that runs Gullkornet. Keep the URL in environment configuration, not source code.

Do not overwrite or recreate existing sealed credentials. Do not change SMTP/IMAP/Resend or DNS/MX settings for this step.

## No-send acceptance sequence

1. Confirm deployment reports SUCCESS and `GET /health` returns `200` with `ok: true`.
2. Confirm `POST /v1/leads` without a bearer token returns `401`.
3. Confirm malformed content and invalid records are rejected before the `outsend` command is invoked.
4. Submit one synthetic test record with a unique `lead_id` and a reserved `example.invalid` email address. The endpoint must return `mode: ingest_only`, `accepted: 1`, and `send_triggered: false`.
5. Confirm the synthetic record is present in OpenOutSend's queue/state, with no outbound email generated. Remove the synthetic record using the supported OpenOutSend data-management path if available; do not directly modify the database without a documented supported operation.
6. Run the Gullkornet orchestrator in dry-run mode against bounded test inputs and confirm Airtable review records are written without sending.
7. Verify deployment logs contain no bearer token, email addresses, or draft bodies.

## Stop conditions

Stop and roll back if health checks fail, authentication can be bypassed, an ingest request triggers delivery, or the runtime attempts to send to any real prospect. Keep the existing send gate disabled.

## Current state

- Bridge unit tests and Docker build: passed in [workflow 37888603594](https://github.com/KhalilJel/Gullkornet/actions/runs/37888603594).
- TypeScript CI and KeeLead live acceptance: passed on commit `db6352222c055e1bc25139c9559ab47099f90fc0`.
- New documentation-only commits trigger another CI run; check the latest run before merging.
- Production deployment and runtime acceptance: not done.
