import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type GoogleCandidate = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  industry?: string;
  sourceUrl?: string;
};

export type WebsiteAudit = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  industry?: string;
  sourceUrl?: string;
  checkedAt: string;
  status: "AUDITED" | "NO_WEBSITE" | "BLOCKED_URL" | "FETCH_ERROR";
  httpStatus?: number;
  finalUrl?: string;
  https?: boolean;
  title?: string;
  metaDescription?: string;
  hasViewportMeta?: boolean;
  hasContactPath?: boolean;
  hasEmailLink?: boolean;
  responseTimeMs?: number;
  flags: string[];
  note?: string;
};

const MAX_HTML_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !isPrivateOrReservedIpv4(ip);
  if (version === 6) {
    const normalized = ip.toLowerCase();
    // Conservatively allow only globally routable IPv6 unicast addresses (2000::/3).
    return /^2[0-9a-f]{3}:/i.test(normalized) && !normalized.startsWith("2001:db8:");
  }
  return false;
}

export async function isSafePublicUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;

  const version = isIP(hostname);
  if (version) return isPublicIp(hostname);

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => isPublicIp(entry.address));
  } catch {
    return false;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getMetaContent(html: string, name: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const nameMatch = tag.match(/\bname\s*=\s*["']?([^\s"'/>]+)/i);
    const propertyMatch = tag.match(/\bproperty\s*=\s*["']?([^\s"'/>]+)/i);
    const key = (nameMatch?.[1] ?? propertyMatch?.[1] ?? "").toLowerCase();
    if (key !== name.toLowerCase()) continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) ??
      tag.match(/\bcontent\s*=\s*([^\s>]+)/i);
    if (contentMatch?.[1]) return stripTags(contentMatch[1]).slice(0, 300);
  }
  return undefined;
}

export function extractWebsiteSignals(html: string): Pick<WebsiteAudit,
  "title" | "metaDescription" | "hasViewportMeta" | "hasContactPath" | "hasEmailLink" | "flags"> {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const metaDescription = getMetaContent(html, "description");
  const hasViewportMeta = /<meta\b[^>]*name\s*=\s*["']?viewport\b/i.test(html);
  const hasContactPath = /href\s*=\s*["'][^"']*(kontakt|contact|book|bestill|avtal|appointment)[^"']*["']/i.test(html);
  const hasEmailLink = /href\s*=\s*["']mailto:/i.test(html);
  const flags: string[] = [];

  if (!title || !stripTags(title)) flags.push("MISSING_TITLE");
  if (!metaDescription) flags.push("MISSING_META_DESCRIPTION");
  if (!hasViewportMeta) flags.push("MISSING_VIEWPORT_META");
  if (!hasContactPath) flags.push("NO_OBVIOUS_CONTACT_PATH");
  if (!hasEmailLink) flags.push("NO_EMAIL_LINK_DETECTED");

  return {
    title: title ? stripTags(title).slice(0, 200) : undefined,
    metaDescription,
    hasViewportMeta,
    hasContactPath,
    hasEmailLink,
    flags
  };
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = MAX_HTML_BYTES - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function fetchPublicPage(startUrl: string): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!(await isSafePublicUrl(currentUrl))) throw new Error("URL_BLOCKED_OR_NON_PUBLIC");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "GullkornetWebsiteResearch/0.1 (+business website quality review)" }
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirects === MAX_REDIRECTS) throw new Error("REDIRECT_LIMIT_OR_MISSING_LOCATION");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
  throw new Error("REDIRECT_LIMIT");
}

export async function auditCandidate(candidate: GoogleCandidate): Promise<WebsiteAudit> {
  const checkedAt = new Date().toISOString();
  const base = {
    companyName: candidate.companyName,
    websiteUrl: candidate.websiteUrl,
    city: candidate.city,
    industry: candidate.industry,
    sourceUrl: candidate.sourceUrl,
    checkedAt
  };

  if (!candidate.websiteUrl) {
    return { ...base, status: "NO_WEBSITE", flags: ["NO_WEBSITE"], note: "No website URL was returned by Google Places." };
  }

  const startedAt = Date.now();
  try {
    const { response, finalUrl } = await fetchPublicPage(candidate.websiteUrl);
    const contentType = response.headers.get("content-type") ?? "";
    const statusCode = response.status;
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ...base, status: "AUDITED", httpStatus: statusCode, finalUrl,
        https: new URL(finalUrl).protocol === "https:", responseTimeMs: Date.now() - startedAt,
        flags: ["NON_HTML_RESPONSE"], note: "The website response was not identified as HTML."
      };
    }
    const html = await readLimitedBody(response);
    const signals = extractWebsiteSignals(html);
    const flags = [...signals.flags];
    if (statusCode >= 400) flags.unshift("HTTP_ERROR");
    if (new URL(finalUrl).protocol !== "https:") flags.push("NOT_HTTPS");
    return {
      ...base, status: "AUDITED", httpStatus: statusCode, finalUrl,
      https: new URL(finalUrl).protocol === "https:", responseTimeMs: Date.now() - startedAt,
      ...signals, flags, note: "Automated signals only; review manually before qualifying this lead."
    };
  } catch (error) {
    const blocked = error instanceof Error && error.message === "URL_BLOCKED_OR_NON_PUBLIC";
    return {
      ...base,
      status: blocked ? "BLOCKED_URL" : "FETCH_ERROR",
      responseTimeMs: Date.now() - startedAt,
      flags: [blocked ? "BLOCKED_URL" : "FETCH_ERROR"],
      note: error instanceof Error ? error.message : "Unknown website audit error."
    };
  }
}

export async function auditCandidates(candidates: GoogleCandidate[], concurrency = 4): Promise<WebsiteAudit[]> {
  const results: WebsiteAudit[] = new Array(candidates.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), candidates.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= candidates.length) return;
      results[index] = await auditCandidate(candidates[index]!);
    }
  }));
  return results;
}
