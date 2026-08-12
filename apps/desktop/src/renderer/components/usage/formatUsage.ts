export function formatTokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

const exactFormatter = new Intl.NumberFormat("en-US");

/** Full-precision token count, e.g. for hover titles next to compact values. */
export function formatExact(value: number): string {
  return exactFormatter.format(Math.round(value));
}

const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatDayShort(isoDay: string): string {
  return dayFormatter.format(new Date(`${isoDay}T00:00:00`));
}
