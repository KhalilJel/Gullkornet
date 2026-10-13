/**
 * Production Airtable must never be written from a pull_request CI run.
 * GITHUB_EVENT_NAME is set by GitHub Actions itself, so the block holds even if a
 * workflow forgets to set GULLKORNET_AIRTABLE_WRITES=disabled. Reads stay allowed.
 */
export function airtableWritesBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  const event = env.GITHUB_EVENT_NAME?.trim();
  if (event === "pull_request" || event === "pull_request_target") return true;
  return env.GULLKORNET_AIRTABLE_WRITES?.trim().toLowerCase() === "disabled";
}

export function assertAirtableWritesAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (airtableWritesBlocked(env)) throw new Error("AIRTABLE_WRITES_DISABLED_IN_THIS_ENVIRONMENT");
}
