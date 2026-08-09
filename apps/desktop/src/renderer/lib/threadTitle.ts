export function deriveThreadTitle(content: string, options: { fallback?: string } = {}): string {
  const { fallback = "New thread" } = options;
  const trimmed = content.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed;
}
