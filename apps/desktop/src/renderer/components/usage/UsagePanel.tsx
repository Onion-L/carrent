import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { KimiUsageDay, KimiUsageStats, KimiUsageTokenTotals } from "../../../shared/kimiUsage";
import { useSettings } from "../../context/SettingsContext";
import { curvePath, niceScale, smoothCurve } from "./chartMath";
import { formatDayShort, formatExact, formatTokens } from "./formatUsage";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 260;
const TICK_COUNT = 4;
const PLOT_TOP = 8;

const RANGE_OPTIONS = [7, 30, 90] as const;
const DEFAULT_RANGE = 30;

/** Activity heatmap: one year of week columns ending at the current week. */
const HEATMAP_WEEKS = 53;
/** Empty cell + four intensity steps over the blue accent token (theme-aware:
 * sky blue on night, navy on paper). */
const HEATMAP_LEVELS = [
  "bg-surface-hover",
  "bg-skill-reference/25",
  "bg-skill-reference/45",
  "bg-skill-reference/70",
  "bg-skill-reference",
] as const;
const HEATMAP_DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""] as const;

/** Per-model series hues (data encoding, not decoration), calibrated against
 * both themes. The first series uses the neutral action token per DESIGN.md. */
const MODEL_COLORS = {
  night: ["#b4b4b4", "#c98a5e", "#7d9bbf", "#9a8ec4", "#6fae91", "#b3a06a", "#8a8a82"],
  paper: ["#505050", "#b06a3d", "#3f6d9e", "#6f5fb0", "#3d7a5c", "#8a7a3d", "#6e6e66"],
} as const;

/** Mirrors SettingsContext.resolveTheme so the palette is correct during the
 * same render pass that a theme change triggers (dataset.theme lags by an effect). */
function paletteForTheme(theme: "system" | "dark" | "light"): readonly string[] {
  const isLight =
    theme === "light" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches);
  return isLight ? MODEL_COLORS.paper : MODEL_COLORS.night;
}

const PRELOAD_RESTART_MESSAGE =
  "Kimi usage support is not loaded in the current window. Restart Carrent and try again.";

interface RangeDay {
  date: string;
  byModel: Record<string, KimiUsageTokenTotals>;
}

interface ModelSeries {
  model: string;
  color: string;
  totals: KimiUsageTokenTotals;
}

function toLocalDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function emptyTotals(): KimiUsageTokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
}

function addTotals(target: KimiUsageTokenTotals, source: KimiUsageTokenTotals) {
  target.input += source.input;
  target.output += source.output;
  target.cacheRead += source.cacheRead;
  target.cacheCreation += source.cacheCreation;
  target.total += source.total;
}

/** Continuous local-day list for the range, filling days without records. */
export function buildRangeDays(stats: KimiUsageStats, rangeDays: number): RangeDay[] {
  const byDate = new Map(stats.days.map((day) => [day.date, day]));
  const today = new Date();
  const days: RangeDay[] = [];
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const isoDay = toLocalDay(date);
    days.push({ date: isoDay, byModel: byDate.get(isoDay)?.byModel ?? {} });
  }
  return days;
}

export interface HeatmapCell {
  date: string;
  total: number;
}

export interface HeatmapData {
  /** Column-major cells (weeks × 7 rows, Sunday first); null = day after today. */
  cells: (HeatmapCell | null)[];
  /** Month label for the week column where the month changes. */
  monthLabels: { week: number; label: string }[];
  maxTotal: number;
}

const heatmapMonthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" });

function dayTotal(day: KimiUsageDay): number {
  return Object.values(day.byModel).reduce((sum, totals) => sum + totals.total, 0);
}

/** One year of daily totals in week columns, aligned to local Sundays. */
export function buildHeatmap(stats: KimiUsageStats, today = new Date()): HeatmapData {
  const byDate = new Map(stats.days.map((day) => [day.date, dayTotal(day)]));
  const firstSunday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay() - (HEATMAP_WEEKS - 1) * 7,
  );
  const cells: (HeatmapCell | null)[] = [];
  const monthLabels: { week: number; label: string }[] = [];
  let maxTotal = 0;
  let previousMonth = -1;
  for (let week = 0; week < HEATMAP_WEEKS; week += 1) {
    let weekFirstDate: Date | null = null;
    for (let row = 0; row < 7; row += 1) {
      const date = new Date(
        firstSunday.getFullYear(),
        firstSunday.getMonth(),
        firstSunday.getDate() + week * 7 + row,
      );
      if (date.getTime() > today.getTime()) {
        cells.push(null);
        continue;
      }
      weekFirstDate ??= date;
      const isoDay = toLocalDay(date);
      const total = byDate.get(isoDay) ?? 0;
      if (total > maxTotal) maxTotal = total;
      cells.push({ date: isoDay, total });
    }
    if (weekFirstDate !== null && weekFirstDate.getMonth() !== previousMonth) {
      monthLabels.push({ week, label: heatmapMonthFormatter.format(weekFirstDate) });
      previousMonth = weekFirstDate.getMonth();
    }
  }
  return { cells, monthLabels, maxTotal };
}

