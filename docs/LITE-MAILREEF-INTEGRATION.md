# Mailreef transport preparation — 16 October 2026

The owner selected Mailreef and has explicitly authorized the controlled sending pilot. Do not request the same pilot authorization again. The owner handles privacy/marketing-information follow-up. This change preserves template 2026-10-15.6, its subject and text.

## Implemented

`src/integrations/mailreef.ts` implements the documented Basic authentication contract (API key as username, empty password), account/sender GET checks and the POST /email transport. No third-party package is required. Redirects are refused so credentials are not forwarded to another destination. Provider bodies, user objects, billing cards and mailbox passwords are not logged or returned by the readiness check.

`npm run check:mailreef` reads MAILREEF_API_KEY from the environment and checks the account plus the locked hello@cideamarketing.com mailbox. It only performs GET requests and prints selected booleans. Missing credentials fail before network access. Billing inactive or sender not live produces a failing exit status. This does not assert DNS alignment, delivery, reply routing, actual price or full account readiness.

The transport takes a bare sender address; the current Lite display-name string cannot be passed unchanged. Mailreef documents mailbox sender_name separately. Confirm the account's display name remains Cidea Marketing before integration. Both text_body and escaped html_body are supplied because the public API marks both required. The approved plain text and subject are preserved exactly; no footer, new wording, CC or BCC is added. HTML encodes characters and preserves line breaks only.

## Duplicate protection contract

The public send API does not document an idempotency header. The caller must supply a persistent, atomic attempt store shared across runs. The transport claims the attempt before its single POST and never retries or automatically releases it. All ambiguous responses, HTTP errors and timeouts retain the claim for reconciliation. A provider acceptance followed by local persistence failure must never trigger a resend.

Tests use an in-memory store only as a test double. A production attempt store is NOT implemented or configured in this change. The module is NOT wired to send-lite.ts or any scheduled workflow. Do not describe it as a completed live integration. Existing Resend refusal and production switches remain unchanged. No API secret, billing, DNS, mailbox, server or live-send setting was created or modified.

## Remaining account/onboarding work

The actual Mailreef UI showed no existing signed-in account. The owner confirmed there is no account. Login offers Book Demo rather than self-service registration. Public Request access/Sign up points to https://www.mailreef.com/book-demo. No demo time was chosen, form submitted, account created or purchase made. A demo/approval step is an external dependency, not a completed registration.

When access is available:

1. Confirm actual account offer and any terms requiring acceptance; obtain account access through the owner's secure login. Never paste credentials in chat, PRs or logs.
2. Establish the existing sender without moving the original mailbox or changing MX without explicit approved scope. Confirm SPF/DKIM/DMARC and how replies reach the monitored inbox. Do not map the ambiguous in_reply_to documentation to Reply-To without verification.
3. Run the read-only account/sender check with a securely provisioned key. The /users endpoint itself returns secrets and billing data: do not print its raw response.
4. Implement durable shared attempt storage, complete Mailreef history pagination and account-wide limits, retain relevant historical suppression/Resend history, and verify bounce/reply processing. Public outbound history has status, data, current_page and total_pages; bounce messages are visible via IMAP, not inbound API results. A new provider must not reset prior-contact suppression.
5. Connect the transport only after those controls are tested. Use the existing pilot approval for one message per run, five per day, in the established Oslo sending window. Verify the first provider result and delivery before proceeding. Accepted/queued is not proof of inbox delivery. Scaling to 95/day remains separate.

## Primary API sources

- https://mailreef.readme.io/reference/authentication
- https://mailreef.readme.io/reference/get-user-details
- https://mailreef.readme.io/reference/get-mailbox-details
- https://mailreef.readme.io/reference/send-an-email
- https://mailreef.readme.io/reference/list-outbound-emails
- https://www.mailreef.com/email-api

The preparation was verified against the public Markdown API reference. Actual account behavior and production delivery remain unverified until onboarding is complete.
