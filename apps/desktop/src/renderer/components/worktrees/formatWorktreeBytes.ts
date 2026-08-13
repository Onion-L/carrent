/** Formats a byte count into a short human-readable string (e.g. "1.5 GB"). */
export function formatWorktreeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const valueText = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  const trimmed = valueText.endsWith(".0") ? valueText.slice(0, -2) : valueText;
  return `${trimmed} ${units[unitIndex]}`;
}
