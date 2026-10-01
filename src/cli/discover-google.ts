import "dotenv/config";
import { discoverGooglePlacesCandidates } from "../integrations/google-places.js";

const searchTerm = process.argv[2]?.trim() || "regnskapsfører";

try {
  const candidates = await discoverGooglePlacesCandidates({ searchTerm });
  console.log(JSON.stringify(candidates, null, 2));
  console.error(`Discovered ${candidates.length} Google Places candidates for query "${searchTerm}". Candidates are not qualified leads; verify registration and research each website before qualification.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Google Places discovery failed");
  process.exitCode = 1;
}
