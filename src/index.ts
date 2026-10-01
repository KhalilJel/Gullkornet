import { env } from "./config.js";

console.log(JSON.stringify({
  service: "gullkornet",
  status: "bootstrap",
  goal: "generate qualified leads for Cidea",
  country: env.TARGET_COUNTRY,
  industry: env.TARGET_INDUSTRY || null,
  city: env.TARGET_CITY || null,
  dailyLeadLimit: env.DAILY_LEAD_LIMIT,
  dryRun: env.DRY_RUN
}));
