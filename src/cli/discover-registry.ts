import { discoverBrregCandidates } from "../integrations/brreg.js";

const searchTerm = process.argv[2]?.trim() || "regnskap";

try {
  const candidates = await discoverBrregCandidates({ searchTerm });
  console.log(JSON.stringify(candidates, null, 2));
  console.error(`Discovered ${candidates.length} active registry candidates for query "${searchTerm}". Website research and qualification are still required.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Registry discovery failed");
  process.exitCode = 1;
}
