import "dotenv/config";
import { z } from "zod";

const envBoolean = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`INVALID_BOOLEAN_${value}`);
};

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DRY_RUN: z.string().optional(),
  TARGET_COUNTRY: z.string().default("Norway"),
  TARGET_INDUSTRY: z.string().default(""),
  TARGET_CITY: z.string().default(""),
  DAILY_LEAD_LIMIT: z.coerce.number().int().positive().default(25)
});

const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  DRY_RUN: envBoolean(parsed.DRY_RUN, true)
};
