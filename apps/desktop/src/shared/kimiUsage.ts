export type KimiUsageTokenTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
};

export type KimiUsageDay = {
  /** Local-timezone day bucket, YYYY-MM-DD. */
  date: string;
  byModel: Record<string, KimiUsageTokenTotals>;
};

export type KimiUsageProject = {
  /** Full working directory the sessions ran in. */
  workDir: string;
  /** Basename of workDir, for display. */
  name: string;
  totals: KimiUsageTokenTotals;
};

export type KimiUsageStats = {
  /** Days with at least one recorded turn, ascending by date. */
  days: KimiUsageDay[];
  /** Per-model cumulative totals (model ids normalized, no `kimi-code/` prefix). */
  models: Record<string, KimiUsageTokenTotals>;
  /** Per-project cumulative totals, sorted by total tokens descending. */
  projects: KimiUsageProject[];
  /** Distinct sessions that contributed at least one turn record. */
  sessionCount: number;
  /** Epoch ms of the oldest/newest turn record; null when no data. */
  firstActivityAt: number | null;
  lastActivityAt: number | null;
  /** ISO timestamp of when the scan ran. */
  scannedAt: string;
};
