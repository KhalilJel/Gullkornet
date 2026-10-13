# Airtable AI Outreach Assessment: trigger recommendation and safe first test

Status (2026-10-13): recommendation only. The automation "Gullkornet AI Outreach Assessment" is unpublished and has not been edited, published or run by Claude. Its live configuration uses a `recordUpdated`-style trigger, which does **not** fire for a row that is created already complete, and the research sync creates rows programmatically. All 10 rows from run `38383510756` therefore sit at `AI Decision=NEEDS_REVIEW`, `AI Confidence=0`.

## What protects sending regardless of the AI

The assessment is advisory. The sender decides deterministically in code (`tests/send-gates.test.ts`, one test per case) and refuses on: Do Not Contact; any status other than `Draft Ready`; `AI Decision` other than `APPROVE`; confidence below 0.90 or non-numeric; missing or mismatching AI evidence; missing evidence URL or one on another site; contact source or e-mail domain not matching the official website; personal (freemail) or named-person addresses; draft without opt-out; `STRATEGIC_ACCOUNT`; another contacted/replied/suppressed record at the same business domain; an earlier reply (reply-status service); a send in the last 24 h to the same address; the 09:00-15:00 Europe/Oslo weekday window; five-minute spacing; 12/hour; 100/day; one per run. A record that fails a per-record rule is skipped and the next one is tried; an Airtable or reply-service outage stops the run (never read as "allowed"). Preview without any send path: `npm run send:preview` (read-only counts).

## Evidence mapping fix (2026-10-13, after the first Run test)

**What happened.** The first Run test on `Antoniette frisør` returned `APPROVE` / 0.90 with the evidence "Forsiden har ingen meta-beskrivelse.". That sentence exists only in `Research Notes` (a `FAKTA` line from the routing rules). The sender requires the AI evidence verbatim inside `Personalization Evidence`, which holds only the observed page text (Sidetittel, Overskrift, Tjenestetekst). So the sender would have refused the row even though the AI approved it. The live prompt (read on 2026-10-13) passed `Research Notes` to the model next to the evidence field and said "exact evidence text ... from the supplied facts", which let the model pick the notes line; it also did not say that a neutral technical observation is not a problem, so the draft said the site "does not have a meta description".

**Chosen fix (least risk, nothing weakened).** `Personalization Evidence` stays the single evidence channel and `Research Notes` stays internal context. No sender gate, DNC, duplicate, reply, reservation or limit changed, and no neutral technical signal is copied into the evidence field. The new prompt in `docs/airtable-ai-assessment-prompt.txt`:

- allows evidence only from `Public-site evidence` (the `Personalization Evidence` field) and forbids taking anything from `Research Notes`, including `FAKTA`/`SLUTNING` lines;
- requires one contiguous excerpt copied character for character (no paraphrase, translation or ellipsis);
- treats missing meta description, title, viewport or contact path as neutral context: never a customer-facing claim, never described as a problem, never the sole basis for `APPROVE`;
- keeps the opt-out sentence «svar nei takk», the 0.90 threshold, the no-meeting rule and `NEEDS_REVIEW` for anything uncertain.

If the model still picks text that is not in `Personalization Evidence`, the sender refuses the row (fail-safe, proven in `tests/ai-assessment-chain.test.ts`). Tests also prove the field mapping, that an APPROVE with notes-only, paraphrased or shortened evidence is refused, that verbatim evidence is accepted, and that the prompt file contains each rule.

**Follow-up: evidence URL (found in the second Run test).** With the corrected prompt the evidence was verbatim in `Personalization Evidence`, but the model cited the contact page as `AI Evidence URL`; the quote exists only on the homepage (checked against the live pages). The sender only checks that the URL is on the company's own domain, so it cannot catch this. In the research code (`contact-research.ts`) `Sidetittel`, `Overskrift` and `Tjenestetekst` are read from the homepage fetched from `Website`; the contact page is read only for e-mail addresses and, as a fallback, to fill a headline or service sentence the homepage lacked. The prompt now requires `evidenceUrl` to be the `Website` URL and forbids using `Contact Source URL` merely because it shares the domain. Known limit: in the rare fallback case the quote may come from the contact page; making that explicit would need the research step to record the source page per quote (not done here). After merging, the prompt must be pasted into Airtable again (owner action), followed by one more Run test on the Antoniette row.

