# Launch readiness gates

Live sending stays off (`GULLKORNET_ENABLE_LIVE_SEND` unset) until every gate below is verified. This file records the gates; it contains no secrets or prospect data.

## Verified in code and CI

- Pull request CI cannot write to production Airtable; a regression test fails if a pull request workflow holds the Airtable token without disabling writes.
- Send approval requires exactly one Airtable record for the address (case and whitespace insensitive), refuses if any other record at the same business domain is Sent, Replied, Contacted, Suppressed, Do Not Contact, Follow-up, Meeting, Won or Lost or has Do Not Contact ticked. Freemail and cideamarketing.com are excluded from domain-wide matching. An unchecked Do Not Contact box is omitted by the Airtable API and is read as unchecked.
- Company-level reply check, OpenOutSend `outsend send` lock, and the delivery switch (`GULLKORNET_OPENOUTSEND_DELIVERY_ENABLED`, unset) are unchanged.
- Schedule and limits: see `docs/AUTONOMOUS-AI-OUTREACH.md`.
- No workflow uploads raw contact drafts or review queues.

## Owner gates (not verifiable from the repository)

1. **Reply routing.** Mail for cideamarketing.com is hosted at Migadu. Messages are sent from `hello@cideamarketing.com` with no Reply-To (so no personal address is exposed), while the reply monitor reads only `jelassi@cideamarketing.com`. In the Migadu admin, make `hello@` deliver into the `jelassi@` mailbox: an alias on that mailbox, or a forwarding rule if `hello@` is already its own mailbox. Until this is proven by the test below, replies may go unseen.
2. **Railway redeploy** of the reply service. Its source is documented as branch `phase11/production` and is not updated by merging a pull request; confirm the current source in Railway, note the current deployment ID for rollback, and either point the service at the reviewed commit or at `main` after merge. Then run the verification below.
3. **GitHub Actions access to the reply check.** Set the repository secret `OPENOUTREACH_REPLY_STATUS_TOKEN` (the same value as the Railway variable of that name) and the repository variable `OPENOUTREACH_REPLY_STATUS_URL` (HTTPS, ending in `/v1/reply-status`). GitHub never receives `OPENOUTREACH_INGEST_TOKEN`. Neither value exists yet, so the send workflow currently fails closed.
4. **Airtable automation** "Gullkornet AI Outreach Assessment" must be activated by the owner, and `Do Not Contact` must exist as a checkbox on the Leads table.
5. **Data exposure cleanup** of already published artifacts and files (owner decision; see the pull request).

## Railway variables for the reply service (names confirmed from the code)

| Variable | Value |
| --- | --- |
| `OPENOUTREACH_INGEST_TOKEN` | required; authorizes ingest only in practice (it is still also accepted by reply-status for existing callers) |
| `OPENOUTREACH_REPLY_STATUS_TOKEN` | new, optional but needed by GitHub; at least 32 characters, must differ from the ingest token (the service refuses to start otherwise); authorizes only `POST /v1/reply-status` |
| `OPENOUTREACH_REPLY_MONITOR_ENABLED` | `true` |
| `GULLKORNET_REPLY_MONITOR_MAILBOX` | `jelassi@cideamarketing.com` (the status endpoint requires exactly this) |
| `OUTSEND_MAILBOX_ADDRESS` | identical to the line above |
| `OUTSEND_MAILBOX_PASSWORD`, `OUTSEND_IMAP_HOST`, `OUTSEND_IMAP_PORT` | IMAP access for that mailbox (names from the `openoutsend` 0.1.39 package) |
| `OPENOUTREACH_REPLY_MONITOR_INTERVAL_SECONDS` | optional, 60 to 3600, default 300 |
| `OPENOUTREACH_ALLOW_SEND`, `OPENOUTREACH_STARTUP_ACCEPTANCE_TEST`, `GULLKORNET_OPENOUTSEND_DELIVERY_ENABLED` | `false` or unset |

## Reply-check verification order (after deploy)

Never put a token in chat, logs or a file. Use `$TOKEN` from your own shell.

1. **`GET <base>/health`.** `reply_monitor.status` must be `running` with a recent `last_success_at` and no `last_error_code`. The check only answers while the monitor completed a pass within three intervals (15 minutes by default); otherwise it returns `503 REPLY_MONITOR_UNHEALTHY`. The build log must also show `OUTSEND_SEND_LOCK=verified`.
2. **Unknown address returns `replied:false`.** `POST <base>/v1/reply-status` with `Authorization: Bearer $TOKEN`, `Content-Type: application/json` and body `{"email":"<address that never wrote>"}`. Expect `200 {"replied":false,"mode":"read_only_reply_check","send_triggered":false}`.
3. **Controlled reply returns `replied:true`.** Send one ordinary email yourself from a throwaway address to `hello@cideamarketing.com`, then repeat the call for that address. No wait for the monitor interval is needed: the lookup searches the mailbox live, so it succeeds as soon as Migadu delivers the message. For the company-level check, use two addresses on a domain you own that is not freemail and not `cideamarketing.com`: write from the first and query the second. Freemail is only ever matched by exact address.
4. Confirm the read-only token cannot ingest: the same token on `POST <base>/v1/leads` must return `401`.

Expect `401` for a wrong or missing token, `415` for a wrong content type, and `503` with `REPLY_MONITOR_DISABLED`, `REPLY_MONITOR_MAILBOX_MISMATCH`, `REPLY_MONITOR_UNHEALTHY` or `REPLY_LOOKUP_FAILED` when the monitor cannot be trusted. A `503` is never read as "no reply".
