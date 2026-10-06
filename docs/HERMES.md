# Hermes Agent Integration

Status: Phase 1 — complete

Last updated: 2026-10-06

## Role

Hermes is the primary orchestrator for the Cidea AI layer. It owns agent context, memory, skills and delegation while specialized components provide internet research, crawling, browser actions and lead operations.

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

Nous Portal OAuth authentication was completed interactively through the Railway SSH session using:

`hermes setup --portal`

The Hermes runtime now reports:

- Nous Portal Auth: logged in
- Model: GPT-6 Astra through Nous inference
- Browser automation: Local browser

Credentials remain on the persistent Hermes volume and are not committed to GitHub.

## Web search

A free DDGS web-search backend was configured in the persistent Hermes configuration:

```yaml
web:
  backend: ddgs
```

The configuration was verified after `hermes setup` and after a Railway restart.

Functional web-search verification was completed twice:

1. Hermes searched for the official OpenAI website and returned `openai.com`.
2. After restart and a fresh SSH session, Hermes searched for the official Railway website and returned `railway.com`.

The second test verifies that the web-search configuration remained functional after restart.

## Runtime and persistence verification

The Hermes Railway service was explicitly restarted after provider and web configuration.

Post-restart Railway status:

- Service: Online
- Deployment: SUCCESS
- Running replicas: 1/1
- Crashed replicas: 0
- Active warnings: 0
- Active critical issues: 0
- Recent failures: 0
- Persistent volume attached: yes

A fresh SSH session was then opened and `hermes portal info` confirmed that Nous Portal authentication and the selected model persisted.

A fresh Hermes chat then successfully executed `web_search`, confirming that the persistent runtime configuration was usable after restart.

## Runtime note

The Hermes image's current entrypoint design uses an entrypoint dispatcher and s6 supervision. Railway currently starts the requested gateway command successfully, but the runtime logs a PID 1/init warning. The service remains healthy and online. This warning did not block gateway startup and did not prevent the Phase 1 verification tests from passing.

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
- [x] Configure Nous Portal authentication
- [x] Select GPT-6 Astra as the active model
- [x] Configure Local Browser
- [x] Configure DDGS web search
- [x] Run `hermes doctor` and apply available safe fix
- [x] Complete normal web-search chat
- [x] Restart Railway Hermes service
- [x] Verify auth/model persistence after restart
- [x] Verify web-search functionality after restart
- [x] Document verification result

Remaining non-blocking items:

- Optional setup of additional tools such as GitHub token, speech-to-text or paid managed tool providers is not required for the Phase 1 gate.

## Gate

Phase 1 is complete. Hermes can run in the intended Railway runtime, authenticate with Nous Portal, retain its persistent configuration across restart, and successfully perform web research after restart.

The locked implementation sequence can now proceed to Phase 2 — Agent Reach.

No Phase 3+ implementation is being started early.
