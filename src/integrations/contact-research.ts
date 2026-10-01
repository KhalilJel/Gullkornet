import { isSafePublicUrl, type GoogleCandidate, type WebsiteAudit } from "./website-audit.js";

export type PublicEmail = {
  email: string;
  sourceUrl: string;
  sourceType: "mailto" | "visible_text";
};

export type ContactResearchDraft = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  sourceUrl?: string;
  researchStatus: "RESEARCHED" | "NO_WEBSITE" | "FETCH_ERROR" | "BLOCKED_URL";
  emails: PublicEmail[];
  headline?: string;
  pageTitle?: string;
  serviceEvidence?: string;
  contactPageUrl?: string;
  subject?: string;
  draftBody?: string;
  personalizationEvidence?: string;
  requiresHumanReview: true;
  notes: string[];
  researchedAt: string;
};

const MAX_HTML_BYTES = 384 * 1024;
const TIMEOUT_MS = 7_000;
const MAX_REDIRECTS = 3;
const MAX_PAGES_PER_SITE = 3;
const EMAIL_PATTERN = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;

function decodeText(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return decodeText(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

async function readHtml(response: Response): Promise<string> {
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

async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: string; status: number }> {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!(await isSafePublicUrl(currentUrl))) throw new Error("BLOCKED_URL");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "GullkornetContactResearch/0.1 (public business website research)" }
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
    const type = response.headers.get("content-type") ?? "";
    if (!type.toLowerCase().includes("text/html")) {
      await response.body?.cancel().catch(() => undefined);
      return { html: "", finalUrl: currentUrl, status: response.status };
    }
    return { html: await readHtml(response), finalUrl: currentUrl, status: response.status };
  }
  throw new Error("REDIRECT_LIMIT");
}

function getTagText(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  const value = match?.[1] ? stripHtml(match[1]).slice(0, 220) : "";
  return value || undefined;
}

function getTitle(html: string): string | undefined {
  return getTagText(html, "title");
}

function getContactLinks(html: string, baseUrl: string): string[] {
  const links = html.match(/<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi) ?? [];
  const found: string[] = [];
  const base = new URL(baseUrl);
  for (const tag of links) {
    const match = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!raw || /^mailto:|^tel:|^javascript:/i.test(raw)) continue;
    if (!/(kontakt|contact|om-oss|about|team|ansatte|medarbeider)/i.test(raw + " " + stripHtml(tag))) continue;
    try {
      const url = new URL(raw, baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (url.hostname.toLowerCase() !== base.hostname.toLowerCase()) continue;
      if (!found.includes(url.toString())) found.push(url.toString());
    } catch {
      // Ignore malformed public links.
    }
  }
  return found.slice(0, MAX_PAGES_PER_SITE - 1);
}

