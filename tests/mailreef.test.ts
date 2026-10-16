import assert from "node:assert/strict";
import test from "node:test";
import { checkMailreefAccount, sendMailreefEmail, type MailreefAttemptStore } from "../src/integrations/mailreef.js";
import { LITE_TEMPLATE } from "../src/lite/template.js";

const email = { from: "hello@cideamarketing.com", to: "post@example.no", ...LITE_TEMPLATE };
function journal() {
  const claims = new Set<string>();
  const accepted = new Map<string, string>();
  const store: MailreefAttemptStore = {
    claim: async key => { if (claims.has(key)) return false; claims.add(key); return true; },
    accepted: async (key, id) => { accepted.set(key, id); }
  };
  return { store, claims, accepted };
}

test("Mailreef readiness is GET-only and does not expose account or mailbox secrets", async () => {
  const calls: string[] = [];
  const fake = (async (input, options) => {
    assert.equal(options?.method ?? "GET", "GET");
    assert.equal(options?.redirect, "error");
    assert.equal((options?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from("test-key:").toString("base64")}`);
    calls.push(String(input));
    return Response.json(calls.length === 1
      ? { api_key: "never-return", permissions: ["api"], billing: { active: true, stripe_cards: ["private"] } }
      : { id: email.from, live: true, password: "never-return" });
  }) as typeof fetch;
  assert.deepEqual(await checkMailreefAccount("test-key", email.from, fake), { apiAccess: true, billingActive: true, senderLive: true });
  assert.deepEqual(calls, ["https://api.mailreef.com/users", "https://api.mailreef.com/mailboxes/hello%40cideamarketing.com"]);
});

test("Mailreef sends exact approved text once and records provider acceptance", async () => {
  const j = journal(); let posts = 0;
  const fake = (async (input, options) => {
    posts++;
    assert.equal(String(input), "https://api.mailreef.com/email");
    assert.equal(options?.method, "POST");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.subject, LITE_TEMPLATE.subject);
    assert.equal(body.text_body, LITE_TEMPLATE.text);
    assert.deepEqual(body.to, [email.to]);
    assert.deepEqual(Object.keys(body).sort(), ["from", "html_body", "subject", "text_body", "to"]);
    return Response.json({ sent: true, id: "provider-id" }, { status: 201 });
  }) as typeof fetch;
  assert.deepEqual(await sendMailreefEmail(email, "test-key", "attempt", j.store, fake), { id: "provider-id" });
  assert.equal(j.accepted.get("attempt"), "provider-id");
  await assert.rejects(sendMailreefEmail(email, "test-key", "attempt", j.store, fake), /already exists/);
  assert.equal(posts, 1);
});

test("timeout, HTTP error and malformed acceptance retain claim and prevent a second POST", async () => {
  for (const scenario of ["timeout", "429", "500", "malformed"] as const) {
    const j = journal(); let posts = 0;
    const fake = (async () => {
      posts++;
      if (scenario === "timeout") throw new Error("private-provider-data");
      if (scenario === "malformed") return Response.json({ sent: false, id: "maybe" }, { status: 201 });
      return new Response("private-provider-data", { status: Number(scenario) });
    }) as typeof fetch;
    await assert.rejects(sendMailreefEmail(email, "test-key", "attempt", j.store, fake), error => {
      assert.doesNotMatch(String(error), /private-provider-data/); return true;
    });
    await assert.rejects(sendMailreefEmail(email, "test-key", "attempt", j.store, fake), /already exists/);
    assert.equal(posts, 1); assert.equal(j.accepted.size, 0);
  }
});

test("accepted message is not retried when journal confirmation fails", async () => {
  const j = journal(); j.store.accepted = async () => { throw new Error("disk failed"); };
  const fake = (async () => Response.json({ sent: true, id: "accepted" }, { status: 201 })) as typeof fetch;
  await assert.rejects(sendMailreefEmail(email, "test-key", "attempt", j.store, fake), /accepted the message/);
  await assert.rejects(sendMailreefEmail(email, "test-key", "attempt", j.store, fake), /already exists/);
});

test("invalid inputs fail before claiming or network access", async () => {
  const j = journal();
  const fake = (async () => { throw new Error("unexpected network"); }) as typeof fetch;
  for (const invalid of [{ ...email, to: "a@example.no,b@example.no" }, { ...email, from: "Brand <hello@example.no>" }, { ...email, subject: "one\ntwo" }]) {
    await assert.rejects(sendMailreefEmail(invalid, "test-key", "attempt", j.store, fake), /single bare|invalid/);
  }
  await assert.rejects(checkMailreefAccount("", email.from, fake), /MAILREEF_API_KEY/);
  assert.equal(j.claims.size, 0);
});

test("readiness refuses missing API permission and mismatching sender", async () => {
  const noApi = (async () => Response.json({ permissions: [], billing: { active: true } })) as typeof fetch;
  await assert.rejects(checkMailreefAccount("test-key", email.from, noApi), /incomplete/);
  let call = 0;
  const wrongBox = (async () => Response.json(++call === 1
    ? { permissions: ["api"], billing: { active: true } }
    : { id: "different@example.no", live: true })) as typeof fetch;
  await assert.rejects(checkMailreefAccount("test-key", email.from, wrongBox), /invalid sender/);
});
