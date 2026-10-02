export type GooglePlacesCandidate = {
  companyName: string;
  websiteUrl?: string;
  city: string;
  industry: string;
  sourceUrl?: string;
};

type GooglePlace = {
  displayName?: { text?: string };
  websiteUri?: string;
  formattedAddress?: string;
  googleMapsUri?: string;
  primaryTypeDisplayName?: { text?: string };
};

type GooglePlacesResponse = {
  places?: GooglePlace[];
};

export type GooglePlacesDiscoveryOptions = {
  apiKey?: string;
  cities?: string[];
  searchTerm?: string;
  maxResultsPerCity?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_CITIES = [
  "Oslo",
  "Bærum",
  "Asker",
  "Lillestrøm",
  "Nordre Follo",
  "Ullensaker",
  "Lørenskog",
  "Nittedal"
];

function normalizeWebsite(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Uses Google Places API (New) Text Search to discover business candidates.
 * Requires a Google Maps Platform API key with Places API enabled and billing configured.
 * Returns candidates only; it does not assess website quality or qualify leads.
 */
export async function discoverGooglePlacesCandidates(
  options: GooglePlacesDiscoveryOptions = {}
): Promise<GooglePlacesCandidate[]> {
  const apiKey = options.apiKey?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY_MISSING: set GOOGLE_MAPS_API_KEY to use Google Places discovery.");
  }

  const cities = options.cities ?? DEFAULT_CITIES;
  const searchTerm = options.searchTerm?.trim() || "regnskapsfører";
  const maxResultsPerCity = Math.min(Math.max(options.maxResultsPerCity ?? 20, 1), 20);
  const fetchImpl = options.fetchImpl ?? fetch;
  const candidates = new Map<string, GooglePlacesCandidate>();

  for (const city of cities) {
    const response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.formattedAddress,places.googleMapsUri,places.primaryTypeDisplayName"
      },
      body: JSON.stringify({
        textQuery: `${searchTerm} in ${city}, Norway`,
        languageCode: "no",
        regionCode: "NO",
        pageSize: maxResultsPerCity
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`GOOGLE_PLACES_REQUEST_FAILED status=${response.status} city=${city}`);
    }

    const payload = await response.json() as GooglePlacesResponse;
    for (const place of payload.places ?? []) {
      const companyName = place.displayName?.text?.trim();
      if (!companyName) continue;
      // Text Search can return similarly named businesses outside the requested country.
      // Never assign the query city to a result unless its formatted address confirms Norway.
      const formattedAddress = place.formattedAddress?.trim();
      if (!formattedAddress || !/(?:,\s*|\s)(?:Norway|Norge)$/i.test(formattedAddress)) continue;
      const websiteUrl = normalizeWebsite(place.websiteUri);
      const key = websiteUrl ? new URL(websiteUrl).hostname.toLowerCase().replace(/^www\./, "") : companyName.toLocaleLowerCase("nb-NO");
      const candidate: GooglePlacesCandidate = {
        companyName,
        websiteUrl,
        city,
        industry: place.primaryTypeDisplayName?.text || searchTerm,
        sourceUrl: place.googleMapsUri
      };
      const existing = candidates.get(key);
      if (!existing || (!existing.websiteUrl && candidate.websiteUrl)) candidates.set(key, candidate);
    }
  }

  return [...candidates.values()].sort((a, b) => a.companyName.localeCompare(b.companyName, "nb"));
}
