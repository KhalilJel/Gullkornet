import { airtableConfigFromEnv } from "../lite/intake.js";
import { assessDeliveryHealth, type BounceInfo } from "../lite/delivery-health.js";
import { fetchBounceInfo, fetchResendEmailsSince } from "../lite/delivery-check.js";
import { buildDailyReport } from "../lite/daily-report.js";
import { osloClock } from "../integrations/send-schedule.js";
import { loadLiteSendConfig } from "../lite/schedule.js";

// npm run lite:daily-report -- [--date YYYY-MM-DD]   (Oslo date; default today)
// Read-only. Prints accepted/delivered/bounced Lite messages in the day's 11-12 Oslo slot against
// what the rolling limits allowed, and exits 1 on a missed start or a shortfall, which opens the
// existing pipeline alert. No addresses are printed.

async function main(): Promise<void> {
  const env = process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is required.");
  airtableConfigFromEnv(env); // same configuration as the sender; fails early when incomplete
  const cfg = loadLiteSendConfig(env);
  const dateIndex = process.argv.indexOf("--date");
  const now = Date.now();
  const date = dateIndex >= 0 && process.argv[dateIndex + 1] ? process.argv[dateIndex + 1]! : osloClock(now).date;
  const history = await fetchResendEmailsSince(apiKey, now - 31 * 24 * 3_600_000);
  const report = buildDailyReport(history, date, now, cfg);
  const bounces = new Map<string, BounceInfo>();
  for (const e of history) {
    if (e.last_event === "bounced" && e.id && now - Date.parse(e.created_at) < 24 * 3_600_000) {
      const info = await fetchBounceInfo(apiKey, e.id);
      if (info) bounces.set(e.id, info);
    }
  }
  const health = assessDeliveryHealth(history, bounces, now);
  console.log(`Lite daily report ${report.date}: slot ${new Date(report.slotStartMs).toISOString()}-${new Date(report.slotEndMs).toISOString()} ` +
    `status=${report.status} capacity=${report.capacity} carriedIn=${report.carriedIn} accepted=${report.accepted} missing=${report.missing} ` +
    `outsideSlot=${report.outsideSlot} events=${JSON.stringify(report.byEvent)}`);
  console.log(`Delivery health now: ${health.ok ? "ok" : "STOP: " + health.reason}`);
  if (report.status === "missed" || report.status === "shortfall") {
    console.error(`Lite slot ${report.date} ${report.status}: ${report.accepted} of ${report.capacity} accepted. Check the Lite Outreach run log for the stop reason.`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Lite daily report failed.");
  process.exitCode = 1;
});
