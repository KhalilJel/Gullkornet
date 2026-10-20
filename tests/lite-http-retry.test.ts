import assert from "node:assert/strict";
import test from "node:test";
import { fetchReadWithRetry } from "../src/lite/http-retry.js";

const noWait = async () => undefined;

test("one timeout or 5xx on a read is retried; a lasting failure is returned or thrown as before", async () => {
  let calls = 0;
  const flaky = (async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (calls === 2) return new Response("", { status: 500 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  assert.equal((await fetchReadWithRetry(flaky, "https://x", {}, 1000, [1, 1], noWait)).status, 200);
  assert.equal(calls, 3);

  const down = (async () => new Response("", { status: 503 })) as typeof fetch;
  assert.equal((await fetchReadWithRetry(down, "https://x", {}, 1000, [1, 1], noWait)).status, 503, "caller still sees the outage");

  let timeouts = 0;
  const dead = (async () => { timeouts++; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); }) as typeof fetch;
  await assert.rejects(fetchReadWithRetry(dead, "https://x", {}, 1000, [1, 1], noWait), /timeout/);
  assert.equal(timeouts, 3);

  let notFound = 0;
  const gone = (async () => { notFound++; return new Response("", { status: 404 }); }) as typeof fetch;
  assert.equal((await fetchReadWithRetry(gone, "https://x", {}, 1000, [1, 1], noWait)).status, 404);
  assert.equal(notFound, 1, "a definite answer is not retried");
});
