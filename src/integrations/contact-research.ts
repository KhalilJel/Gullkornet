import type { ProviderAttempt } from "../domain/research-evidence.js";
import type { RoutingAssessment } from "../domain/cidea-routing.js";
import { readBodyBounded } from "./bounded-read.js";
import { buildRoutingForCompany, type ResearchProvenance } from "./company-dossier.js";
import {
  DEFAULT_ROUTER_POLICY,
  escalateResearch,
  type BuiltinOutcome,
  type ResearchProviders,
  type RouterPolicy,
  type RouterState
} from "./research-router.js";
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
  industry?: string;
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
  /** Auditable Cidea routing for this company; also summarised in `notes` for Airtable. */
  routing?: RoutingAssessment;
  providerAttempts?: ProviderAttempt[];
};

/** Optional escalation providers. Without them the research behaves exactly as before. */
export type ResearchDeps = {
  providers: ResearchProviders;
  state: RouterState;
  policy?: RouterPolicy;
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
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string): string {
  return decodeText(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|header|footer|aside|button|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

const BODY_READ_DEADLINE_MS = 15_000;

async function readHtml(response: Response): Promise<string> {
  return readBodyBounded(response, MAX_HTML_BYTES, BODY_READ_DEADLINE_MS);
}

async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: string; status: number }> {
  let currentUrl = rawUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!(await isSafePublicUrl(currentUrl))) throw new Error("BLOCKED_URL");
    let response: Response | undefined;
    let lastError: unknown;
    // Retry one transient network/timeout failure. Keep the retry bounded and
    // do not retry HTTP responses, redirects, or URL safety rejections.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": "GullkornetContactResearch/0.1 (public business website research)" }
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 1) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!response) throw lastError instanceof Error ? lastError : new Error("FETCH_FAILED");
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

function isLikelyPublicBusinessEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  // Exclude obvious placeholders and technical telemetry, while retaining alternate
  // legitimate domains for human review (e.g. parent-company inboxes).
  if (localPart.startsWith("/") || /(?:^|\.)sentry(?:-next)?\.wixpress\.com$|^sentry\.io$/i.test(domain)) return false;
  if (/^(?:example\.(?:com|org|net)|website\.com|yourdomain\.(?:com|no)|domain\.com|test\.com)$/i.test(domain)) return false;
  if (/^(?:yourname|name|email|user)@/i.test(normalized)) return false;
  return true;
}