**Follow-up 2: source page per evidence line.** The research step now records the page each of Sidetittel, Overskrift and Tjenestetekst was read from (`evidenceSources`; the homepage by default, the contact page or a scrape only when it filled a gap the homepage left), and the Airtable sync writes it next to the text: `Tjenestetekst: <text> (Kilde: <url>)`. The quote itself stays a verbatim substring, so the sender's exact-match rule is unchanged, and an excerpt that includes an edited `(Kilde: ...)` is refused. The prompt tells the model to use the `(Kilde: ...)` URL of the quoted line as `evidenceUrl`, falling back to `Website` when a line has none (rows synced before this change have no source suffix). Existing rows are not rewritten; the suffix appears on rows created or refreshed by later syncs. After merging, the `evidenceUrl` line of the prompt must be replaced in Airtable once more (owner action).

**Applying it (owner action, not done).** In the automation's "Generate structured data" step replace the prompt text with `docs/airtable-ai-assessment-prompt.txt` and re-insert the field chips where the `{Field}` placeholders are. The output schema (decision, confidence, evidence, evidenceUrl, reason, subject, body) is unchanged.

**Verification order after review and merge (each step separately approved).**
1. Update the prompt in the unpublished automation.
2. One more "Run test" on the `Antoniette frisør` row only (writes the 7 AI fields again). Expect evidence copied from `Personalization Evidence` (for example the Tjenestetekst sentence) and a neutral draft; `NEEDS_REVIEW` is also an acceptable, safe outcome if the model finds no relevant service cue.
3. `npm run send:preview`: confirm the row is accepted or refused for the right reason.
4. Only then consider publishing the "matches conditions" automation, then research-only scheduling, then Airtable sync, then a separate go-live decision. Live send stays off until the last approval.

## Recommended trigger

Use **"When a record matches conditions"** instead of "When record updated", with conditions:

- `Lead Status` is `Draft Ready`
- `AI Decision` is `NEEDS_REVIEW`
- `Email` is not empty
- `AI Draft Body` is empty

Per Airtable's documentation this fires when a record *enters* the matching state, including a record that is **created** matching (the research sync does exactly that); confirm it once with a single new test row before relying on it, and again when a later research refresh resets the AI fields. It does not fire for `Needs Review` or `No Public Email` rows, so the personal Gmail address and the domain-mismatch address (both `Needs Review`) are never assessed or drafted. Actions stay as today: write only the `AI *` fields; never write `Lead Status`, `Verified Observation` or `Do Not Contact`, and never send. Keep the prompt instruction that anything uncertain returns `NEEDS_REVIEW`; the sender does not rely on it.

## Safe one-time assessment of the existing rows

Records that already match when an automation is published are not picked up by a "matches conditions" trigger. Only 1 of the 10 rows is `Draft Ready`, and only `Draft Ready` rows are worth assessing.

1. Leave `GULLKORNET_ENABLE_LIVE_SEND` as it is (not `true`): the sender is a no-op, so nothing can be sent while testing.
2. In the automation editor use **Run test** on the single `Draft Ready` row. This writes only the `AI *` fields of that row (a real, but harmless and reversible, write; no e-mail). Do not publish yet.
3. Inspect the result: `AI Decision`, `AI Confidence` (needs >= 0.90 to count), `AI Evidence` copied from the row's `Personalization Evidence`, `AI Evidence URL` on the company's own site, `AI Draft Subject/Body` with an opt-out sentence.
4. Run `npm run send:preview` locally (needs your own `AIRTABLE_API_TOKEN` and `GULLKORNET_AIRTABLE_BASE_ID`; optionally the reply-status variables). It prints how many queue rows would pass every sender gate, counts only, no writes. Expect `eligible` 0 or 1.
5. Only then publish the automation (owner decision). New rows from later research syncs are then assessed automatically.

## Gates that remain with Khalil

Publishing the automation; any Airtable write (including Run test); setting `GULLKORNET_ENABLE_LIVE_SEND=true`; enabling the scheduled pipeline (see `docs/GO-LIVE-RUNBOOK.md`).
