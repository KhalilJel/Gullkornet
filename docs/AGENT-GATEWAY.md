# Agent gateway: making Hermes callable (proposal + tested code)

Status (2026-10-13): **implemented and unit-tested with mocked Hermes; not deployed, not verified against a live Hermes.** No Railway variable is changed and the Hermes API is still off. Until the verification sequence below passes, no browser agent is "active".

## Problem

GitHub Actions can only reach public HTTPS. Hermes (with Agent Reach, JEV Ultrafast, Browser Use) runs in the Railway service `hermes-agent` with no public domain and must never get one. Railway's private network (`*.railway.internal`) is only reachable from other Railway services.

## Smallest architecture

One new thin Railway service, `agent-gateway`, in the same project and environment:

```
GitHub Actions --HTTPS + bearer--> agent-gateway --private net--> hermes-agent:8642 (OpenAI-compatible API)
```

- The gateway is the only new public surface. It exposes `/health`, `/health/hermes` and `/v1/browse` only.
- Callers cannot send prompts. The gateway fixes the read-only instructions, accepts only `{url, engine}`, and applies the pipeline's public-URL check (`isSafePublicUrl`) first. Results are schema-validated and size-capped; page text is treated as data.
- Hermes stays private. The gateway refuses a `HERMES_API_URL` that is not `.railway.internal` or loopback.
- TypeSafe is not called directly: it only offers JEV models and has no role of its own. Agent Reach is reached through Hermes' own tools, not by the gateway.

Code (tested, inactive): `src/gateway/agent-gateway.ts`, `src/cli/agent-gateway-server.ts`, `src/integrations/agent-gateway-client.ts`; wired optionally in `src/cli/research-contacts.ts` (only when `AGENT_GATEWAY_URL` and `AGENT_GATEWAY_TOKEN` are both set; otherwise behaviour is unchanged and the router keeps recording `escalation_needed`).

## Environment variables (for later, by you)

| Where | Variable | Value |
|---|---|---|
| hermes-agent | `API_SERVER_ENABLED` | `true` |
| hermes-agent | `API_SERVER_HOST` | `::` or `0.0.0.0` (needed for the private network; default 127.0.0.1 is unreachable from other services) |
| hermes-agent | `API_SERVER_KEY` | long random value, Railway only |
| hermes-agent | `PORT`/port | 8642; **no public domain** |
| agent-gateway | `HERMES_API_URL` | `http://hermes-agent.railway.internal:8642` |
| agent-gateway | `HERMES_API_KEY` | same value as `API_SERVER_KEY` (Railway variable reference) |
| agent-gateway | `AGENT_GATEWAY_TOKEN` | separate long random value (>= 24 chars) |
| agent-gateway | start command | `npx tsx src/cli/agent-gateway-server.ts` |
| GitHub (later) | secret `AGENT_GATEWAY_TOKEN`, variable `AGENT_GATEWAY_URL` | token + gateway public https URL |

Access limits: the gateway holds no Firecrawl, Airtable, Resend or OpenOutSend credentials. It cannot send mail or write data. The GitHub token only unlocks `/v1/browse` and `/health/hermes`.

## Verification sequence (nothing runs until you do each step)

1. Enable the Hermes API; confirm in Railway that hermes-agent has no public domain.
2. From a Railway shell on a *different* service: `curl -H "Authorization: Bearer $HERMES_API_KEY" http://hermes-agent.railway.internal:8642/v1/models` returns 200. Without the header: 401. The same URL from your laptop must fail.
3. Deploy agent-gateway; `GET /health` -> `{"ok":true}`; `GET /health/hermes` without token -> 401, with token -> `hermesReachable:true`.
4. `POST /v1/browse` with a fixed public page: expect `status:"success"` with evidence. Check that a private-IP URL returns `blocked`.
4b. Rebinding test: point a rebinding test domain (first answer public, then 127.0.0.1/169.254.169.254) at `/v1/browse`; expect `blocked`, and check Hermes could not read an internal service.
5. Only then add the GitHub secret/variable. Whether Hermes actually picks JEV vs Browser Use from the `engine` hint is **unverified**; step 4 must show which tool ran in Hermes' logs.

## Security limits implemented (all covered by `tests/agent-gateway.test.ts`)

- Bearer token (>= 24 chars, constant-time compare); `/health` reveals only liveness.
- Only `{url, engine}` is accepted; fixed read-only prompt; the URL is normalised before it enters the prompt.
- Public-URL check before the call, and again on `finalUrl` and the original URL after the call.
- Result schema validation, evidence capped at 20 x 4000 chars; max 2 concurrent browse calls (429), body <= 2 KB, header/request timeouts, Hermes call timeout 80 s.
- Logs: method, path, status, duration, engine, host only.
- Research flow (`src/integrations/research-deps.ts`): the gateway is wired only when `AGENT_GATEWAY_URL` (https) **and** `AGENT_GATEWAY_TOKEN` are both set. Otherwise the run prints `[research] Browser escalation: OFF (...)` and the router records `escalation_needed`. Qualification, DNC, duplicate, reply, reservation, evidence and send limits are untouched: evidence from the gateway goes through the same evidence model.

## DNS rebinding: what is and is not solved

- **Detected, not prevented:** the gateway re-resolves the host after Hermes has fetched and discards the evidence (`DNS_REBINDING_SUSPECTED`) if it is no longer public.
- **Not solved in this repository:** the fetch itself happens inside the Hermes container. Preventing a rebound fetch needs egress filtering at that network layer (block private, link-local and `*.railway.internal` ranges from Hermes' browser/terminal tools, or run those tools through a pinned-IP proxy). That requires Railway/Hermes configuration and cannot be implemented or verified from here. Verification step 4b tests it.

## Open risks

- Hermes' API model name and exact `/v1/models` health behaviour are assumed from upstream docs ("OpenAI-compatible") and not yet tested against the live container.
- Browser steps take tens of seconds; the client timeout is 90 s and the router already limits browser escalation per run.
