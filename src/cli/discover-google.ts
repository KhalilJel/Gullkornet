import "dotenv/config";
import { readFile } from "node:fs/promises";
import { discoverGooglePlacesCandidates } from "../integrations/google-places.js";
import { normalizeDomain } from "../domain/dedupe.js";

const searchTerm = process.argv[2]?.trim() || "regnskapsfører";
const historyPath = process.env.DISCOVERY_HISTORY_PATH?.trim() || "data/discovery-history.json";
const dailyLimit = Math.max(1, Number.parseInt(process.env.DAILY_LEAD_LIMIT?.trim() || "25", 10) || 25);
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
  const candidates = await discoverGooglePlacesCandidates({ searchTerm });
  const history = await readHistory();
  const knownDomains = new Set(history.domains.map((value) => value.toLowerCase()));
  const knownNames = new Set(history.companyNames.map((value) => value.trim().toLocaleLowerCase("nb-NO")));

  const fresh = candidates.filter((candidate) => {
    const domain = normalizeDomain(candidate.websiteUrl);
    const name = candidate.companyName.trim().toLocaleLowerCase("nb-NO");
    return !(domain && knownDomains.has(domain)) && !knownNames.has(name);
  }).slice(0, dailyLimit);

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
  console.error(
    `Discovered ${candidates.length} candidates; ${fresh.length} new candidates after cross-run dedupe, capped at ${dailyLimit}. ` +
    "Candidates are not qualified leads; verify registration and research each website before qualification."
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Google Places discovery failed");
  process.exitCode = 1;
}
