import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Lead } from "../domain/lead.js";

export interface LeadStore {
  list(): Promise<Lead[]>;
  saveAll(leads: Lead[]): Promise<void>;
}

export class JsonLeadStore implements LeadStore {
  private readonly filePath: string;

  constructor(filePath = "data/leads.json") {
    this.filePath = resolve(filePath);
  }

  async list(): Promise<Lead[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("LEAD_STORE_INVALID_FORMAT: expected a JSON array");
      }
      return parsed as Lead[];
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async saveAll(leads: Lead[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(leads, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w"
    });
    await rename(temporaryPath, this.filePath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
