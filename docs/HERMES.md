# Hermes Agent Integration

Status: Phase 1 — in progress

Last updated: 2026-10-06

## Role

Hermes is the primary orchestrator for the Cidea AI layer. It will own agent context, memory, skills and delegation while specialized components provide internet research, crawling, browser actions and lead operations.

## Upstream

Official project: https://github.com/NousResearch/hermes-agent

Official documentation: https://hermes-agent.nousresearch.com/docs/

Hermes upstream currently recommends configuring one provider and verifying a normal chat before expanding the runtime.

## Railway deployment

A dedicated `hermes-agent` service is live in the existing Railway `powerful-patience` production environment using:

`nousresearch/hermes-agent:latest`

Persistent Hermes data is mounted at:

`/opt/data`

The current Railway plan permits a maximum 500 MB volume, so the live Hermes volume is 500 MB.

Current runtime verification:

- Railway service state: LIVE
- Latest deployment: `095f8e00-9f94-4f24-a4c7-0e3535f195b3`
- Deployment status: SUCCESS
- Running replicas: 1/1
- Restart policy: ALWAYS
- Gateway command: `hermes gateway run`
- No public domain is configured
- No DNS or MX changes were made

The gateway reaches its startup state successfully. Railway reports no active service warnings or critical issues.

## Provider setup

The remaining Phase 1 blocker is provider authentication.

The current Hermes runtime reports that Nous Portal authentication is missing:

`Nous Portal runtime credentials unavailable`

`run hermes model to re-authenticate`

`run hermes auth`

Hermes documentation confirms that `hermes setup --portal` performs the Nous OAuth flow and persists the refresh token under `~/.hermes/auth.json`. This interactive OAuth step cannot be completed through the available Railway connector because it has no interactive container terminal/browser session.

Credentials must never be committed to GitHub.

## Runtime note

The Hermes image's current entrypoint design uses an entrypoint dispatcher and s6 supervision. Railway currently starts the requested gateway command successfully, but the runtime logs a PID 1/init warning. The service remains healthy and online. This warning is not currently blocking gateway startup, so it is not being treated as a separate Phase 1 gate failure.

## Phase 1 verification

Completed:

- [x] Define Hermes role
- [x] Create dedicated Railway service
- [x] Persistent Hermes data volume mounted
- [x] Deploy gateway runtime
- [x] Verify successful Railway deployment
- [x] Verify service remains online
- [x] Verify no public domain is configured
- [x] Verify no DNS/MX changes were made

Remaining:

- [ ] Configure model/provider authentication
- [ ] Run `hermes doctor`
- [ ] Complete one normal clean chat
- [ ] Verify persisted auth/config state after restart
- [ ] Document clean-chat result
- [ ] Pass Phase 1 gate

## Gate

Phase 1 is complete only when Hermes can successfully complete a normal chat in the intended runtime and the result is documented in GitHub.

No Agent Reach, Firecrawl, JEV, TypeSafe, KeeLead or OpenOutreach implementation starts before this gate is passed.
