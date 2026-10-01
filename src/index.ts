import { env } from "./config.js";

console.log(JSON.stringify({
  service: "gullkornet",
  status: "bootstrap",
  goal: "generate evidence-backed qualified leads for Cidea",
  pilot: {
    country: env.TARGET_COUNTRY,
    industry: env.TARGET_INDUSTRY,
    geography: env.TARGET_CITY,
    offer: env.TARGET_OFFER
  },
  dailyLeadLimit: env.DAILY_LEAD_LIMIT,
  dryRun: env.DRY_RUN,
  sendingEnabled: false,
  nextStage: "research intake and duplicate detection"
}, null, 2));
