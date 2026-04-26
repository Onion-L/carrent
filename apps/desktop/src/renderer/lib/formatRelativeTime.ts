/**
 * Accepts ISO timestamp strings (like "2026-04-26T10:30:00.000Z")
 * and returns a relative time label: "xs ago", "xm ago", "xh ago", "xd ago".
 * Falls back to the original string when the value does not parse as an ISO date.
 */
export function formatRelativeTime(updatedAt: string): string {
  const ms = Date.parse(updatedAt);
  if (Number.isNaN(ms)) {
    return updatedAt;
  }

  const diff = Date.now() - ms;
  if (diff < 0) {
    return "now";
  }

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
