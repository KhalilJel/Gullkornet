import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { exactAddressBlocked, markDoNotContact, providerDetail, recipientRef, rowStates, scrub, stopLiftsAt } from "../src/lite/delivery-check.js";

const NOW = Date.parse("2026-10-19T16:00:00Z");

test("provider text never carries the recipient address or domain", () => {
  const detail = providerDetail({ id: "e1", to: ["post@firma.example"], subject: "Hei", last_event: "bounced",
    bounce: { type: "Permanent", message: "550 5.1.1 <post@firma.example>: mailbox unavailable at mx.firma.example" } }, "post@firma.example");
  assert.doesNotMatch(detail, /firma\.example|post@/);
  assert.match(detail, /Permanent/);
  assert.match(detail, /bounced/);
  assert.doesNotMatch(detail, /Hei/, "subject is dropped");
  assert.equal(scrub("x@y.example and z@w.example"), "<address> and <address>");
  assert.equal(recipientRef(" Post@Firma.example "), recipientRef("post@firma.example"));
  assert.equal(recipientRef("post@firma.example").length, 10);
});

test("exact address counts as blocked only when every exact row is DNC or in a blocking status", () => {
  const rows = (fields: Array<Record<string, unknown>>) => rowStates(fields.map((f, i) => ({ id: `rec${i}`, fields: f })), "a@b.example");
  assert.equal(exactAddressBlocked(rows([{ Email: "a@b.example", "Lead Status": "Sent" }])), true);
  assert.equal(exactAddressBlocked(rows([{ Email: "a@b.example", "Lead Status": "Lite Ready" }])), false);
  assert.equal(exactAddressBlocked(rows([{ Email: "a@b.example", "Lead Status": "Lite Ready", "Do Not Contact": true }])), true);
  assert.equal(exactAddressBlocked(rows([{ Email: "other@b.example", "Lead Status": "Sent" }])), false, "no exact row");
  assert.equal(exactAddressBlocked(rows([{ Email: "a@b.example", "Lead Status": "Sent" }, { Email: "A@b.example", "Lead Status": "Lite Ready" }])), false);
});

test("stop lifts 24 h after the newest failure inside the window", () => {
  const at = (h: number, last_event: string) => ({ created_at: new Date(NOW - h * 3_600_000).toISOString(), last_event });
  assert.equal(stopLiftsAt([at(2, "delivered")], NOW), undefined);
  assert.equal(stopLiftsAt([at(25, "bounced")], NOW), undefined);
  assert.equal(stopLiftsAt([at(20, "bounced"), at(4, "complained"), at(1, "delivered")], NOW), NOW - 4 * 3_600_000 + 86_400_000);
});

test("Do Not Contact write is verified and refused from pull-request runs", async () => {
  const cfg = { apiToken: "t", baseId: "appAAAAAAAAAAAAAA", tableName: "Leads",
    fetchImpl: (async () => new Response(JSON.stringify({ id: "recA", fields: { "Do Not Contact": true } }))) as typeof fetch };
  await markDoNotContact(cfg, "recA", {});
  await assert.rejects(markDoNotContact(cfg, "recA", { GITHUB_EVENT_NAME: "pull_request" }), /DISABLED/);
  const wrong = { ...cfg, fetchImpl: (async () => new Response(JSON.stringify({ id: "recA", fields: {} }))) as typeof fetch };
  await assert.rejects(markDoNotContact(wrong, "recA", {}), /could not be verified/);
});

test("delivery-check workflow is manual only and writes only on explicit input", async () => {
  const wf = await readFile(new URL("../.github/workflows/lite-delivery-check.yml", import.meta.url), "utf8");
  assert.doesNotMatch(wf, /^  (push|pull_request|schedule):/m);
  assert.match(wf, /apply_suppression:[\s\S]*default: false/);
  assert.doesNotMatch(wf, /send:lite|ENABLE_LIVE_SEND/);
});
