export type BrregCandidate = {
  organizationNumber: string;
  companyName: string;
  websiteUrl?: string;
  contactEmail?: string;
  city?: string;
  industry?: string;
  employeeCount?: number;
  sourceUrl: string;
};

type BrregUnit = {
  organisasjonsnummer?: string;
  navn?: string;
  slettedato?: string;
  hjemmeside?: string;
  epostadresse?: string;
  antallAnsatte?: number;
  forretningsadresse?: {
    kommune?: string;
    kommunenummer?: string;
  };
  naeringskode1?: {
    beskrivelse?: string;
  };
};

type BrregPage = {
  _embedded?: {
    enheter?: BrregUnit[];
  };
  page?: {
    totalPages?: number;
  };
};

const DEFAULT_MUNICIPALITIES = [
  "0301", // Oslo
  "3201", // Bærum
  "3203", // Asker
  "3205", // Lillestrøm
  "3207", // Nordre Follo
  "3209", // Ullensaker
  "3222", // Lørenskog
  "3228"  // Nittedal
];

export type BrregDiscoveryOptions = {
  searchTerm?: string;
  municipalities?: string[];
  pagesPerMunicipality?: number;
  fetchImpl?: typeof fetch;
};

function normalizeWebsite(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeEmail(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

export async function discoverBrregCandidates(
  options: BrregDiscoveryOptions = {}
): Promise<BrregCandidate[]> {
  const searchTerm = options.searchTerm?.trim() || "regnskap";
  const municipalities = options.municipalities ?? DEFAULT_MUNICIPALITIES;
  const pagesPerMunicipality = Math.min(Math.max(options.pagesPerMunicipality ?? 2, 1), 5);
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = new Map<string, BrregCandidate>();

  for (const municipalityCode of municipalities) {
    for (let page = 0; page < pagesPerMunicipality; page += 1) {
      const url = new URL("https://data.brreg.no/enhetsregisteret/api/enheter");
      url.searchParams.set("navn", searchTerm);
      url.searchParams.set("kommunenummer", municipalityCode);
      url.searchParams.set("size", "100");
      url.searchParams.set("page", String(page));

      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        throw new Error(`BRREG_REQUEST_FAILED status=${response.status} municipality=${municipalityCode}`);
      }

      const payload = await response.json() as BrregPage;
      const units = payload._embedded?.enheter ?? [];

      for (const unit of units) {
        const organizationNumber = unit.organisasjonsnummer?.trim();
        const companyName = unit.navn?.trim();
        if (!organizationNumber || !/^\d{9}$/.test(organizationNumber) || !companyName || unit.slettedato) continue;

        candidates.set(organizationNumber, {
          organizationNumber,
          companyName,
          websiteUrl: normalizeWebsite(unit.hjemmeside),
          contactEmail: normalizeEmail(unit.epostadresse),
          city: unit.forretningsadresse?.kommune,
          industry: unit.naeringskode1?.beskrivelse,
          employeeCount: Number.isInteger(unit.antallAnsatte) && (unit.antallAnsatte ?? 0) >= 0
            ? unit.antallAnsatte
            : undefined,
          sourceUrl: `https://data.brreg.no/enhetsregisteret/api/enheter/${organizationNumber}`
        });
      }

      const totalPages = payload.page?.totalPages;
      if (typeof totalPages === "number" && page + 1 >= totalPages) break;
      if (units.length === 0) break;
    }
  }

  return [...candidates.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, "nb"));
}
