import { isSafePublicUrl } from "./website-audit.js";

export type FirecrawlPage = {
  url: string;
  sourceUrl?: string;
  title?: string;
  description?: string;
  markdown?: string;
  links?: string[];
};

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      sourceURL?: string;
      title?: string;
      description?: string;
    };
    links?: string[];
  };
  error?: string;
};

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2";
const DEFAULT_TIMEOUT_MS = 20_000;

function getApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY_NOT_CONFIGURED");
  return key;
}

async function firecrawlRequest<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${FIRECRAWL_API_URL}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${getApiKey()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `FIRECRAWL_HTTP_${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Scrape one public website through Firecrawl.
 *
 * Firecrawl is deliberately kept behind this adapter so Gullkornet owns
 * normalization, evidence and qualification rather than leaking provider
 * response shapes into the domain layer.
 */
export async function scrapePublicWebsite(url: string): Promise<FirecrawlPage> {
  if (!(await isSafePublicUrl(url))) {
    throw new Error("URL_BLOCKED_OR_NON_PUBLIC");
  }

  const result = await firecrawlRequest<FirecrawlResponse>("/scrape", {
    url,
    scrapeOptions: {
      formats: ["markdown", "links"]
    }
  });

  if (!result.success || !result.data) {
    throw new Error(result.error ?? "FIRECRAWL_EMPTY_RESPONSE");
  }

  return {
    url,
    sourceUrl: result.data.metadata?.sourceURL ?? url,
    title: result.data.metadata?.title,
    description: result.data.metadata?.description,
    markdown: result.data.markdown,
    links: result.data.links
  };
}

/**
 * Crawl a public website from its root URL.
 *
 * Phase 3 uses the crawl endpoint only as a capability adapter. Crawl jobs
 * are not yet wired into the lead pipeline; that happens during integration.
 */
export async function crawlPublicWebsite(
  url: string,
  limit = 20
): Promise<{ jobId: string; url: string }> {
  if (!(await isSafePublicUrl(url))) {
    throw new Error("URL_BLOCKED_OR_NON_PUBLIC");
  }

  const result = await firecrawlRequest<{ success?: boolean; id?: string; url?: string; error?: string }>(
    "/crawl",
    {
      url,
      limit: Math.max(1, Math.min(Math.floor(limit), 100)),
      scrapeOptions: {
        formats: ["markdown"]
      }
    }
  );

  if (!result.success || !result.id) {
    throw new Error(result.error ?? "FIRECRAWL_CRAWL_NOT_STARTED");
  }

  return {
    jobId: result.id,
    url: result.url ?? url
  };
}
