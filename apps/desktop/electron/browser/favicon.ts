import type { Session } from "electron";

// A usable favicon payload: image/* content type plus its bytes. Null means
// the favicon is not usable (request failed, non-image content type, empty
// body, or over the size cap).
export type FaviconPayload = { contentType: string; bytes: Uint8Array };

export type FaviconFetcher = (url: string, session: Session) => Promise<FaviconPayload | null>;

const MAX_FAVICON_BYTES = 256 * 1024;
const FAVICON_CACHE_LIMIT = 64;

async function fetchFaviconViaSession(
  url: string,
  session: Session,
): Promise<FaviconPayload | null> {
  const response = await session.fetch(url);
  if (!response.ok || !response.body) return null;

  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!contentType.startsWith("image/")) {
    await response.body.cancel().catch(() => {});
    return null;
  }

  // Stream the body with a hard cap: a favicon URL that serves an
  // unbounded stream must not balloon main-process memory.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FAVICON_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  if (total === 0) return null;

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { contentType, bytes };
}

// Resolves a remote favicon URL to a CSP-safe data: URL, or null when the
// favicon cannot be used. The renderer's CSP allows only local image
// sources ('self', data:, blob:), so remote favicons are converted in the
// main process instead of widening img-src to the network — a compromised
// renderer bundle must not gain an http(s) image-exfiltration channel.
// Results (including failures) are cached, bounded to FAVICON_CACHE_LIMIT.
export function createFaviconResolver(fetchFavicon: FaviconFetcher = fetchFaviconViaSession) {
  const cache = new Map<string, string | null>();

  return async function resolveFavicon(url: string, session: Session): Promise<string | null> {
    const cached = cache.get(url);
    if (cached !== undefined) return cached;

    let dataUrl: string | null = null;
    try {
      const payload = await fetchFavicon(url, session);
      if (payload) {
        const contentType = payload.contentType.split(";")[0]?.trim() ?? "";
        if (contentType.startsWith("image/")) {
          const base64 = Buffer.from(payload.bytes).toString("base64");
          dataUrl = `data:${contentType};base64,${base64}`;
        }
      }
    } catch {
      dataUrl = null;
    }

    cache.set(url, dataUrl);
    if (cache.size > FAVICON_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return dataUrl;
  };
}