export function extractPublicEmails(html: string, sourceUrl: string): PublicEmail[] {
  const results: PublicEmail[] = [];
  const seen = new Set<string>();
  const mailtos = html.match(/href\s*=\s*["']mailto:([^"'?\s]+)(?:\?[^"']*)?["']/gi) ?? [];
  for (const tag of mailtos) {
    const match = tag.match(/mailto:([^"'?\s]+)/i);
    let email: string | undefined;
    if (match?.[1]) {
      try {
        email = decodeURIComponent(match[1]).trim().toLowerCase();
      } catch {
        // Ignore malformed percent-encoding instead of retaining a broken address.
      }
    }
    if (email && EMAIL_PATTERN.test(email) && isLikelyPublicBusinessEmail(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, sourceUrl, sourceType: "mailto" });
    }
    EMAIL_PATTERN.lastIndex = 0;
  }
  const visibleText = stripHtml(html);
  for (const match of visibleText.matchAll(EMAIL_PATTERN)) {
    const email = match[0].toLowerCase();
    if (isLikelyPublicBusinessEmail(email) && !seen.has(email)) {
      seen.add(email);
      results.push({ email, sourceUrl, sourceType: "visible_text" });
    }
  }
  return results.filter((item) => !/\.(png|jpe?g|gif|webp|svg)$/i.test(item.email));
}

export function extractEvidence(html: string): { headline?: string; serviceEvidence?: string } {
  const headline = getTagText(html, "h1");
  const text = stripHtml(html);
  const sentenceCandidates = text.split(/[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length >= 35 && s.length <= 220);
  const serviceTerms = /regnskap|regnskapsfør|bokfør|lønn|årsoppgjør|økonomirådgivning|rådgivning|skatt|mva|accounting|bookkeeping|frisør|frisørsalong|hair salon|tannlege|tannbehandling|dental|fysioterapi|fysioterapeut|physiotherapy|elektriker|elektroinstallasjon|electrical installation|rørlegger|rørleggertjenester|plumbing|bilverksted|bilreparasjon|auto repair|renhold|rengjøring|cleaning services|restaurant|spisested|servering|treningssenter|personlig trener|fitness center|gym|barber|barbershop|barberhåndverk|balayage|keratin|brudeoppsett|hårklipp|hårfarge|haircut|hair coloring|hudpleie|ansiktsbehandling/i;
  const serviceEvidence = sentenceCandidates.find((s) => serviceTerms.test(s) && isUsefulServiceEvidence(s))
    ?? (() => {
      const metaDescription = html.match(/<meta\b[^>]*name\s*=\s*["']?description\b[^>]*>/i)?.[0];
      const contentMatch = metaDescription?.match(/\bcontent\s*=\s*["']([^"']*)["']/i)
        ?? metaDescription?.match(/\bcontent\s*=\s*([^\s>]+)/i);
      const description = contentMatch?.[1] ? stripHtml(contentMatch[1]) : "";
      return description.length >= 35 && description.length <= 220 && serviceTerms.test(description)
        ? description
        : undefined;
    })();
  return { headline, serviceEvidence };
}

function normalizeEvidence(value: string): string {
  return value.toLocaleLowerCase("nb-NO").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isUsefulServiceEvidence(value?: string): value is string {
  if (!value || value.trim().length < 35) return false;
  const serviceTerms = /regnskap|regnskapsfør|bokfør|lønn|årsoppgjør|økonomirådgivning|rådgivning|skatt|mva|accounting|bookkeeping|frisør|frisørsalong|hair salon|tannlege|tannbehandling|dental|fysioterapi|fysioterapeut|physiotherapy|elektriker|elektroinstallasjon|electrical installation|rørlegger|rørleggertjenester|plumbing|bilverksted|bilreparasjon|auto repair|renhold|rengjøring|cleaning services|restaurant|spisested|servering|treningssenter|personlig trener|fitness center|gym|barber|barbershop|barberhåndverk|balayage|keratin|brudeoppsett|hårklipp|hårfarge|haircut|hair coloring|hudpleie|ansiktsbehandling/i;
  if (!serviceTerms.test(value)) return false;
  const navigationTerms = value.match(/\b(hjem|søk|kontakt oss|kontakt|om oss|tjenester|meny|personvern|cookies|logg inn|skip to content|hopp rett til innholdet|hopp til innholdet|finn oss|åpningstider|nyttige linker|ansatte)\b/gi) ?? [];
  const phoneNumbers = value.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [];
  const decodedEntityNoise = /&#(?:x[\da-f]+|\d+);/i.test(value);
  const markupResidue = /\{\{[^}]+\}\}|\bdata-[\w-]+\s*=|[<>]/i.test(value);
  const spacedLetterNoise = /(?:\b[A-Z]\s+){3,}[A-Z]\b/i.test(value);
  return navigationTerms.length === 0 && phoneNumbers.length === 0 && !decodedEntityNoise && !markupResidue && !spacedLetterNoise && !/\b(?:followers|likes)\b/i.test(value);
}

export function createPersonalizedDraft(
  candidate: GoogleCandidate,
  title?: string,
  headline?: string,
  serviceEvidence?: string,
  audit?: WebsiteAudit,
  sourceUrl?: string,
  sourceCheckedAt?: string,
  additionalSourceUrls: string[] = []
): {
  subject?: string; draftBody?: string; personalizationEvidence?: string; notes: string[];
} {
  const notes: string[] = [];

  // Website audit flags are internal research context, never customer-facing claims.
  if (audit?.status === "AUDITED" && audit.flags.length > 0) {
    notes.push("Website signals are internal research context only; they are not presented as a specific customer-facing finding.");
  }

  const evidenceText = [title, headline, serviceEvidence].filter(Boolean).join(" ");
  const serviceVocabulary: Array<[RegExp, string]> = [
    [/regnskapsfør|regnskap|bokfør|accounting|bookkeeping/i, "regnskap"],
    [/lønn|payroll/i, "lønn"],
    [/årsoppgjør|annual accounts/i, "årsoppgjør"],
    [/skatt|tax/i, "skatterådgivning"],
    [/tannlege|tannbehandling|dental/i, "tannbehandling"],
    [/fysioterapi|fysioterapeut|physiotherapy/i, "fysioterapi"],
    [/balayage/i, "balayage"],
    [/keratin(?:behandling)?/i, "keratinbehandlinger"],
    [/brudeoppsett/i, "brudeoppsett"],
    [/hårklipp|haircut/i, "hårklipp"],
    [/hårfarge|hair coloring/i, "hårfarging"],
    [/barberhåndverk|barber|barbershop/i, "barberhåndverk"],
    [/skjegg/i, "skjeggstell"],
    [/hudpleie|ansiktsbehandling/i, "hudpleie"],
    [/elektriker|elektroinstallasjon|electrical installation/i, "elektrikertjenester"],
    [/rørlegger|rørleggertjenester|plumbing/i, "rørleggertjenester"],
    [/bilverksted|bilreparasjon|auto repair/i, "bilservice"],
    [/renhold|rengjøring|cleaning services/i, "renhold"],
    [/restaurant|spisested|servering/i, "servering"],
    [/treningssenter|personlig trener|fitness center|gym/i, "trening"],
    [/frisør|frisørsalong|hair salon/i, "frisørtjenester"]
  ];
  const observedServices = serviceVocabulary
    .filter(([pattern]) => pattern.test(evidenceText))
    .map(([, label]) => label)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 2);

  const observedFacts = [
    title ? "Observed page title: " + title.trim().slice(0, 220) : undefined,
    headline ? "Observed headline: " + headline.trim().slice(0, 220) : undefined,
    serviceEvidence ? "Observed service text: " + serviceEvidence.trim().slice(0, 220) : undefined,
    observedServices.length ? "Extracted service cues (internal only): " + observedServices.join(", ") : undefined
  ].filter((item): item is string => Boolean(item));

  if (observedFacts.length === 0) {
    notes.push("No meaningful page content was extracted. Draft is a general conversation opener and requires human review.");
  }

  const resolvedSourceUrl = sourceUrl ?? audit?.finalUrl ?? candidate.websiteUrl;
  const checkedAt = sourceCheckedAt ?? audit?.checkedAt;
  const sourceDetails = [
    resolvedSourceUrl ? "Source URL: " + resolvedSourceUrl : "Source URL unavailable",
    checkedAt ? "checked at " + checkedAt : undefined,
    additionalSourceUrls.length ? "Additional source URLs: " + [...new Set(additionalSourceUrls)].join(", ") : undefined,
    observedFacts.length ? "Observations (internal only): " + observedFacts.join(" | ") : "No specific page observation extracted; generic template only"
  ].filter((item): item is string => Boolean(item));

  const subject = observedServices.length
    ? "Et lite spørsmål til " + candidate.companyName.trim()
    : "Dette la vi merke til hos dere";
  // Put only service cues extracted from the public site into the email. Keep
  // audit flags and unverified opportunities internal to the review record.
  const draftBody = [
    "Hei!",
    "",
    observedServices.length
      ? "Jeg la merke til at dere fremhever " + observedServices.join(" og ") + " på nettsiden."
      : "Jeg kom over nettsiden deres og ville gjerne dele en kort idé.",
    "",
    "Cidea hjelper bedrifter med nettsider, branding og digital markedsføring. Kunne det vært interessant om jeg sendte en kort idé til hvordan dere kan synliggjøre tilbudet deres enda tydeligere på nett?",
    "",
    "Hvis slike henvendelser ikke er ønsket, svar «nei takk», så registrerer vi det.",
    "",
    "Mvh Jelassi"
  ].join("\n");

  return {
    subject,
    draftBody,
    personalizationEvidence: (observedServices.length
      ? "Uses source-grounded service cues in the message; website observations are not presented as a verified problem. "
      : "No supported service cue was extracted; fallback draft still requires human review. ") + sourceDetails.join("; "),
    notes
  };
}

type ResearchContext = { provenance: ResearchProvenance };

export async function researchContactAndDraft(
  candidate: GoogleCandidate,
  audit?: WebsiteAudit,
  deps?: ResearchDeps
): Promise<ContactResearchDraft> {
  const context: ResearchContext = { provenance: { attempts: [], builtinReadable: false } };
  const result = await researchContactAndDraftCore(candidate, audit, deps, context);
  try {
    const { assessment, notes } = buildRoutingForCompany(candidate, audit, context.provenance);
    return { ...result, notes: [...result.notes, ...notes], routing: assessment, providerAttempts: context.provenance.attempts };
  } catch {
    // Routing is advisory. A failure here must never lose the research result.
    return result;
  }
}

async function researchContactAndDraftCore(
  candidate: GoogleCandidate,
  audit: WebsiteAudit | undefined,
  deps: ResearchDeps | undefined,
  context: ResearchContext
): Promise<ContactResearchDraft> {
  const researchedAt = new Date().toISOString();
  const base = {
    companyName: candidate.companyName,
    websiteUrl: candidate.websiteUrl,
    city: candidate.city,
    industry: candidate.industry,
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
    let fetched: { html: string; finalUrl: string; status: number } | undefined;
    let fetchFailure: string | undefined;
    try {
      fetched = await fetchHtml(candidate.websiteUrl);
    } catch (error) {
      if (error instanceof Error && error.message === "BLOCKED_URL") throw error;
      fetchFailure = error instanceof Error ? error.message : "FETCH_FAILED";
    }
    const readable = Boolean(fetched && fetched.status < 400 && fetched.html);
    const minText = (deps?.policy ?? DEFAULT_ROUTER_POLICY).minTextLength;
    const textLength = readable ? stripHtml(fetched!.html).length : 0;
    context.provenance.builtinReadable = readable;

    // Escalate only when the free built-in fetch did not produce enough readable content.
    let scraped: { markdown: string; url: string; title?: string } | undefined;
    if (deps && (!readable || textLength < minText)) {
      const builtin: BuiltinOutcome = {
        ok: readable, textLength, httpStatus: fetched?.status,
        reason: fetchFailure ?? (readable ? undefined : "NO_READABLE_HTML")
      };
      const escalation = await escalateResearch({ url: candidate.websiteUrl, builtin }, deps.providers, deps.state, deps.policy);
      context.provenance.attempts.push(...escalation.attempts);
      if (escalation.page?.markdown) {
        scraped = { markdown: escalation.page.markdown, url: escalation.page.url, title: escalation.page.title };
        context.provenance.scrapedPage = escalation.page;
        const ok = escalation.attempts.find((attempt) => attempt.outcome === "ok");
        if (ok && (ok.provider === "firecrawl" || ok.provider === "jev-ultrafast" || ok.provider === "browser-use")) {
          context.provenance.scrapedBy = ok.provider;
        }
      }
    }

    if (!readable && !scraped) {
      return { ...base, researchStatus: "FETCH_ERROR", notes: ["Homepage did not return readable HTML.", "No email address was guessed."] };
    }
    // Scraped markdown is plain text, so the same extractors apply to it; it is never fetched again.
    const homepage = readable
      ? fetched!
      : { html: scraped!.markdown, finalUrl: scraped!.url, status: 200 };

    const title = getTitle(homepage.html) ?? scraped?.title ?? audit?.title;
    const evidence = extractEvidence(homepage.html);
    const emails = extractPublicEmails(homepage.html, homepage.finalUrl);
    if (readable && scraped) {
      // Thin built-in page: add what the scrape found without replacing the verified page.
      const extra = extractEvidence(scraped.markdown);
      evidence.headline ??= extra.headline;
      evidence.serviceEvidence ??= extra.serviceEvidence;
      emails.push(...extractPublicEmails(scraped.markdown, scraped.url));
    }
    const contactUrls = readable ? getContactLinks(homepage.html, homepage.finalUrl) : [];
    let contactPageUrl: string | undefined;
    for (const url of contactUrls) {
      try {
        const page = await fetchHtml(url);
        if (page.status >= 400 || !page.html) continue;
        contactPageUrl ??= page.finalUrl;
        emails.push(...extractPublicEmails(page.html, page.finalUrl));
        const contactEvidence = extractEvidence(page.html);
        evidence.headline ??= contactEvidence.headline;
        evidence.serviceEvidence ??= contactEvidence.serviceEvidence;
        if (emails.length >= 8) break;
      } catch {
        // One failed contact page should not prevent research of the homepage.
      }
    }

    const uniqueEmails = [...new Map(emails.map((item) => [item.email, item])).values()].slice(0, 10);
    const websiteHost = new URL(homepage.finalUrl).hostname.toLowerCase().replace(/^www\./, "");
    let submittedWebsiteHost: string | undefined;
    try {
      submittedWebsiteHost = new URL(candidate.websiteUrl!).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      // The URL has already passed safe-fetch validation; retain review flags if normalization fails.
    }
    const websiteRedirectedToDifferentHost = Boolean(submittedWebsiteHost && submittedWebsiteHost !== websiteHost);
    const offDomainEmails = uniqueEmails.filter((item) => {
      const emailDomain = item.email.split("@").pop()?.toLowerCase() ?? "";
      return emailDomain !== websiteHost && !emailDomain.endsWith("." + websiteHost);
    });
    const emailsFromOtherPages = uniqueEmails.filter((item) => {
      try {
        return new URL(item.sourceUrl).hostname.toLowerCase().replace(/^www\./, "") !== websiteHost;
      } catch {
        return true;
      }
    });
    const draft = createPersonalizedDraft(
      candidate,
      title,
      evidence.headline,
      evidence.serviceEvidence,
      audit,
      homepage.finalUrl,
      researchedAt,
      contactPageUrl ? [contactPageUrl] : []
    );
    const notes = [...draft.notes];
    if (uniqueEmails.length === 0) notes.push("No public email address found on the checked pages. Do not guess an address.");
    else notes.push("Email addresses were extracted from publicly accessible pages; mailbox deliverability and recipient role are not verified.");
    if (websiteRedirectedToDifferentHost) notes.push("MANUAL REVIEW: The submitted website redirected from " + submittedWebsiteHost + " to " + websiteHost + ". Confirm the destination belongs to the named business before using any contact details.");
    if (offDomainEmails.length > 0) notes.push("MANUAL REVIEW: " + offDomainEmails.length + " email address(es) use a domain different from the final website host. This can be legitimate, but the recipient relationship must be verified.");
    if (emailsFromOtherPages.length > 0) notes.push("MANUAL REVIEW: " + emailsFromOtherPages.length + " address(es) were sourced from a page hosted on a different domain than the homepage.");
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
  concurrency = 3,
  deps?: ResearchDeps
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
      results[index] = await researchContactAndDraft(candidate, candidate.websiteUrl ? auditByWebsite.get(candidate.websiteUrl) : undefined, deps);
    }
  }));
  return results;
}
