# Go-live runbook: base pipeline first, agents later

Status (2026-10-13): written from the repository and GitHub state. Nothing below has been run. Every step marked **YOU** needs the owner's access or decision. The base pipeline does not depend on Firecrawl, Hermes, the agent gateway or any other agent.

Pipeline that goes live: Google Places discovery -> built-in website fetch -> evidence-based research -> Airtable (review fields) -> Airtable AI assessment -> sender (`Gullkornet Daily Outreach`) with all gates. Operating rules are unchanged (`docs/AUTONOMOUS-AI-OUTREACH.md`): sender `hello@cideamarketing.com`, weekdays 09:00-15:00 Europe/Oslo, >= 5 min apart, 1 per run, 12/hour, hard cap 100 per Oslo day (window allows 72; target 50 when the qualified queue supports it), one first message per company, no automatic follow-ups, DNC / duplicate / reply / reservation / evidence / `STRATEGIC_ACCOUNT` gates stay.

## Order of actions

1. **YOU: merge PR #100** (it contains #98 and #99; they add nothing of their own and can be closed afterwards). CI on `main` must go green.
2. **YOU: deploy `openoutreach` from `main`** (Railway, "Wait for CI"). Live send stays off: `OPENOUTREACH_ALLOW_SEND`, `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST` and `GULLKORNET_OPENOUTSEND_DELIVERY_ENABLED` false or unset. Keep deployment `71dad39b-f961-4e9f-9b3b-23d0a76b9d55` as rollback. Set `OPENOUTREACH_REPLY_STATUS_TOKEN` (>= 32 chars, different from the ingest token) in Railway.
3. **Verify the reply service** with the four checks in `docs/LAUNCH-READINESS.md` ("Reply-check verification order"): `/health` and `OUTSEND_SEND_LOCK=verified` in the build log; unknown address -> `replied:false`; controlled reply from a throwaway address to `hello@` -> `replied:true` (this also proves the Migadu alias reaches the monitored mailbox); read-only token on `POST /v1/leads` -> `401`. This sends no outreach; the controlled reply is mail *to* us.
4. **Controlled research run** (no e-mail is involved). Use **`Gullkornet Unified Lead Research (Manual)`**, which is already active and runs Google Places discovery, website audit and `research:contacts` in one job with the built-in fetch. `Gullkornet Contact Research and Drafts` stays disabled on purpose; it is not needed for this step and should only be re-enabled later, deliberately, if you want research to chain automatically after each Website Audit.
   - First run: `daily_lead_limit` 10-25, `sync_to_airtable` **false**. Read the aggregate summary only; fix anything odd.
   - Second run: same limits, `sync_to_airtable` **true**. This is the first production Airtable write; it only creates/updates research and review fields and resets any old AI approval.
   - The log prints `[research] Firecrawl fallback: OFF ...` and `Browser escalation: OFF ...` when those are not configured. That is expected and not an error.
5. **Verify Airtable rules on the synced rows** (before any assessment): `Do Not Contact` exists as a checkbox on Leads; a row with it ticked, a second row on the same business domain, and an address that has replied are all refused by the sender's approval check (covered by `tests/airtable-send-approval.test.ts`; confirm on real rows with a read-only look at the review queue, not by sending).
6. **YOU: AI Assessment, last.** Follow `docs/AIRTABLE-AI-ASSESSMENT.md`: switch the trigger to "When a record matches conditions" (the current update trigger does not fire for rows the sync creates), Run test on the single `Draft Ready` row, check it with `npm run send:preview`, then publish. Sending is decided by the code gates, not by the AI (`tests/send-gates.test.ts`).
7. **Dry check of the sender with the switch still off:** the next scheduled `Gullkornet Daily Outreach` run must show "live sending kill switch is off". Confirm `OPENOUTREACH_REPLY_STATUS_URL` (variable) and `OPENOUTREACH_REPLY_STATUS_TOKEN` (secret) exist; without them the sender fails closed.
8. **The one go-live action (YOU): set the repository secret `GULLKORNET_ENABLE_LIVE_SEND` to `true`.** The next weekday run inside 09:00-15:00 Oslo sends at most one e-mail. Watch the first run in the Actions log and Airtable status. Rollback: set it back to anything other than `true`.

## Scheduling (what exists today)

- **Google Places Discovery** runs on its own schedule (twice daily, 06:30 and 12:30 UTC) and chains into Website Audit. The next link, `Contact Research and Drafts`, is disabled, so scheduled discovery does **not** reach Airtable. Only the manual `Unified Lead Research (Manual)` path is verified end to end.
- **`Gullkornet Scheduled Lead Pipeline (gated)`** (new, inert after merge) runs Unified Lead Research on weekdays at 05:15 UTC, one category per weekday, limit `GULLKORNET_SCHEDULED_LEAD_LIMIT` (default 50). It does nothing unless the repository variable `GULLKORNET_ENABLE_SCHEDULED_PIPELINE` is `true`, and writes to Airtable only if `GULLKORNET_SCHEDULED_AIRTABLE_SYNC` is also `true`. Enable in two stages: first research-only, then sync. If you enable it, keep `Google Places Discovery` + `Website Audit` from competing for the same leads (they use separate dedupe caches), or disable the older chain deliberately.
- **Throughput reality:** run `38383510756` yielded 1 `Draft Ready` of 10 candidates (2 `Needs Review`, 7 `No Public Email`). At that yield the 50 eligible first emails per day target needs roughly 500 candidates per day, but one run is capped at 100. Measure the yield over several runs before expecting 50/day; the gates are not lowered to reach the target.

## Optional agents: not part of first go-live

| Component | Exists in repo | Can be called by the pipeline | Tested live |
|---|---|---|---|
| Built-in fetch + evidence model + router | yes | yes (default) | in CI with synthetic data; first real run is step 4 |
| Firecrawl fallback | yes | only with secret `FIRECRAWL_API_KEY` | **no** (`npm run smoke:agents` / manual workflow once on `main`) |
| Agent gateway (server + client) | yes | only when deployed and `AGENT_GATEWAY_URL`+`AGENT_GATEWAY_TOKEN` set | **no**, unit tests with mocked Hermes only |
| Hermes, Agent Reach, JEV Ultrafast, Browser Use, TypeSafe | run in the private `hermes-agent` container | **no**, not reachable from CI | verified only inside that container (see `docs/HERMES.md`) |

Hard prerequisites before any of them processes a lead:

1. **Egress protection where Hermes fetches.** Block private, loopback, link-local (169.254.0.0/16, incl. metadata) and `*.railway.internal` destinations from Hermes' browser and terminal tools (container network policy, or force those tools through a pinned-IP proxy). A gateway-side URL check does not count: the gateway can only detect rebinding after the fetch. Prove it with the rebinding test (step 4b in `docs/AGENT-GATEWAY.md`).
2. Hermes API stays internal-only (`hermes-agent.railway.internal:8642`, no public domain).
3. Only after 1 and 2 are verified: deploy `agent-gateway`, then add `AGENT_GATEWAY_TOKEN` / `AGENT_GATEWAY_URL`. Agent output enters the same evidence model and the same sender gates.
