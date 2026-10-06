import type { JEVBrowserClient, BrowserAction } from "../integrations/jev-browser.js";
import { validateBrowserActions } from "./typesafe-browser.js";
import { summarizeBrowserAudit } from "./browser-audit.js";

export async function runBrowserJourney(
  client: JEVBrowserClient,
  actions: unknown[]
) {
  const validatedActions: BrowserAction[] = validateBrowserActions(actions);
  const observations = await client.execute(validatedActions);
  return {
    observations,
    summary: summarizeBrowserAudit(observations)
  };
}
