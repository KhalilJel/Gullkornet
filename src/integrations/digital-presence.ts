import { isSafePublicUrl, type GoogleCandidate } from "./website-audit.js";

export type SocialPlatform = "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube";

export type SocialProfile = {
  platform: SocialPlatform;
  url: string;
};

export type DigitalPresenceResult = {
  companyName: string;
  city?: string;
  industry?: string;
  websiteUrl?: string;
  sourceUrl?: string;
  segment: "NO_WEBSITE_LISTED" | "WEBSITE_WITH_SOCIAL_LINKS" | "WEBSITE_WITHOUT_DETECTED_SOCIAL_LINKS" | "FETCH_ERROR" | "BLOCKED_URL";
  socialProfiles: SocialProfile[];
  suggestedService: "WEBSITE" | "SOCIAL_PROFILE_SETUP_OR_REVIEW" | "MANUAL_REVIEW";
  notes: string[];
  checkedAt: string;
};

const MAX_HTML_BYTES = 384 * 1024;
const TIMEOUT_MS = 7_000;
const MAX_REDIRECTS = 3;

const SOCIAL_HOSTS: Record<SocialPlatform, string[]> = {
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com"],
  instagram: ["instagram.com", "www.instagram.com"],
  linkedin: ["linkedin.com", "www.linkedin.com"],
  tiktok: ["tiktok.com", "www.tiktok.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"]
};

function identifySocialProfile(rawUrl: string, baseUrl: string): SocialProfile | undefined {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const [platform, hosts] of Object.entries(SOCIAL_HOSTS) as [SocialPlatform, string[]][]) {
      if (hosts.some((candidate) => candidate.replace(/^www\./, "") === host)) {
        if (platform === "facebook" && /^\/(sharer|share|dialog)(\/|$)/i.test(url.pathname)) return undefined;
        if (platform === "linkedin" && /^\/(sharing|share)(\/|$)/i.test(url.pathname)) return undefined;
        const path = url.pathname.replace(/\/+$/, "");
        if (!path || path === "/") return undefined;
        if (/^\/(yoururl|your-page|yourpage|yourname|username|company|profile|share|sharer|intent)(\/|$)/i.test(path)) return undefined;
        if (platform === "instagram" && /^\/(hjemmesidehuset|yoururl|yourname|username)(\/|$)/i.test(path)) return undefined;
        return { platform, url: url.toString() };
      }
    }
  } catch {
    // Ignore malformed links and non-URL values.
  }
  return undefined;
}

export function extractSocialProfiles(html: string, baseUrl: string): SocialProfile[] {
  const tags = html.match(/<a\b[^>]*>/gi) ?? [];
  const found = new Map<string, SocialProfile>();
  for (const tag of tags) {
    const match = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawUrl = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!rawUrl) continue;
    const profile = identifySocialProfile(rawUrl, baseUrl);
    if (!profile) continue;
    const key = profile.platform + ":" + profile.url.replace(/\/$/, "").toLowerCase();
    if (!found.has(key)) found.set(key, profile);
  }
  return [...found.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

async function readLimitedHtml(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = value.byteLength > MAX_HTML_BYTES - total ? value.slice(0, MAX_HTML_BYTES - total) : value;
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
  return new TextDecoder().decode(bytes);
}

async function fetchHomepage(startUrl: string): Promise<{ html: string; finalUrl: string; status: number }> {
  let currentUrl = startUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!(await isSafePublicUrl(currentUrl))) throw new Error("BLOCKED_URL");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "GullkornetDigitalPresenceResearch/0.1 (public business website research)" }
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirects === MAX_REDIRECTS) throw new Error("REDIRECT_LIMIT");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      await response.body?.cancel().catch(() => undefined);
      return { html: "", finalUrl: currentUrl, status: response.status };
    }
    return { html: await readLimitedHtml(response), finalUrl: currentUrl, status: response.status };
  }
  throw new Error("REDIRECT_LIMIT");
}

export async function researchDigitalPresence(candidate: GoogleCandidate): Promise<DigitalPresenceResult> {
  const base = {
    companyName: candidate.companyName,
    city: candidate.city,
    industry: candidate.industry,
    websiteUrl: candidate.websiteUrl,
    sourceUrl: candidate.sourceUrl,
    checkedAt: new Date().toISOString()
  };

  if (!candidate.websiteUrl) {
    return {
      ...base,
      segment: "NO_WEBSITE_LISTED",
      socialProfiles: [],
      suggestedService: "WEBSITE",
      notes: [
        "Google Places did not return a website URL. This does not prove the business has no website.",
        "Social media profiles have not been independently searched; do not assume they are absent.",
        "Manual review is needed to confirm the website gap and find an appropriate public contact route."
      ]
    };
  }

  try {
    const homepage = await fetchHomepage(candidate.websiteUrl);
    if (homepage.status >= 400 || !homepage.html) {
      return {
        ...base,
        segment: "FETCH_ERROR",
        socialProfiles: [],
        suggestedService: "MANUAL_REVIEW",
        notes: ["Homepage did not return readable HTML; social profile links could not be checked."]
      };
    }
    const socialProfiles = extractSocialProfiles(homepage.html, homepage.finalUrl);
    return {
      ...base,
      segment: socialProfiles.length ? "WEBSITE_WITH_SOCIAL_LINKS" : "WEBSITE_WITHOUT_DETECTED_SOCIAL_LINKS",
      socialProfiles,
      suggestedService: socialProfiles.length ? "MANUAL_REVIEW" : "SOCIAL_PROFILE_SETUP_OR_REVIEW",
      notes: socialProfiles.length
        ? ["Public social profile links were found on the homepage. Their activity and quality have not been assessed."]
        : ["No supported social profile links were detected on the homepage. This does not prove the business lacks social media accounts."]
    };
  } catch (error) {
    const blocked = error instanceof Error && error.message === "BLOCKED_URL";
    return {
      ...base,
      segment: blocked ? "BLOCKED_URL" : "FETCH_ERROR",
      socialProfiles: [],
      suggestedService: "MANUAL_REVIEW",
      notes: [blocked ? "Website URL was blocked by public-URL safety checks." : "Website could not be checked.", "No conclusion about social media presence was made."]
    };
  }
}

export async function researchDigitalPresences(candidates: GoogleCandidate[], concurrency = 3): Promise<DigitalPresenceResult[]> {
  const results: DigitalPresenceResult[] = new Array(candidates.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), candidates.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= candidates.length) return;
      results[index] = await researchDigitalPresence(candidates[index]!);
    }
  }));
  return results;
}
