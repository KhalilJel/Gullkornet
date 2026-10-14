import { DRY_RUN_RECORDS, dryRunConfig, dryRunDeps } from "../lite/fixtures.js";
import { runLiteSend } from "../lite/send.js";

// Fully offline dry run of the Lite sender over five synthetic .example leads.
// Fake clock (a Saturday, 10:00 Oslo), fake Resend, fake Airtable, fake reply service.
const start = Date.parse("2026-10-17T08:00:00Z");
const { deps, outbox, state } = dryRunDeps(start);
const summary = await runLiteSend(deps, dryRunConfig());
console.log(JSON.stringify({ summary, sentTo: outbox.map(o => o.email.to), subject: outbox[0]?.email.subject,
  statuses: DRY_RUN_RECORDS.map(r => ({ id: r.id, status: state.get(r.id)?.fields["Lead Status"] })) }, null, 2));
