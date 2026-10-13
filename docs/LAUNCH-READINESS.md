# Launch readiness gates

Live sending stays off (`GULLKORNET_ENABLE_LIVE_SEND` unset) until every gate below is verified. This file records the gates; it contains no secrets or prospect data.

## Verified in code and CI

- Pull request CI cannot write to production Airtable; a regression test fails if a pull request workflow holds the Airtable token without disabling writes.
- Send approval requires exactly one Airtable record for the address (case and whitespace insensitive), refuses if any other record at the same business domain is Sent, Replied, Contacted, Suppressed, Do Not Contact, Follow-up, Meeting, Won or Lost or has Do Not Contact ticked. Freemail and cideamarketing.com are excluded from domain-wide matching. An unchecked Do Not Contact box is omitted by the Airtable API and is read as unchecked.
- Company-level reply check, OpenOutSend `outsend send` lock, and the delivery switch (`GULLKORNET_OPENOUTSEND_DELIVERY_ENABLED`, unset) are unchanged.
- Schedule and limits: see `docs/AUTONOMOUS-AI-OUTREACH.md`.
- No workflow uploads raw contact drafts or review queues.

## Owner gates (not verifiable from the repository)

1. **Reply routing.** Mail for cideamarketing.com is hosted at Migadu. Messages are sent from `hello@cideamarketing.com` with no Reply-To, while the reply monitor reads only `jelassi@cideamarketing.com`. In the Migadu admin, confirm that `hello@` is an alias or forwarding rule delivering into the `jelassi@` mailbox (or make `hello@` the monitored mailbox), then receive one test reply that the monitor detects. Until then replies may go unseen.
2. **Railway redeploy** of the reply service (company-level reply check and send lock), then check the build log shows `OUTSEND_SEND_LOCK=verified`, `/health` is healthy, an unknown address returns `replied=false`, and a positive control returns `replied=true`. Keep `GULLKORNET_OPENOUTSEND_DELIVERY_ENABLED` unset.
3. **Airtable automation** "Gullkornet AI Outreach Assessment" must be activated by the owner, and `Do Not Contact` must exist as a checkbox on the Leads table.
4. **Data exposure cleanup** of already published artifacts and files (owner decision; see the pull request).
