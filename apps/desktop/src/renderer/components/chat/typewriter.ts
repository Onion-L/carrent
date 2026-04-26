export const TYPEWRITER_INTERVAL_MS = 24;
export const TYPEWRITER_CHARS_PER_TICK = 3;

export function getNextTypewriterText(
  visibleText: string,
  receivedText: string,
): string {
  if (!receivedText.startsWith(visibleText)) {
    return receivedText;
  }

  if (visibleText.length >= receivedText.length) {
    return visibleText;
  }

  return receivedText.slice(
    0,
    Math.min(receivedText.length, visibleText.length + TYPEWRITER_CHARS_PER_TICK),
  );
}

export function hasPendingTypewriterText(
  visibleText: string,
  receivedText: string,
): boolean {
  return visibleText.length < receivedText.length;
}
