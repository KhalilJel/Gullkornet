import assert from "node:assert/strict";
import test from "node:test";
import { assessDeliveryHealth, deliveryStopLiftsAt, isPermanentInvalidAddress, MAX_FAILURE_RATE, type BounceInfo, type HealthEntry } from "../src/lite/delivery-health.js";

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

test("every bounce is recipient-scoped and not reclassified; complaints and provider failures still stop", () => {
  const b = mail(2, "bounced");
  for (const [info, label] of [
    [{ type: "Undetermined", subType: "Undetermined" }, "bounced (Undetermined)"],
    [{ type: "Transient", diagnosticCode: "smtp; 451 4.7.1 try later" }, "bounced (Transient)"],
    [{ type: "Undetermined", diagnosticCode: "smtp; 554 5.7.1 rejected as spam" }, "bounced (Undetermined)"],
    [undefined, "bounced (no detail)"]
  ] as Array<[BounceInfo | undefined, string]>) {
    const v = assessDeliveryHealth([...delivered(100), b], new Map(info ? [[b.id!, info]] : []), NOW);
    assert.ok(v.ok, label);
    assert.deepEqual(v.recipientScoped, [{ id: b.id, recipient: b.to![0], event: label }]);
  }
  assert.equal(isPermanentInvalidAddress({ type: "Undetermined", subType: "Undetermined" }), false, "not reclassified as permanent");
  const complaint = assessDeliveryHealth([...delivered(100), mail(1, "complained")], new Map(), NOW);
  assert.equal(complaint.ok, false);
  assert.match(!complaint.ok ? complaint.reason : "", /complaint/);
  assert.equal(assessDeliveryHealth([...delivered(100), mail(1, "failed")], new Map(), NOW).ok, false);
});

test("no fixed daily count: 21.10.2026's four recipient failures in 24 h are all reserved, sending continues", () => {
  const UND: BounceInfo = { type: "Undetermined", subType: "Undetermined" };
  const p1 = mail(12.3, "bounced"), p2 = mail(12.1, "bounced"), p3 = mail(12.0, "bounced"), u = mail(0.1, "bounced");
  const map = new Map<string, BounceInfo>([[p1.id!, PERMANENT], [p2.id!, PERMANENT], [p3.id!, PERMANENT], [u.id!, UND]]);
  const v = assessDeliveryHealth([...delivered(270), p1, p2, p3, u], map, NOW);
  assert.ok(v.ok);
  assert.equal(v.recipientScoped.length, 4);
});

test("a Resend suppression is recipient-scoped; old failures outside 24 h do not stop", () => {
  const s = mail(3, "suppressed");
  const v = assessDeliveryHealth([...delivered(100), s, mail(30, "complained")], new Map(), NOW);
  assert.ok(v.ok && v.recipientScoped.length === 1 && v.recipientScoped[0]!.event === "suppressed");
});

test("the 30-day failure rate still stops everything, with count and denominator in the reason", () => {
  // 5 old bounces in 100 emails = 5 % > 4 %, even with nothing in the last 24 h.
  const old = Array.from({ length: 5 }, () => mail(200, "bounced"));
  const rate = assessDeliveryHealth([...delivered(95), ...old], new Map(), NOW);
  assert.equal(rate.ok, false);
  assert.match(!rate.ok ? rate.reason : "", /failure rate 5\.0 % \(5 of 100\)/);
  // Undetermined bounces count towards the rate like any other.
  const und = Array.from({ length: 5 }, () => mail(200, "bounced"));
  assert.equal(assessDeliveryHealth([...delivered(95), ...und], new Map(und.map(o => [o.id!, { type: "Undetermined" }] as [string, BounceInfo])), NOW).ok, false);
  // A rate stop lifts when enough failures leave the 30-day window.
  const history = [...delivered(95), ...old];
  assert.equal(deliveryStopLiftsAt(history, new Map(), NOW), Date.parse(old[0]!.created_at) + 30 * 24 * H + 1);
  // Today's real numbers: 7 failures in 233 sent (3.0 %) is under the limit.
  assert.ok(7 / 233 < MAX_FAILURE_RATE);
  assert.equal(assessDeliveryHealth([...delivered(226), ...Array.from({ length: 7 }, () => mail(300, "bounced"))], new Map(), NOW).ok, true);
  // A small sample never trips the rate on its own.
  assert.equal(assessDeliveryHealth([...delivered(10), mail(100, "bounced"), mail(120, "bounced")], new Map(), NOW).ok, true);
});
