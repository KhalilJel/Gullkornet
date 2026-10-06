export type FirecrawlPage = {
  url: string;
  title?: string;
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
};

export type FirecrawlClient = {
  scrape(url: string): Promise<FirecrawlPage>;
};

export function createFirecrawlClient(): FirecrawlClient {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  const baseUrl = (process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev").replace(/\/$/, "");
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is required to use the Firecrawl integration.");
  }

  return {
    async scrape(url: string): Promise<FirecrawlPage> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`${baseUrl}/v2/scrape`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            url,
            formats: ["markdown", "html"],
            onlyMainContent: true
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Firecrawl returned HTTP ${response.status}`);
        }
        const payload = await response.json() as {
          data?: {
            markdown?: string;
            html?: string;
            metadata?: Record<string, unknown>;
          };
        };
        return {
          url,
          title: typeof payload.data?.metadata?.title === "string" ? payload.data.metadata.title : undefined,
          markdown: payload.data?.markdown,
          html: payload.data?.html,
          metadata: payload.data?.metadata
        };
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
