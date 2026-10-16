/** Explicit record selection is limited to a five-row read-only pilot preview. */
export function parsePilotPreviewIds(raw: string): string[] {
  const ids = raw.split(",").map(value => value.trim());
  if (ids.length > 5 || ids.some(id => !/^rec[A-Za-z0-9]+$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Pilot preview requires 1-5 unique Airtable record IDs.");
  }
  return ids;
}
