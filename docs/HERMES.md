# Hermes Agent Integration

Status: Phase 1 — in progress

Last updated: 2026-10-06

## Role

Hermes is the primary orchestrator for the Cidea AI layer. It will own agent context, memory, skills and delegation while specialized components provide internet research, crawling, browser actions and lead operations.

## Upstream

Official project: https://github.com/NousResearch/hermes-agent

Official documentation: https://hermes-agent.nousresearch.com/docs/

Current upstream guidance says to get one clean normal chat working before adding gateway, cron, skills, voice or routing.

## Railway staging

A dedicated `hermes-agent` service has been staged in the existing Railway `powerful-patience` production environment using:

`nousresearch/hermes-agent:latest`

Persistent Hermes data is staged at:

`/opt/data`

The current Railway plan permits a maximum 500 MB volume, so the staged Hermes volume is 500 MB. This can be expanded later if the plan permits.

**The staged changes have not been deployed.** No production deployment or external action was triggered in this phase.

## Provider setup

Hermes requires a configured model/provider before the clean-chat verification gate can pass.

The preferred path is to use Hermes' supported setup flow. Current Hermes documentation describes `hermes setup --portal` as the fastest path when using Nous Portal; it configures the provider and tool gateway through OAuth.

Credentials must be configured as runtime secrets/auth files and must never be committed to GitHub.

## Phase 1 checklist

- [x] Define Hermes role
- [x] Create dedicated staged Railway service
- [x] Stage persistent Hermes data volume
- [x] Document installation/runtime boundary
- [ ] Commit/accept Railway staged changes after explicit deployment approval
- [ ] Configure model/provider
- [ ] Start Hermes
- [ ] Run `hermes doctor`
- [ ] Complete one normal clean chat
- [ ] Verify persistent data location
- [ ] Document verification result
- [ ] Pass Phase 1 gate

## Gate

Phase 1 is complete only when Hermes can successfully complete a normal chat in the intended runtime and the result is documented in GitHub.

No Agent Reach, Firecrawl, JEV, TypeSafe, KeeLead or OpenOutreach implementation starts before this gate is passed.