import { websiteAuditSchema, cideaTargetSchema, TARGET_PRIORITIES, type AuditCategory, type CideaTarget } from "../domain/website-audit.js";
import { cideaTargets } from "../domain/cidea-targets.js";

const url = process.argv[2];
const targetInput = process.argv[3] ?? "CideaLead";

if (!url) {
  throw new Error("Usage: npm run audit:website -- <url> [CideaLead|CideaMarketing|CideaConsulting]");
}

const target = cideaTargetSchema.parse(targetInput) as CideaTarget;
const parsedUrl = new URL(url);

const response = await fetch(parsedUrl, {
  headers: { "User-Agent": "Cidea Website Improvement Engine/0.1" },
  signal: AbortSignal.timeout(15_000)
});

if (!response.ok) {
  throw new Error(`WEBSITE_FETCH_FAILED_${response.status}`);
}

const html = await response.text();
const title = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)?.[1]?.trim() ?? "";
const metaDescription = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
const h1Count = (html.match(/<h1\\b/gi) ?? []).length;
const viewport = /name=["']viewport["']/i.test(html);
const hasHttps = parsedUrl.protocol === "https:";
const hasCta = /(kontakt|contact|bestill|book|kom i gang|get started|ta kontakt)/i.test(html);
const wordCount = html.replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]+>/g, " ").split(/\\s+/).filter(Boolean).length;

const scores: Record<AuditCategory, number> = {
  UX: viewport ? 70 : 45,
  SEO: title && metaDescription && h1Count === 1 ? 75 : 50,
  CRO: hasCta ? 70 : 40,
  DESIGN: 60,
  CONTENT: wordCount >= 250 ? 70 : 45,
  PERFORMANCE: 60,
  TRUST: hasHttps ? 70 : 35
};

const findings = [];
if (!title) findings.push({category:"SEO", severity:"high", title:"Missing page title", observation:"No HTML title was detected.", recommendation:"Add a clear, intent-focused page title.", evidence:[{sourceUrl:url,observation:"Page source contains no detectable title element."}], confidence:0.99});
if (!metaDescription) findings.push({category:"SEO", severity:"medium", title:"Missing meta description", observation:"No meta description was detected.", recommendation:"Add a concise description aligned with the primary search intent.", evidence:[{sourceUrl:url,observation:"Page source contains no detectable meta description."}], confidence:0.98});
if (!viewport) findings.push({category:"UX", severity:"high", title:"Missing viewport configuration", observation:"A mobile viewport declaration was not detected.", recommendation:"Add a responsive viewport configuration and verify mobile layouts.", evidence:[{sourceUrl:url,observation:"Page source contains no detectable viewport meta tag."}], confidence:0.99});
if (h1Count !== 1) findings.push({category:"SEO", severity:"medium", title:"Heading hierarchy needs review", observation:`Detected ${h1Count} H1 elements.`, recommendation:"Use one clear primary H1 and structure supporting headings underneath it.", evidence:[{sourceUrl:url,observation:`Detected ${h1Count} H1 elements in the fetched page.`}], confidence:0.97});
if (!hasCta) findings.push({category:"CRO", severity:"high", title:"Primary contact action is unclear", observation:"No obvious contact, booking or conversion CTA was detected in the page source.", recommendation:"Introduce a clear primary next step aligned with the target audience.", evidence:[{sourceUrl:url,observation:"No common contact or conversion CTA text was detected."}], confidence:0.82});
if (!hasHttps) findings.push({category:"TRUST", severity:"critical", title:"HTTPS is not used", observation:"The supplied URL is not HTTPS.", recommendation:"Serve the production site over HTTPS.", evidence:[{sourceUrl:url,observation:"Supplied URL uses HTTP."}], confidence:1});

const priorities = TARGET_PRIORITIES[target]
  .map(category => findings.find(f => f.category === category))
  .filter(Boolean)
  .slice(0,5)
  .map(f => f!.title);

const audit = websiteAuditSchema.parse({
  target,
  websiteUrl: url,
  auditedAt: new Date().toISOString(),
  scores,
  findings,
  topPriorities: priorities,
  status: "review_required"
});

console.log(JSON.stringify({
  ...audit,
  targetPurpose: cideaTargets[target].purpose,
  primaryQuestion: cideaTargets[target].primaryQuestion,
  note: "This is the deterministic baseline audit. Firecrawl, Agent Reach, JEV, Browser Use and Hermes adapters are intentionally separate next steps."
}, null, 2));
