import { readFile } from "node:fs/promises";
import { prioritizeCidea } from "../domain/cidea-priority.js";

type Audit = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  industry?: string;
  sourceUrl?: string;
  checkedAt: string;
  status: "AUDITED" | "NO_WEBSITE" | "BLOCKED_URL" | "FETCH_ERROR";
  https?: boolean;
  title?: string;
  metaDescription?: string;
  hasViewportMeta?: boolean;
  hasContactPath?: boolean;
  hasEmailLink?: boolean;
  responseTimeMs?: number;
  flags?: string[];
};

const inputPath = process.argv[2] ?? "data/website-audits.json";

try {
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("Input must be a JSON array produced by audit:websites.");

  const prioritized = raw
    .filter((item): item is Audit => Boolean(item && typeof item === "object" && typeof (item as Audit).companyName === "string"))
    .map((audit) => ({
      ...audit,
      priority: prioritizeCidea(audit)
    }))
    .sort((a, b) => b.priority.score - a.priority.score);

  console.log(JSON.stringify(prioritized, null, 2));
  console.error(`Prioritised ${prioritized.length} website observations. Scores are review signals, not lead qualification.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cidea prioritisation failed.");
  process.exitCode = 1;
}
