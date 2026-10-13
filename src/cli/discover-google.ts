import "dotenv/config";
import { readFile } from "node:fs/promises";
import { discoverGooglePlacesCandidates, selectFreshCandidates } from "../integrations/google-places.js";
import { normalizeDomain } from "../domain/dedupe.js";

const searchTerm = process.argv[2]?.trim() || "regnskapsfører";
const historyPath = process.env.DISCOVERY_HISTORY_PATH?.trim() || "data/discovery-history.json";
const dailyLimit = Math.max(1, Number.parseInt(process.env.DAILY_LEAD_LIMIT?.trim() || "100", 10) || 100);
const updateHistory = process.env.UPDATE_DISCOVERY_HISTORY === "true";

type DiscoveryHistory = {
  domains: string[];
  companyNames: string[];
};

async function readHistory(): Promise<DiscoveryHistory> {
  try {
    const raw = await readFile(historyPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { domains: [], companyNames: [] };
    const record = parsed as Record<string, unknown>;
    return {
      domains: Array.isArray(record.domains) ? record.domains.filter((v): v is string => typeof v === "string") : [],
      companyNames: Array.isArray(record.companyNames) ? record.companyNames.filter((v): v is string => typeof v === "string") : []
    };
  } catch {
    return { domains: [], companyNames: [] };
  }
}

try {
  // Opt-in: 2-3 pages per city (up to 3x billed requests). Unset or invalid keeps one page.
  const maxPagesPerCity = Number.parseInt(process.env.GULLKORNET_PLACES_MAX_PAGES?.trim() || "1", 10) || 1;
  const stats = { placesRequests: 0 };
  const candidates = await discoverGooglePlacesCandidates({ searchTerm, maxPagesPerCity, stats });
  const history = await readHistory();
  const knownDomains = new Set(history.domains.map((value) => value.toLowerCase()));
  const knownNames = new Set(history.companyNames.map((value) => value.trim().toLocaleLowerCase("nb-NO")));

  const fresh = selectFreshCandidates(candidates, history, dailyLimit);

  console.log(JSON.stringify(fresh, null, 2));
  if (updateHistory) {
    const domains = new Set(knownDomains);
    const names = new Set(knownNames);
    for (const candidate of fresh) {
      const domain = normalizeDomain(candidate.websiteUrl);
      const name = candidate.companyName.trim().toLocaleLowerCase("nb-NO");
      if (domain) domains.add(domain);
      names.add(name);
    }
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(historyPath), { recursive: true });
    await writeFile(historyPath, JSON.stringify({
      domains: [...domains],
      companyNames: [...names]
    }, null, 2) + "\n", "utf8");
  }
  // Counts only (no names, domains or search text), for the run log.
  const statsPath = process.env.DISCOVERY_STATS_PATH?.trim();
  if (statsPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(statsPath, JSON.stringify({
      placesRequests: stats.placesRequests,
      maxPagesPerCity: Math.min(Math.max(maxPagesPerCity, 1), 3),
      rawCandidates: candidates.length,
      rawWithWebsite: candidates.filter((c) => c.websiteUrl).length,
      selected: fresh.length
    }) + "\n", { encoding: "utf8", mode: 0o600 });
  }
  console.error(
    `Discovered ${candidates.length} candidates; ${fresh.length} new candidates after cross-run dedupe, capped at ${dailyLimit}. ` +
    "Candidates are not qualified leads; verify registration and research each website before qualification."
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Google Places discovery failed");
  process.exitCode = 1;
}
