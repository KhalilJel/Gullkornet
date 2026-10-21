import assert from "node:assert/strict";
import test from "node:test";
import { assessDeliveryHealth, deliveryStopLiftsAt, isPermanentInvalidAddress, isRecipientScopedUndetermined, MAX_FAILURE_RATE, type BounceInfo, type HealthEntry } from "../src/lite/delivery-health.js";

const NOW = Date.parse("2026-10-19T18:00:00Z");
const H = 3_600_000;
let n = 0;
const mail = (hoursAgo: number, last_event: string, to = `p${n}@x${n}.example`): HealthEntry =>
  ({ id: `e${++n}`, created_at: new Date(NOW - hoursAgo * H).toISOString(), last_event, to: [to] });
const delivered = (count: number, hoursAgo = 100) => Array.from({ length: count }, () => mail(hoursAgo, "delivered"));
const PERMANENT: BounceInfo = { type: "Permanent", subType: "General", diagnosticCode: "smtp; 550 5.1.1 no such user" };

test("permanent-invalid: Resend Permanent, or an SMTP code for a non-existent mailbox", () => {
  assert.equal(isPermanentInvalidAddress(PERMANENT), true);
  assert.equal(isPermanentInvalidAddress({ type: "Undetermined", subType: "Undetermined", diagnosticCode: "" }), false);
  assert.equal(isPermanentInvalidAddress({ type: "Transient", diagnosticCode: "smtp; 550 5.1.1 The email account that you tried to reach does not exist" }), true);
  assert.equal(isPermanentInvalidAddress({ type: "Undetermined", diagnosticCode: "smtp; 550 5.4.1 Recipient address rejected: Access denied" }), true);
  assert.equal(isPermanentInvalidAddress({ type: "Transient", diagnosticCode: "smtp; 451 4.7.1 try later" }), false);
  assert.equal(isPermanentInvalidAddress({ type: "Undetermined", diagnosticCode: "smtp; 550 5.7.1 message rejected as spam" }), false, "a content/reputation block is not an address problem");
  assert.equal(isPermanentInvalidAddress(undefined), false);
});

test("an isolated permanent bounce is recipient-scoped and sending may continue", () => {
  const b = mail(2, "bounced");
  const v = assessDeliveryHealth([...delivered(100), b], new Map([[b.id!, PERMANENT]]), NOW);
  assert.ok(v.ok);
  assert.deepEqual(v.recipientScoped.map(s => s.id), [b.id]);
});

test("an isolated Undetermined bounce is recipient-scoped, not reclassified; transient, unknown, complaints and failures stop", () => {
  const b = mail(2, "bounced");
  const und = assessDeliveryHealth([...delivered(100), b], new Map([[b.id!, { type: "Undetermined", subType: "Undetermined" }]]), NOW);
  assert.ok(und.ok);
  assert.deepEqual(und.recipientScoped, [{ id: b.id, recipient: b.to![0], event: "bounced (Undetermined)" }], "reserved like a permanent one");
  assert.equal(isPermanentInvalidAddress({ type: "Undetermined", subType: "Undetermined" }), false, "not reclassified as permanent");
  // Undetermined with a sender-side diagnostic keeps the global stop.
  const spam = assessDeliveryHealth([...delivered(100), b], new Map([[b.id!, { type: "Undetermined", diagnosticCode: "smtp; 554 5.7.1 rejected as spam" }]]), NOW);
  assert.equal(spam.ok, false);
  assert.equal(isRecipientScopedUndetermined({ type: "Undetermined", diagnosticCode: "listed on a blocklist" }), false);
  assert.equal(isRecipientScopedUndetermined({ type: "Undetermined", diagnosticCode: [] as unknown as string }), true);
  const transient = assessDeliveryHealth([...delivered(100), b], new Map([[b.id!, { type: "Transient", diagnosticCode: "smtp; 451 4.7.1 try later" }]]), NOW);
  assert.equal(transient.ok, false);
  assert.match(!transient.ok ? transient.reason : "", /not confirmed permanent \(type Transient\)/);
  assert.equal(assessDeliveryHealth([...delivered(100), b], new Map(), NOW).ok, false, "no bounce detail: stop");
  assert.equal(assessDeliveryHealth([...delivered(100), mail(1, "complained")], new Map(), NOW).ok, false);
  assert.equal(assessDeliveryHealth([...delivered(100), mail(1, "failed")], new Map(), NOW).ok, false);
});

test("Undetermined bounces still count towards the burst limit and the 30-day rate", () => {
  const UND: BounceInfo = { type: "Undetermined", subType: "Undetermined" };
  // 21.10.2026: two permanent bounces from 20.10 plus one Undetermined = 3 in 24 h: burst stop,
  // lifting when the oldest leaves the window.
  const p1 = mail(12.3, "bounced"), p2 = mail(12.0, "bounced"), u = mail(0.1, "bounced");
  const map = new Map<string, BounceInfo>([[p1.id!, PERMANENT], [p2.id!, PERMANENT], [u.id!, UND]]);
  const history = [...delivered(200), p1, p2, u];
  const v = assessDeliveryHealth(history, map, NOW);
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.reason : "", /3 recipient failures in 24 h/);
  assert.equal(deliveryStopLiftsAt(history, map, NOW), Date.parse(p1.created_at) + 24 * H + 1);
  // Rate: 5 Undetermined bounces older than 24 h in 100 emails = 5 % > 4 %.
  const old = Array.from({ length: 5 }, () => mail(200, "bounced"));
  const rate = assessDeliveryHealth([...delivered(95), ...old], new Map(old.map(o => [o.id!, UND] as [string, BounceInfo])), NOW);
  assert.equal(rate.ok, false);
  assert.match(!rate.ok ? rate.reason : "", /failure rate/);
});

test("a Resend suppression is recipient-scoped; old failures outside 24 h do not stop", () => {
  const s = mail(3, "suppressed");
  const v = assessDeliveryHealth([...delivered(100), s, mail(30, "complained")], new Map(), NOW);
  assert.ok(v.ok && v.recipientScoped.length === 1 && v.recipientScoped[0]!.event === "suppressed");
});

test("bursts and a high 30-day failure rate still stop everything", () => {
  const bs = [mail(1, "bounced"), mail(2, "bounced"), mail(3, "suppressed")];
  const map = new Map(bs.filter(b => b.last_event === "bounced").map(b => [b.id!, PERMANENT] as [string, BounceInfo]));
  const burst = assessDeliveryHealth([...delivered(200), ...bs], map, NOW);
  assert.equal(burst.ok, false);
  assert.match(!burst.ok ? burst.reason : "", /3 recipient failures/);
  // 5 old bounces in 100 emails = 5 % > 4 %, even with nothing in the last 24 h.
  const old = Array.from({ length: 5 }, () => mail(200, "bounced"));
  const rate = assessDeliveryHealth([...delivered(95), ...old], new Map(), NOW);
  assert.equal(rate.ok, false);
  assert.match(!rate.ok ? rate.reason : "", /failure rate 5\.0 %/);
  // Today's real numbers: 7 failures in 233 sent (3.0 %) is under the limit.
  assert.ok(7 / 233 < MAX_FAILURE_RATE);
  assert.equal(assessDeliveryHealth([...delivered(226), ...Array.from({ length: 7 }, () => mail(300, "bounced"))], new Map(), NOW).ok, true);
  // A small sample never trips the rate on its own.
  assert.equal(assessDeliveryHealth([...delivered(10), mail(100, "bounced"), mail(120, "bounced")], new Map(), NOW).ok, true);
});
