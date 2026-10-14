import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { WebsiteAudit } from "../integrations/website-audit.js";
import { LITE_DEFAULT_MUNICIPALITIES } from "./brreg-lite.js";

// Documentation behind the template sentence "Vi har sett på hvordan bedrifter i deres marked
// presenterer seg digitalt". A segment is industry (NACE code) x region: "deres marked" is the
// recipient's own trade where they compete for local customers. Industry alone would let an
// Oslo hairdresser be told about salons in Tromsø; a single municipality is too small a sample.
//
// Everything in a research file comes from websites that were actually fetched on the stated
// date. Sites that could not be read are listed as such and never counted as examined.

export const LITE_RESEARCH_DIR = "research/segments";
export const LITE_RESEARCH_MAX_AGE_DAYS = 90;
export const LITE_RESEARCH_MIN_EXAMINED = 8;
/** An opportunity is only claimed when at least this share of examined sites shows it. */
export const LITE_RESEARCH_MIN_SHARE = 0.3;

export const LITE_REGIONS: Readonly<Record<string, { name: string; municipalities: readonly string[] }>> = Object.freeze({
  "oslo-akershus": { name: "Oslo og omegn", municipalities: LITE_DEFAULT_MUNICIPALITIES }
});

export type LiteSegment = { key: string; industryCode: string; region: string };

export function regionOfMunicipality(municipalityCode?: string): string | undefined {
  if (!municipalityCode) return undefined;
  return Object.entries(LITE_REGIONS).find(([, region]) => region.municipalities.includes(municipalityCode))?.[0];
}

export function liteSegment(industryCode?: string, region?: string): LiteSegment | undefined {
  const code = industryCode?.trim();
  if (!code || !/^\d{2}\.\d{1,3}$/.test(code) || !region || !LITE_REGIONS[region]) return undefined;
  return { key: `${code}@${region}`, industryCode: code, region };
}

/** Segment of a lead from its intake marker (nace=..., kommune=...). */
export function segmentFromNotes(notes: string): LiteSegment | undefined {
  const nace = /(?:^|\s)nace=(\S+)/.exec(notes)?.[1];
  const kommune = /(?:^|\s)kommune=(\d{4})(?:\s|$)/.exec(notes)?.[1];
  return liteSegment(nace, regionOfMunicipality(kommune));
}

const OBSERVATIONS: Readonly<Record<string, { observed: string; idea: string }>> = Object.freeze({
  MISSING_META_DESCRIPTION: {
    observed: "manglet en beskrivelse som søkemotorer kan vise i søkeresultatet",
    idea: "en kort, tydelig beskrivelse av hva dere tilbyr og hvor, slik at dere skiller dere ut i søkeresultatene"
  },
  NO_CONTACT_LINK: {
    observed: "hadde verken en tydelig kontakt- eller bestillingslenke eller en e-postlenke på forsiden",
    idea: "en synlig kontakt- eller bestillingsknapp på forsiden, så nye kunder kommer i kontakt med ett klikk"
  },
  MISSING_VIEWPORT_META: {
    observed: "var ikke satt opp for visning på mobil",
    idea: "en forside som er tilpasset mobil, der de fleste nye kunder leter"
  },
  NOT_HTTPS: {
    observed: "ble ikke levert over sikker tilkobling (https)",
    idea: "sikker tilkobling (https), så nettleseren ikke advarer besøkende"
  }
});

export type ResearchSite = {
  organizationNumber: string;
  companyName: string;
  url: string;
  checkedAt: string;
  status: WebsiteAudit["status"];
  httpStatus?: number;
  /** Raw audit flags, kept so the send gate can recompute the evidence instead of trusting summaries. */
  flags: string[];
  examined: boolean;
  /** Why a fetched site was not counted. */
  excluded?: "UNREADABLE" | "NO_TITLE" | "DUPLICATE_SITE";
};

export type SegmentResearch = {
  schema: 1;
  id: string;
  segment: LiteSegment;
  industryName?: string;
  regionName: string;
  researchedAt: string;
  method: string;
  attempted: number;
  examined: number;
  sites: ResearchSite[];
  observations: Array<{ flag: string; count: number; text: string }>;
  opportunities: string[];
  followUp: string;
  supportsTemplate: boolean;
};