/** Intensity bucket 0-4: empty, then quartiles of the busiest day. */
export function heatmapLevel(total: number, maxTotal: number): number {
  if (total <= 0 || maxTotal <= 0) return 0;
  const ratio = total / maxTotal;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function collectModels(days: readonly RangeDay[], palette: readonly string[]): ModelSeries[] {
  const totalsByModel = new Map<string, KimiUsageTokenTotals>();
  for (const day of days) {
    for (const [model, totals] of Object.entries(day.byModel)) {
      let modelTotals = totalsByModel.get(model);
      if (!modelTotals) {
        modelTotals = emptyTotals();
        totalsByModel.set(model, modelTotals);
      }
      addTotals(modelTotals, totals);
    }
  }
  return [...totalsByModel.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([model, totals], index) => ({
      model,
      color: palette[index % palette.length] ?? palette[0]!,
      totals,
    }));
}

export type KimiUsageSettingsApi = { kimiUsage?: () => Promise<KimiUsageStats> };

export async function readKimiUsageStats(settingsApi: KimiUsageSettingsApi): Promise<{
  stats: KimiUsageStats | null;
  error: string | null;
}> {
  if (typeof settingsApi.kimiUsage !== "function") {
    return { stats: null, error: PRELOAD_RESTART_MESSAGE };
  }
  try {
    return { stats: await settingsApi.kimiUsage(), error: null };
  } catch (error) {
    return {
      stats: null,
      error: error instanceof Error ? error.message : "Failed to load Kimi Code usage.",
    };
  }
}

export function UsagePanel() {
  const [stats, setStats] = useState<KimiUsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<number>(DEFAULT_RANGE);
  const [breakdownTab, setBreakdownTab] = useState<"model" | "project">("model");
  const [hiddenModels, setHiddenModels] = useState<ReadonlySet<string>>(new Set());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const toggleModel = useCallback((model: string) => {
    setHiddenModels((previous) => {
      const next = new Set(previous);
      if (next.has(model)) {
        next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await readKimiUsageStats(window.carrent.settings);
    setStats(result.stats);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rangeDays = useMemo(() => (stats ? buildRangeDays(stats, range) : []), [stats, range]);
  const heatmap = useMemo(() => (stats ? buildHeatmap(stats) : null), [stats]);
  const { theme } = useSettings();
  const palette = useMemo(() => paletteForTheme(theme), [theme]);
  // Dark neutral fills read as a dirty smudge on the paper theme; keep them faint.
  const isLightTheme = palette === MODEL_COLORS.paper;
  const seriesFillOpacity = isLightTheme ? 0.07 : 0.12;
  const models = useMemo(() => collectModels(rangeDays, palette), [rangeDays, palette]);
  // Chart legend semantics: clicking a model row hides its series; hiding every
  // model falls back to showing all, so the plot is never silently empty.
  const visibleModels = useMemo(() => {
    const visible = models.filter((series) => !hiddenModels.has(series.model));
    return visible.length === 0 ? models : visible;
  }, [models, hiddenModels]);

  const { paths, ticks, stepX, toY } = useMemo(() => {
    const peak = rangeDays.reduce(
      (max, day) =>
        visibleModels.reduce(
          (inner, series) => Math.max(inner, day.byModel[series.model]?.total ?? 0),
          max,
        ),
      0,
    );
    const { max, ticks: tickValues } = niceScale(peak, TICK_COUNT);
    const step = rangeDays.length <= 1 ? 0 : VIEW_WIDTH / (rangeDays.length - 1);
    const toYFn = (value: number) =>
      max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (value / max) * (VIEW_HEIGHT - PLOT_TOP);

    const built = visibleModels.map((series) => {
      const curve = smoothCurve(
        rangeDays.map((day, dayIndex) => ({
          x: dayIndex * step,
          y: toYFn(day.byModel[series.model]?.total ?? 0),
        })),
      );
      const line = curvePath(curve, "M");
      return {
        series,
        line,
        area: line === "" ? "" : `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`,
      };
    });
    return { paths: built, ticks: tickValues, stepX: step, toY: toYFn };
  }, [visibleModels, rangeDays]);

  const handleMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const bounds = plotRef.current?.getBoundingClientRect();
      if (bounds === undefined || bounds.width === 0 || rangeDays.length === 0) return;
      const fraction = (event.clientX - bounds.left) / bounds.width;
      const index = Math.round(fraction * (rangeDays.length - 1));
      setHoverIndex(Math.min(rangeDays.length - 1, Math.max(0, index)));
    },
    [rangeDays.length],
  );

  if (loading && stats === null && error === null) return <UsageSkeleton />;

  if (error !== null && stats === null) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6">
        <div className="text-app-13 text-fg">Could not load Kimi Code usage</div>
        <div className="mt-1 text-app-12 text-subtle">{error}</div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (stats === null || stats.sessionCount === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6">
        <div className="text-app-13 text-fg">No Kimi Code usage yet</div>
        <div className="mt-1 text-app-12 text-subtle">
          Token usage is collected from Kimi Code CLI sessions on this machine. Install Kimi Code
          and run a few sessions, then come back here.
        </div>
      </div>
    );
  }

  const totalTokens = models.reduce((sum, series) => sum + series.totals.total, 0);
  const totalInput = models.reduce((sum, series) => sum + series.totals.input, 0);
  const totalOutput = models.reduce((sum, series) => sum + series.totals.output, 0);
  const totalCacheRead = models.reduce((sum, series) => sum + series.totals.cacheRead, 0);
  const totalCacheCreation = models.reduce(
    (sum, series) => sum + series.totals.cacheCreation,
    0,
  );
  // Hit rate = cache read / (cache read + uncached input). Cache *write* is
  // excluded: it is a store, not a miss.
  const cacheHitRate =
    totalCacheRead + totalInput === 0 ? null : totalCacheRead / (totalCacheRead + totalInput);

  function renderMetricCell(label: string, value: string, title?: string) {
    return (
      <div key={label} className="bg-surface px-4 py-3" title={title}>
        <div className="text-app-11 text-subtle">{label}</div>
        <div className="mt-1 text-app-16 font-medium tabular-nums text-fg">{value}</div>
      </div>
    );
  }
  const activeDays = rangeDays.filter((day) =>
    Object.values(day.byModel).some((totals) => totals.total > 0),
  ).length;

  const hoveredDay = hoverIndex === null ? undefined : rangeDays[hoverIndex];
  const hoverLeft = rangeDays.length <= 1 ? 0 : ((hoverIndex ?? 0) / (rangeDays.length - 1)) * 100;

  return (
    <div className="flex flex-col gap-6">
      {/* Range switch + refresh */}
      <div className="flex items-center justify-between">
        <p className="text-app-12 text-subtle">
          {stats.sessionCount} sessions · last {range} days
        </p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-surface p-0.5">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                className={`rounded px-2.5 py-1 text-app-12 ${
                  range === option ? "bg-surface-hover text-fg" : "text-subtle hover:text-muted"
                }`}
              >
                {option}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
            title="Refresh usage stats"
            aria-label="Refresh usage stats"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary column + layered area chart */}
      <div className="flex gap-8">
        <div className="w-56 shrink-0">
          <div className="text-app-11 text-subtle">Total tokens</div>
          <div className="mt-0.5 text-app-22 font-medium tabular-nums text-fg">
            {formatTokens(totalTokens)}
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {models.map((series) => {
              const share = totalTokens === 0 ? 0 : series.totals.total / totalTokens;
              const hidden = hiddenModels.has(series.model) && visibleModels !== models;
              return (
                <button
                  key={series.model}
                  type="button"
                  onClick={() => toggleModel(series.model)}
                  title={hidden ? "Show in chart" : "Hide from chart"}
                  className={`-mx-1 rounded px-1 py-0.5 text-left transition-opacity duration-150 ease-out hover:bg-surface-hover ${
                    hidden ? "opacity-40" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-app-12">
                    <span className="flex min-w-0 items-center gap-1.5 text-muted">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: series.color }}
                      />
                      <span className="truncate">{series.model}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-fg">
                      {formatTokens(series.totals.total)}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-surface-hover">
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${share * 100}%`, backgroundColor: series.color }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex gap-2">
            {/* Axis labels sit outside the plot so they stay aligned to gridlines. */}
            <div className="relative h-56 w-14 shrink-0">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-0 -translate-y-1/2 text-app-10 tabular-nums text-subtle"
                  style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
                >
                  {tick === 0 ? "0" : formatTokens(tick)}
                </span>
              ))}
            </div>

            <div
              ref={plotRef}
              className="relative h-56 flex-1"
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverIndex(null)}
            >
              <svg
                className="h-full w-full"
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-label="Daily token usage by model"
              >
                {ticks.map((tick) => {
                  const y = toY(tick);
                  return (
                    <line
                      key={tick}
                      x1={0}
                      x2={VIEW_WIDTH}
                      y1={y}
                      y2={y}
                      stroke="currentColor"
                      strokeWidth={1}
                      className="text-border"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}

                {/* Fills first, then every stroke, so no series covers another's line. */}
                {paths.map(({ series, area }) => (
                  <path
                    key={series.model}
                    d={area}
                    fill={series.color}
                    fillOpacity={seriesFillOpacity}
                  />
                ))}
                {paths.map(({ series, line }) => (
                  <path
                    key={series.model}
                    d={line}
                    fill="none"
                    stroke={series.color}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {hoverIndex === null ? null : (
                  <line
                    x1={hoverIndex * stepX}
                    x2={hoverIndex * stepX}
                    y1={PLOT_TOP}
                    y2={VIEW_HEIGHT}
                    stroke="currentColor"
                    strokeWidth={1}
                    className="text-subtle"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>

              {hoveredDay === undefined ? null : (
                <div
                  className="pointer-events-none absolute top-0 z-10 max-w-60 min-w-40 rounded-lg border border-border-strong bg-surface-raised px-2.5 py-2 text-app-12 shadow-xl"
                  style={{
                    left: `${hoverLeft}%`,
                    transform: hoverLeft > 60 ? "translateX(-100%)" : "translateX(0)",
                  }}
                >
                  <div className="mb-1 text-subtle">{formatDayShort(hoveredDay.date)}</div>
                  {visibleModels.map((series) => (
                    <div key={series.model} className="flex items-center justify-between gap-4">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: series.color }}
                        />
                        <span className="truncate">{series.model}</span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums text-fg">
                        {formatTokens(hoveredDay.byModel[series.model]?.total ?? 0)}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
                    <span className="text-muted">Total</span>
                    <span className="tabular-nums text-fg">
                      {formatTokens(
                        visibleModels.reduce(
                          (sum, series) => sum + (hoveredDay.byModel[series.model]?.total ?? 0),
                          0,
                        ),
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between pl-16 text-app-10 uppercase text-subtle">
            <span>{formatDayShort(rangeDays[0]?.date ?? "")}</span>
            <span>{formatDayShort(rangeDays[Math.floor(rangeDays.length / 2)]?.date ?? "")}</span>
            <span>{formatDayShort(rangeDays[rangeDays.length - 1]?.date ?? "")}</span>
          </div>
        </div>
      </div>

      {/* Metric strip: gap-px bg-border divider trick. Total tokens lives in the
          summary column above, so it is not repeated here. */}
      <div className="grid grid-cols-6 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {renderMetricCell("Input", formatTokens(totalInput), formatExact(totalInput))}
        {renderMetricCell("Output", formatTokens(totalOutput), formatExact(totalOutput))}
        {renderMetricCell("Cache read", formatTokens(totalCacheRead), formatExact(totalCacheRead))}
        {renderMetricCell(
          "Cache write",
          formatTokens(totalCacheCreation),
          formatExact(totalCacheCreation),
        )}
        {renderMetricCell(
          "Cache hit",
          cacheHitRate === null ? "—" : `${(cacheHitRate * 100).toFixed(1)}%`,
        )}
        {renderMetricCell("Active days", String(activeDays))}
      </div>

      {/* Activity heatmap: one year of daily totals, GitHub-style week columns */}
      {heatmap === null ? null : (
        <div>
          <h3 className="mb-3 text-app-13 font-medium text-fg">Activity</h3>
          <div className="flex items-stretch gap-2">
            <div className="mt-4 grid grid-rows-7 gap-[3px]">
              {HEATMAP_DAY_LABELS.map((label, row) => (
                <div key={row} className="flex items-center">
                  <span className="text-app-10 leading-none text-subtle">{label}</span>
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-4">
                {heatmap.monthLabels.map(({ week, label }) => (
                  <span
                    key={week}
                    className="absolute text-app-10 leading-none text-subtle"
                    style={{ left: `${(week / HEATMAP_WEEKS) * 100}%` }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div
                className="grid w-full auto-cols-fr grid-flow-col grid-rows-7 gap-[3px]"
                role="img"
                aria-label="Daily token usage activity over the past year"
              >
                {heatmap.cells.map((cell, index) => {
                  if (cell === null) return <div key={`pad-${index}`} className="aspect-square" />;
                  // Edge columns: align the popover inward so it is not clipped
                  // by the container. Tooltip is ~10 columns wide.
                  const week = Math.floor(index / 7);
                  const tooltipPosition =
                    week < 5
                      ? "left-0 translate-x-0"
                      : week >= HEATMAP_WEEKS - 5
                        ? "right-0 translate-x-0"
                        : "left-1/2 -translate-x-1/2";
                  return (
                    <div
                      key={cell.date}
                      className={`group relative aspect-square rounded-[2px] ${HEATMAP_LEVELS[heatmapLevel(cell.total, heatmap.maxTotal)]}`}
                    >
                      <div
                        className={`pointer-events-none absolute bottom-full z-10 mb-1.5 hidden rounded-md border border-border-strong bg-surface-raised px-2 py-1 whitespace-nowrap text-app-11 shadow-xl group-hover:block ${tooltipPosition}`}
                      >
                        <span className="tabular-nums text-fg">
                          {formatExact(cell.total)} tokens
                        </span>{" "}
                        <span className="text-subtle">on {formatDayShort(cell.date)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-end gap-1 text-app-10 text-subtle">
                <span>Less</span>
                {HEATMAP_LEVELS.map((levelClass) => (
                  <div key={levelClass} className={`h-2.5 w-2.5 rounded-[2px] ${levelClass}`} />
                ))}
                <span>More</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Breakdown table */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-app-13 font-medium text-fg">Breakdown</h3>
          <div className="flex rounded-md border border-border bg-surface p-0.5">
            {(["model", "project"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setBreakdownTab(tab)}
                className={`rounded px-2.5 py-1 text-app-12 ${
                  breakdownTab === tab ? "bg-surface-hover text-fg" : "text-subtle hover:text-muted"
                }`}
              >
                {tab === "model" ? "By model" : "By project"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-app-12">
            <thead>
              <tr className="border-b border-border bg-surface text-left text-subtle">
                <th className="px-4 py-2 font-medium">
                  {breakdownTab === "model" ? "Model" : "Project"}
                </th>
                <th className="px-4 py-2 text-right font-medium">Input</th>
                <th className="px-4 py-2 text-right font-medium">Output</th>
                <th className="px-4 py-2 text-right font-medium">Cache read</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="bg-bg">
              {breakdownTab === "model"
                ? models.map((series) => (
                    <tr key={series.model} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2 font-mono text-fg">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: series.color }}
                          />
                          {series.model}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(series.totals.input)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(series.totals.output)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(series.totals.cacheRead)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(series.totals.total)}
                      </td>
                    </tr>
                  ))
                : stats.projects.map((project) => (
                    <tr key={project.workDir} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2 text-fg" title={project.workDir}>
                        {project.name}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(project.totals.input)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(project.totals.output)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(project.totals.cacheRead)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        {formatTokens(project.totals.total)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="h-4 w-40 rounded bg-surface" />
        <div className="h-7 w-36 rounded-md bg-surface" />
      </div>
      <div className="flex gap-8">
        <div className="w-56 shrink-0">
          <div className="h-3 w-16 rounded bg-surface" />
          <div className="mt-1.5 h-6 w-24 rounded bg-surface" />
          <div className="mt-6 flex flex-col gap-3">
            {[0, 1, 2].map((row) => (
              <div key={row}>
                <div className="h-3.5 w-full rounded bg-surface" />
                <div className="mt-1.5 h-1 w-full rounded-full bg-surface" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-56 min-w-0 flex-1 rounded-lg bg-surface" />
      </div>
      <div className="grid grid-cols-6 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {[0, 1, 2, 3, 4, 5].map((cell) => (
          <div key={cell} className="bg-surface px-4 py-3">
            <div className="h-3 w-16 rounded bg-surface-hover" />
            <div className="mt-2 h-5 w-12 rounded bg-surface-hover" />
          </div>
        ))}
      </div>
      <div className="h-40 rounded-lg bg-surface" />
    </div>
  );
}
