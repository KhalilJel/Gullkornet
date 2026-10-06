import { runCompleteAudit } from "../agents/complete-audit.js";
import { cideaTargetSchema } from "../domain/website-audit.js";

const url = process.argv[2];
const targetInput = process.env.CIDEA_TARGET ?? "CideaLead";
if (!url) throw new Error("Usage: CIDEA_TARGET=CideaLead npm run audit:complete -- https://example.com");

const target = cideaTargetSchema.parse(targetInput);
const report = await runCompleteAudit({ target, websiteUrl: url });

console.log(JSON.stringify(report, null, 2));
