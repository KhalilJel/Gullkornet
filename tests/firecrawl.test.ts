import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlPublicWebsite, scrapePublicWebsite } from "../src/integrations/firecrawl.js";

test("Firecrawl adapter rejects non-public URLs before provider call", async () => {
  await assert.rejects(
    () => scrapePublicWebsite("http://127.0.0.1:3000"),
    /URL_BLOCKED_OR_NON_PUBLIC/
  );
});

test("Firecrawl crawl adapter rejects localhost before provider call", async () => {
  await assert.rejects(
    () => crawlPublicWebsite("http://localhost:3000"),
    /URL_BLOCKED_OR_NON_PUBLIC/
  );
});

test("Firecrawl adapter requires runtime API configuration", async () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;

  try {
    await assert.rejects(
      () => scrapePublicWebsite("https://example.com"),
      /FIRECRAWL_API_KEY_NOT_CONFIGURED/
    );
  } finally {
    if (previous !== undefined) process.env.FIRECRAWL_API_KEY = previous;
  }
});
