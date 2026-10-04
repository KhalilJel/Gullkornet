import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Audit = {
  companyName: string;
  websiteUrl?: string;
  city?: string;
  industry?: string;
  sourceUrl?: string;
  checkedAt: string;
  status: "AUDITED" | "NO_WEBSITE" | "BLOCKED_URL" | "FETCH_ERROR";
  httpStatus?: number;
  finalUrl?: string;
  https?: boolean;
  title?: string;
  metaDescription?: string;
  hasViewportMeta?: boolean;
  hasContactPath?: boolean;
  hasEmailLink?: boolean;
  responseTimeMs?: number;
  flags: string[];
  note?: string;
};

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const inputPath = process.argv[2] ?? "data/website-audits.json";
const outputPath = process.argv[3] ?? "data/market-insight-pilot.csv";

try {
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Input must be a JSON array produced by audit:websites.");
  const audits = parsed as Audit[];
  const headers: Array<keyof Audit> = [
    "companyName", "city", "industry", "websiteUrl", "sourceUrl", "checkedAt",
    "status", "httpStatus", "finalUrl", "https", "title", "metaDescription",
    "hasViewportMeta", "hasContactPath", "hasEmailLink", "responseTimeMs", "flags", "note"
  ];
  const rows = [
    headers.map(csvCell).join(","),
    ...audits.map((audit) => headers.map((key) => csvCell(audit[key])).join(","))
  ];
  const target = resolve(outputPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rows.join("\n") + "\n", "utf8");
  console.error(`Exported ${audits.length} observations to ${target}. These are automated signals, not verified recommendations or lead qualification.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Market insight export failed.");
  process.exitCode = 1;
}
