// Brønnøysund (Enhetsregisteret) as the Lite volume source. Uses only the public open-data API.
// The organisation form is filtered in the query AND checked again per unit (fail closed).

export type BrregLiteCandidate = {
  organizationNumber: string;
  companyName: string;
  orgForm: string;
  websiteUrl?: string;
  email?: string;
  city?: string;
  municipalityCode?: string;
  industry?: string;
  industryCode?: string;
  employeeCount?: number;
  bankrupt: boolean;
  windingUp: boolean;
  sourceUrl: string;
};

type BrregUnit = {
  organisasjonsnummer?: string;
  navn?: string;
  organisasjonsform?: { kode?: string };
  slettedato?: string;
  hjemmeside?: string;
  epostadresse?: string;
  antallAnsatte?: number;
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  forretningsadresse?: { kommune?: string; kommunenummer?: string };
  naeringskode1?: { kode?: string; beskrivelse?: string };
};

type BrregPage = { _embedded?: { enheter?: BrregUnit[] }; page?: { totalPages?: number } };

const API = "https://data.brreg.no/enhetsregisteret/api/enheter";

// Oslo and Akershus municipalities (same set as the existing Brreg adapter).
export const LITE_DEFAULT_MUNICIPALITIES: readonly string[] = Object.freeze([
  "0301", "3201", "3203", "3205", "3207", "3209", "3222", "3228"
]);

export type BrregLiteOptions = {
  municipalities?: readonly string[];
  orgForms?: readonly string[];
  /** Optional NACE codes, e.g. "96.021" (hairdressers). Empty = all industries. */
  industryCodes?: readonly string[];
  /** SMB upper bound on registered employees (default 249). */
  maxEmployees?: number;
  pagesPerQuery?: number;
  /** First page to read; rotate it between runs so daily intake moves through the register. */
  startPage?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
};

export function toLiteCandidate(unit: BrregUnit): BrregLiteCandidate | undefined {
  const organizationNumber = unit.organisasjonsnummer?.trim() ?? "";
  const companyName = unit.navn?.trim() ?? "";
  const orgForm = unit.organisasjonsform?.kode?.trim().toUpperCase() ?? "";
  if (!/^\d{9}$/.test(organizationNumber) || !companyName || !orgForm || unit.slettedato) return undefined;
  const website = unit.hjemmeside?.trim();
  const email = unit.epostadresse?.trim().toLowerCase();
  return {
    organizationNumber,
    companyName,
    orgForm,
    websiteUrl: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : undefined,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    city: unit.forretningsadresse?.kommune,
    municipalityCode: unit.forretningsadresse?.kommunenummer,
    industry: unit.naeringskode1?.beskrivelse,
    industryCode: unit.naeringskode1?.kode,
    employeeCount: Number.isInteger(unit.antallAnsatte) ? unit.antallAnsatte : undefined,
    bankrupt: unit.konkurs === true,
    windingUp: unit.underAvvikling === true || unit.underTvangsavviklingEllerTvangsopplosning === true,
    sourceUrl: `${API}/${organizationNumber}`
  };
}

// Checked in code as well as in the query: the website lookup has no employee filter.
function tooLarge(candidate: BrregLiteCandidate, maxEmployees: number): boolean {
  return candidate.employeeCount !== undefined && candidate.employeeCount > maxEmployees;
}

async function fetchPage(url: URL, fetchImpl: typeof fetch): Promise<BrregPage> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`BRREG_REQUEST_FAILED status=${response.status}`);
  return await response.json() as BrregPage;
}

/**
 * How many active units Brreg registers under a NACE code nationwide. Brreg classifies by SN2025
 * since 2025, so a code from SN2007 (or a typo) returns 0: research and intake skip it instead of
 * documenting an empty segment.
 */
export async function brregIndustryTotal(industryCode: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const url = new URL(API);
  url.searchParams.set("naeringskode", industryCode);
  url.searchParams.set("konkurs", "false");
  url.searchParams.set("size", "1");
  const payload = await fetchPage(url, fetchImpl) as BrregPage & { page?: { totalElements?: number } };
  const total = payload.page?.totalElements;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) throw new Error("BRREG_INVALID_TOTAL");
  return total;
}

export async function discoverBrregLiteCandidates(options: BrregLiteOptions = {}): Promise<BrregLiteCandidate[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const municipalities = options.municipalities?.length ? options.municipalities : LITE_DEFAULT_MUNICIPALITIES;
  const orgForms = options.orgForms?.length ? options.orgForms : ["AS"];
  const industries = options.industryCodes?.length ? options.industryCodes : [undefined];
  const pages = Math.min(Math.max(options.pagesPerQuery ?? 3, 1), 20);
  const size = Math.min(Math.max(options.pageSize ?? 100, 1), 100);
  const maxEmployees = options.maxEmployees ?? 249;
  // Enhetsregisteret serves at most 10 000 results per query (page x size).
  const startPage = Math.min(Math.max(options.startPage ?? 0, 0), Math.floor(10000 / size) - 1);
  const found = new Map<string, BrregLiteCandidate>();

  for (const municipality of municipalities) {
    for (const orgForm of orgForms) {
      for (const industry of industries) {
        for (let page = startPage; page < startPage + pages && (page + 1) * size <= 10000; page++) {
          const url = new URL(API);
          url.searchParams.set("kommunenummer", municipality);
          url.searchParams.set("organisasjonsform", orgForm);
          if (industry) url.searchParams.set("naeringskode", industry);
          url.searchParams.set("konkurs", "false");
          url.searchParams.set("underAvvikling", "false");
          url.searchParams.set("underTvangsavviklingEllerTvangsopplosning", "false");
          url.searchParams.set("tilAntallAnsatte", String(maxEmployees));
          url.searchParams.set("size", String(size));
          url.searchParams.set("page", String(page));
          const payload = await fetchPage(url, fetchImpl);
          const units = payload._embedded?.enheter ?? [];
          for (const unit of units) {
            const candidate = toLiteCandidate(unit);
            if (candidate && !tooLarge(candidate, maxEmployees)) found.set(candidate.organizationNumber, candidate);
          }
          const totalPages = payload.page?.totalPages;
          if (units.length === 0 || (typeof totalPages === "number" && page + 1 >= totalPages)) break;
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * For Places supplement leads: find the registered unit by website. Returns a candidate only when
 * exactly one active unit is registered with that website; anything else is "unknown" (undefined).
 */
export async function lookupBrregByWebsite(websiteUrl: string, fetchImpl: typeof fetch = fetch): Promise<BrregLiteCandidate | undefined> {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  if (!host.includes(".")) return undefined;
  const matches = new Map<string, BrregLiteCandidate>();
  for (const variant of [host, `www.${host}`]) {
    const url = new URL(API);
    url.searchParams.set("hjemmeside", variant);
    url.searchParams.set("size", "20");
    const payload = await fetchPage(url, fetchImpl);
    for (const unit of payload._embedded?.enheter ?? []) {
      const candidate = toLiteCandidate(unit);
      if (candidate) matches.set(candidate.organizationNumber, candidate);
    }
  }
  const match = matches.size === 1 ? [...matches.values()][0] : undefined;
  return match && !tooLarge(match, 249) ? match : undefined;
}
