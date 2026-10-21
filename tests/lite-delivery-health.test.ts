import assert from "node:assert/strict";
import test from "node:test";
import { assessDeliveryHealth, deliveryStopLiftsAt, isPermanentInvalidAddress, type BounceInfo, type HealthEntry } from "../src/lite/delivery-health.js";

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

test("no failure-rate stop: 21.10.2026's 12 failures in 283 (4.2 %) and far worse rates only reserve recipients", () => {
  const old = Array.from({ length: 11 }, () => mail(200, "bounced"));
  const fresh = mail(0.1, "bounced");
  const v = assessDeliveryHealth([...delivered(271), ...old, fresh], new Map([[fresh.id!, { type: "Undetermined" }]]), NOW);
  assert.ok(v.ok, "4.2 % no longer stops");
  assert.deepEqual(v.recipientScoped.map(r => r.id), [fresh.id], "the bounce in the last 24 h is reserved");
  const many = Array.from({ length: 30 }, () => mail(100, "bounced"));
  assert.ok(assessDeliveryHealth([...delivered(70), ...many], new Map(), NOW).ok, "even 30 % only reserves");
});

test("complaints and provider failures still stop for 24 h after the event", () => {
  const c = mail(2, "complained");
  const history = [...delivered(100), c];
  const v = assessDeliveryHealth(history, new Map(), NOW);
  assert.equal(v.ok, false);
  assert.equal(deliveryStopLiftsAt(history, new Map(), NOW), Date.parse(c.created_at) + 24 * H + 1);
});
