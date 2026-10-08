import assert from "node:assert/strict";
import test from "node:test";
import { executeBrowserUse, type BrowserUseTask } from "../src/integrations/browser-use.js";

const task: BrowserUseTask = {
  url: "https://example.com/",
  goal: "Open the Learn more page"
};

test("Browser Use interface accepts a successful execution result", async () => {
  const result = await executeBrowserUse(task, async () => ({
    status: "success",
    finalUrl: "https://www.iana.org/help/example-domains",
    evidence: ["Learn more target clicked"]
  }));

  assert.equal(result.status, "success");
  assert.equal(result.finalUrl, "https://www.iana.org/help/example-domains");
});

test("Browser Use interface preserves controlled blocked results", async () => {
  const result = await executeBrowserUse(task, async () => ({
    status: "blocked",
    evidence: [],
    failureReason: "TARGET_UNAVAILABLE"
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.failureReason, "TARGET_UNAVAILABLE");
});

test("Browser Use interface rejects success without final URL", async () => {
  await assert.rejects(
    () => executeBrowserUse(task, async () => ({
      status: "success",
      evidence: []
    })),
    /BROWSER_USE_SUCCESS_REQUIRES_FINAL_URL/
  );
});

test("Browser Use interface rejects failure without reason", async () => {
  await assert.rejects(
    () => executeBrowserUse(task, async () => ({
      status: "blocked",
      evidence: []
    })),
    /BROWSER_USE_FAILURE_REQUIRES_REASON/
  );
});