export type ResearchSampleUnit = { organizationNumber: string; companyName: string; industry?: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Which fetched sites count as examined. Unreadable pages, pages without a title (parked domains,
 * script-only shells, consent walls) and repeats of the same site never count, so they cannot
 * inflate a gap.
 */
function classifySites(sites: Array<Omit<ResearchSite, "examined" | "excluded">>): ResearchSite[] {
  const seen = new Set<string>();
  return sites.map(({ organizationNumber, companyName, url, checkedAt, status, httpStatus, flags }) => {
    const site = { organizationNumber, companyName, url, checkedAt, status, httpStatus, flags: [...(flags ?? [])] };
    const readable = status === "AUDITED" && httpStatus !== undefined && httpStatus < 400 &&
      !site.flags.includes("NON_HTML_RESPONSE") && !site.flags.includes("HTTP_ERROR");
    if (!readable) return { ...site, examined: false, excluded: "UNREADABLE" as const };
    if (site.flags.includes("MISSING_TITLE")) return { ...site, examined: false, excluded: "NO_TITLE" as const };
    const host = hostOf(url);
    if (!host || seen.has(host)) return { ...site, examined: false, excluded: "DUPLICATE_SITE" as const };
    seen.add(host);
    return { ...site, examined: true };
  });
}

/** Observed gaps of one examined site. A mailto link counts as a way to make contact. */
function gapsOf(site: ResearchSite): string[] {
  const gaps = site.flags.filter(flag => flag in OBSERVATIONS);
  if (site.flags.includes("NO_OBVIOUS_CONTACT_PATH") && site.flags.includes("NO_EMAIL_LINK_DETECTED")) gaps.push("NO_CONTACT_LINK");
  return gaps;
}

type Evidence = { examined: number; observations: SegmentResearch["observations"]; strong: string[]; opportunities: string[] };

/** Recomputed from the raw site records, both when the file is written and when it is used. */
function evidenceOf(sites: ResearchSite[]): Evidence {
  const examined = classifySites(sites).filter(site => site.examined);
  const observations = Object.entries(OBSERVATIONS)
    .map(([flag, text]) => ({ flag, count: examined.filter(site => gapsOf(site).includes(flag)).length, text: text.observed }))
    .filter(o => o.count > 0)
    .sort((a, b) => b.count - a.count);
  const strong = observations.filter(o => examined.length >= LITE_RESEARCH_MIN_EXAMINED && o.count / examined.length >= LITE_RESEARCH_MIN_SHARE);
  return {
    examined: examined.length,
    observations,
    strong: strong.map(o => o.flag),
    opportunities: strong.map(o => `${o.count} av ${examined.length} undersøkte nettsider ${o.text}.`)
  };
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Pure: turns real website audits into a dated research record. Nothing is inferred beyond the audits. */
export function buildSegmentResearch(segment: LiteSegment, units: ResearchSampleUnit[], audits: WebsiteAudit[], now: Date): SegmentResearch {
  const region = LITE_REGIONS[segment.region];
  if (!region) throw new Error(`Unknown region ${segment.region}.`);
  const sites = classifySites(audits.map((audit, i) => ({
    organizationNumber: units[i]?.organizationNumber ?? "",
    companyName: units[i]?.companyName ?? audit.companyName,
    url: audit.finalUrl ?? audit.websiteUrl ?? "",
    checkedAt: audit.checkedAt,
    status: audit.status,
    httpStatus: audit.httpStatus,
    flags: audit.flags
  })));
  const evidence = evidenceOf(sites);
  const researchedAt = now.toISOString();
  const research: SegmentResearch = {
    schema: 1,
    id: `${segment.key}@${day(researchedAt)}`,
    segment,
    industryName: units.find(u => u.industry)?.industry,
    regionName: region.name,
    researchedAt,
    method: "Forsiden til hver bedrift i utvalget ble hentet og kontrollert automatisk for søkebeskrivelse, mobiltilpasning, kontakt- og e-postlenke og https. Sider som ikke kunne leses, sider uten tittel og gjentatte nettsteder er ikke regnet med. Utvalget er aktive AS/ASA med registrert nettside i Brønnøysundregistrene, samme næringskode og region.",
    attempted: sites.length,
    examined: evidence.examined,
    sites,
    observations: evidence.observations,
    opportunities: evidence.opportunities,
    followUp: "",
    supportsTemplate: evidence.strong.length > 0
  };
  research.followUp = followUpText(research, evidence.strong);
  return research;
}

function norwegianDate(iso: string): string {
  const [y, m, d] = day(iso).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}

function followUpText(research: SegmentResearch, flags: string[]): string {
  const trade = research.industryName ? `innen ${research.industryName.toLowerCase()}` : `med næringskode ${research.segment.industryCode}`;
  return [
    "Hei igjen, og takk for svaret.",
    "",
    `Den ${norwegianDate(research.researchedAt)} gjorde vi en automatisk gjennomgang av forsidene til ${research.examined} bedrifter ${trade} i ${research.regionName}. Dette gikk igjen:`,
    ...research.opportunities.map(line => `- ${line}`),
    "",
    "Idéen vår er å starte med det som gjør det enklest for nye kunder å finne dere og ta kontakt:",
    ...flags.map(flag => `- ${OBSERVATIONS[flag]!.idea}`),
    "",
    "Vi har ikke gjort en egen vurdering av deres nettside. Hvis dere ønsker det, ser vi gjerne på den sammen med dere og sier konkret hva vi ville gjort først.",
    "",
    "Mvh",
    "Jelassi",
    "Cidea Marketing"
  ].join("\n");
}

export type ResearchDecision = { ok: true; research: SegmentResearch } | { ok: false; reason: "NO_SEGMENT" | "NO_RESEARCH" | "RESEARCH_STALE" | "RESEARCH_INSUFFICIENT" };

/**
 * The send gate: documentation must exist for exactly this segment, be fresh, and support the claim.
 * The evidence is recomputed from the stored site records; the file's own summary is not trusted.
 */
export function assessResearch(segment: LiteSegment | undefined, research: SegmentResearch | undefined, nowMs: number): ResearchDecision {
  if (!segment) return { ok: false, reason: "NO_SEGMENT" };
  if (!research || research.segment?.key !== segment.key) return { ok: false, reason: "NO_RESEARCH" };
  const age = nowMs - Date.parse(research.researchedAt);
  if (!Number.isFinite(age) || age < 0 || age > LITE_RESEARCH_MAX_AGE_DAYS * 86_400_000) return { ok: false, reason: "RESEARCH_STALE" };
  const evidence = evidenceOf(Array.isArray(research.sites) ? research.sites : []);
  if (evidence.strong.length === 0 || evidence.examined !== research.examined ||
      evidence.opportunities.join("\n") !== (research.opportunities ?? []).join("\n")) {
    return { ok: false, reason: "RESEARCH_INSUFFICIENT" };
  }
  return { ok: true, research };
}

export function researchFileName(segment: LiteSegment): string {
  return `${segment.industryCode.replace(".", "_")}__${segment.region}.json`;
}

/** Newest research per segment key. */
export async function loadResearchIndex(dir = LITE_RESEARCH_DIR): Promise<Map<string, SegmentResearch>> {
  const index = new Map<string, SegmentResearch>();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return index;
  }
  for (const file of files.filter(f => f.endsWith(".json")).sort()) {
    const research = JSON.parse(await readFile(path.join(dir, file), "utf8")) as SegmentResearch;
    if (research.schema !== 1 || !research.segment?.key) throw new Error(`Invalid research file ${file}.`);
    const current = index.get(research.segment.key);
    if (!current || current.researchedAt < research.researchedAt) index.set(research.segment.key, research);
  }
  return index;
}

export async function saveResearch(research: SegmentResearch, dir = LITE_RESEARCH_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, researchFileName(research.segment));
  await writeFile(file, JSON.stringify(research, null, 2) + "\n", "utf8");
  return file;
}

/** Segments with usable research now: the scheduled intake fetches only these. */
export function documentedSegments(index: Map<string, SegmentResearch>, nowMs: number): LiteSegment[] {
  return [...index.values()].filter(r => assessResearch(r.segment, r, nowMs).ok).map(r => r.segment);
}

/** Records which research a send relied on, replacing any earlier reference. */
export function withResearchRef(notes: string, researchId: string): string {
  return `${notes.replace(/\s+research=\S+/g, "").trimEnd()} research=${researchId}`;
}

/** Picks n units spread evenly over the list, so the sample is not just the first page of the register. */
export function spreadSample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]!);
}
