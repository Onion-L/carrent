import { SEARCH_ENGINE_URLS, type BrowserSearchEngine } from "../../src/shared/browser";

const LOOPBACK_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/iu;
const HOST_PATTERN = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,}(?::\d+)?(?:\/|$)/iu;

export function resolveBrowserInput(value: string, searchEngine: BrowserSearchEngine) {
  const input = value.trim();
  if (!input) return "about:blank";

  if (LOOPBACK_PATTERN.test(input)) return `http://${input}`;
  if (HOST_PATTERN.test(input)) return `https://${input}`;

  try {
    const url = new URL(input);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // Non-URL input is a search query.
  }

  return `${SEARCH_ENGINE_URLS[searchEngine]}${encodeURIComponent(input)}`;
}

export function isBrowserUrl(value: string) {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isHttpOrHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
