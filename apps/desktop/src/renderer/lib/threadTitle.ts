const SENTENCE_END_PUNCTUATION = /[,.;:!?，。；：！？\n\r\t]/u;
const DEFAULT_MAX_TITLE_LENGTH = 40;

export function deriveThreadTitle(
  content: string,
  options: { fallback?: string; maxLength?: number } = {},
): string {
  const { fallback = "New thread", maxLength = DEFAULT_MAX_TITLE_LENGTH } = options;
  const trimmed = content.trim();

  if (!trimmed) {
    return fallback;
  }

  const endIndex = trimmed.search(SENTENCE_END_PUNCTUATION);
  const sentence = endIndex === -1 ? trimmed : trimmed.slice(0, endIndex);
  const cleaned = sentence.trim();

  if (!cleaned) {
    return fallback;
  }

  if (cleaned.length > maxLength) {
    const truncated = cleaned.slice(0, maxLength).trimEnd();
    return `${truncated}...`;
  }

  return cleaned;
}
