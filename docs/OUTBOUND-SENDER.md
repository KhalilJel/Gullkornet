# Outbound sender configuration

## Selected sender

Gullkornet's intended sender address is `jelassi@smartsvar.no`.

The review-queue generator records this address as metadata. It can be overridden for a non-production review run with the `OUTREACH_FROM_EMAIL` environment variable.

## Current safety boundary

- Email sending is not implemented or enabled in Gullkornet.
- Recording the intended sender does not verify the mailbox, authenticate the domain with an email provider, or confirm deliverability.
- Do not add SmartSvar production credentials or connect Gullkornet to SmartSvar production state.
- Do not change DNS or MX records as part of this work.
- Before any sending feature is implemented, verify provider authorization and the sender identity, add explicit dry-run and approval controls, and review recipient eligibility and opt-out handling.