function extractEmails(html: string, sourceUrl: string): PublicEmail[] {
  const results: PublicEmail[] = [];
  const seen = new Set<string>();
  const mailtos = html.match(/href\s*=\s*["']mailto:([^"'?\s]+)(?:\?[^"']*)?["']/gi) ?? [];
  for (const tag of mailtos) {
    const match = tag.match(/mailto:([^"'?\s]+)/i);
    const email = match?.[1]?.toLowerCase();
    if (email && EMAIL_PATTERN.test(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, sourceUrl, sourceType: "mailto" });
    }
    EMAIL_PATTERN.lastIndex = 0;
  }
  const visibleText = stripHtml(html);
  for (const match of visibleText.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      results.push({ email, sourceUrl, sourceType: "visible_text" });
    }
  }
  return results.filter((item) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(item.email));
}

function extractEvidence(html: string): { headline?: string; serviceEvidence?: string } {
  const headline = getTagText(html, "h1");
  const text = stripHtml(html);
  const sentenceCandidates = text.split(/[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length >= 30 && s.length <= 220);
  const serviceTerms = /regnskap|regnskapsfør|bokfør|lønn|årsoppgjør|økonomirådgivning|rådgivning|skatt|mva|accounting|bookkeeping/i;
  const serviceEvidence = sentenceCandidates.find((s) => serviceTerms.test(s));
  return { headline, serviceEvidence };
}

function createDraft(candidate: GoogleCandidate, title?: string, headline?: string, serviceEvidence?: string): {
  subject?: string; draftBody?: string; personalizationEvidence?: string; notes: string[];
} {
  const evidence = headline ?? serviceEvidence ?? title;
  const notes: string[] = [];
  if (!evidence) {
    notes.push("No reliable page-specific headline or service statement was extracted; no personalized draft generated.");
    return { notes };
  }
  if (!headline && !serviceEvidence) notes.push("Personalization uses the page title only; manually verify before use.");
  const cleanEvidence = evidence.replace(/[\r\n"]/g, "").slice(0, 180);
  const company = candidate.companyName.trim();
  const subject = "Et konkret forslag til nettsiden til " + company;
  const draftBody = [
    "Hei!",
    "",
    "Jeg tok en titt på nettsiden deres og la merke til " + (headline ? "overskriften «" + cleanEvidence + "»." : serviceEvidence ? "at dere beskriver tjenestene deres slik: «" + cleanEvidence + "»." : "sidetittelen «" + cleanEvidence + "»."),
    "",
    "Jeg jobber med nettsider for bedrifter og fikk en konkret idé til hvordan nettsiden kan gjøre det enklere for potensielle kunder å forstå tilbudet deres og ta kontakt.",
    "",
    "Er det interessant om jeg sender over ideen i noen få linjer? Ingen forpliktelser.",
    "",
    "Mvh Jelassi"
  ].join("\n");
  return { subject, draftBody, personalizationEvidence: cleanEvidence, notes };
}

export async function researchContactAndDraft(candidate: GoogleCandidate, audit?: WebsiteAudit): Promise<ContactResearchDraft> {
  const researchedAt = new Date().toISOString();
  const base = {
    companyName: candidate.companyName,
    websiteUrl: candidate.websiteUrl,
    city: candidate.city,
    sourceUrl: candidate.sourceUrl,
    requiresHumanReview: true as const,
    researchedAt,
    emails: [] as PublicEmail[],
    notes: [] as string[]
  };

  if (!candidate.websiteUrl) {
    return { ...base, researchStatus: "NO_WEBSITE", notes: ["No website URL was supplied by the discovery result."] };
  }

  try {
    const homepage = await fetchHtml(candidate.websiteUrl);
    if (homepage.status >= 400 || !homepage.html) {
      return { ...base, researchStatus: "FETCH_ERROR", notes: ["Homepage did not return readable HTML.", "No email address was guessed."] };
    }

    const title = getTitle(homepage.html) ?? audit?.title;
    const evidence = extractEvidence(homepage.html);
    const emails = extractEmails(homepage.html, homepage.finalUrl);
    const contactUrls = getContactLinks(homepage.html, homepage.finalUrl);
    let contactPageUrl: string | undefined;
    let extraHtml = "";
    for (const url of contactUrls) {
      try {
        const page = await fetchHtml(url);
        if (page.status >= 400 || !page.html) continue;
        contactPageUrl ??= page.finalUrl;
        extraHtml += "\n" + page.html;
        emails.push(...extractEmails(page.html, page.finalUrl));
        const contactEvidence = extractEvidence(page.html);
        evidence.headline ??= contactEvidence.headline;
        evidence.serviceEvidence ??= contactEvidence.serviceEvidence;
        if (emails.length >= 8) break;
      } catch {
        // One failed contact page should not prevent research of the homepage.
      }
    }

    const uniqueEmails = [...new Map(emails.map((item) => [item.email, item])).values()].slice(0, 10);
    const draft = createDraft(candidate, title, evidence.headline, evidence.serviceEvidence);
    const notes = [...draft.notes];
    if (uniqueEmails.length === 0) notes.push("No public email address found on the checked pages. Do not guess an address.");
    else notes.push("Email addresses were extracted from publicly accessible pages; mailbox deliverability and recipient role are not verified.");
    notes.push("Draft is not sent. Human review is required for accuracy, relevance, and applicable outreach rules.");

    return {
      ...base,
      researchStatus: "RESEARCHED",
      emails: uniqueEmails,
      headline: evidence.headline,
      pageTitle: title,
      serviceEvidence: evidence.serviceEvidence,
      contactPageUrl,
      subject: draft.subject,
      draftBody: draft.draftBody,
      personalizationEvidence: draft.personalizationEvidence,
      notes
    };
  } catch (error) {
    const blocked = error instanceof Error && error.message === "BLOCKED_URL";
    return {
      ...base,
      researchStatus: blocked ? "BLOCKED_URL" : "FETCH_ERROR",
      notes: [error instanceof Error ? error.message : "Unknown contact research error.", "No email address was guessed."]
    };
  }
}

export async function researchContactsAndDrafts(
  candidates: GoogleCandidate[],
  audits: WebsiteAudit[] = [],
  concurrency = 3
): Promise<ContactResearchDraft[]> {
  const auditByWebsite = new Map(audits.filter((item) => item.websiteUrl).map((item) => [item.websiteUrl!, item]));
  const results: ContactResearchDraft[] = new Array(candidates.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), candidates.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const candidate = candidates[index]!;
      results[index] = await researchContactAndDraft(candidate, candidate.websiteUrl ? auditByWebsite.get(candidate.websiteUrl) : undefined);
    }
  }));
  return results;
}
