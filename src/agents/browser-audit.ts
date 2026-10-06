import { validateBrowserObservations } from "./typesafe-browser.js";
import type { BrowserObservation } from "../integrations/jev-browser.js";

export function summarizeBrowserAudit(observations: BrowserObservation[]) {
  const validated = validateBrowserObservations(observations);
  const failures = validated.filter((item) => item.result !== "success");

  return {
    observationCount: validated.length,
    failureCount: failures.length,
    findings: failures.map((item) => ({
      url: item.url,
      observation: item.observation,
      evidence: item.url,
      confidence: item.result === "blocked" ? 0.6 : 0.9
    }))
  };
}
