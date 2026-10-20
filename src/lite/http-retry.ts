// Bounded retry for read-only HTTP calls (Brreg unit, Airtable lookups). One timeout, network
// error, 429 or 5xx is retried after a short pause; if it persists, the caller's fail-closed
// handling applies as before. Never used for writes or for sending.

export const READ_RETRY_PAUSES_MS: readonly number[] = Object.freeze([2_000, 5_000]);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function transient(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError" || error instanceof TypeError;
}

export async function fetchReadWithRetry(
  fetchImpl: typeof fetch,
  url: string | URL,
  init: Omit<RequestInit, "signal">,
  timeoutMs = 15_000,
  pausesMs: readonly number[] = READ_RETRY_PAUSES_MS,
  wait: (ms: number) => Promise<void> = sleep
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= pausesMs.length;
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (last || !(response.status === 429 || response.status >= 500)) return response;
    } catch (error) {
      if (last || !transient(error)) throw error;
    }
    await wait(pausesMs[attempt]!);
  }
}
