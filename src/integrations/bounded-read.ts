/**
 * Reads at most maxBytes of a response body and gives up after deadlineMs in total, so a
 * server that sends headers and then stalls cannot hang a research run. Throws
 * BODY_READ_TIMEOUT instead of returning partial content that could be mistaken for a page.
 */
export async function readBodyBounded(
  response: Response,
  maxBytes: number,
  deadlineMs: number,
  fatalDecoding = false
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("BODY_READ_TIMEOUT")), deadlineMs);
  });
  try {
    while (total < maxBytes) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done || !value) break;
      const remaining = maxBytes - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    if (timer) clearTimeout(timer);
    deadline.catch(() => undefined);
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: fatalDecoding }).decode(bytes);
}
