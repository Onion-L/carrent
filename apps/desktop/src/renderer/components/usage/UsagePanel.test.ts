import { describe, expect, it } from "bun:test";

import type { KimiUsageStats } from "../../../shared/kimiUsage";
import {
  buildHeatmap,
  buildRangeDays,
  collectModels,
  groupProjects,
  heatmapLevel,
  readKimiUsageStats,
} from "./UsagePanel";

function makeStats(days: KimiUsageStats["days"]): KimiUsageStats {
  return {
    days,
    models: {},
    projects: [],
    sessionCount: days.length,
    firstActivityAt: null,
    lastActivityAt: null,
    scannedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("readKimiUsageStats", () => {
  it("returns a restart hint when the current preload does not expose kimi usage", async () => {
    const result = await readKimiUsageStats({});

    expect(result.stats).toBe(null);
    expect(result.error).toContain("Restart Carrent");
  });

  it("returns stats from the preload API when available", async () => {
    const stats = makeStats([]);
    const result = await readKimiUsageStats({ kimiUsage: async () => stats });

    expect(result.error).toBe(null);
    expect(result.stats).toBe(stats);
  });

  it("returns the error message when the preload call rejects", async () => {
    const result = await readKimiUsageStats({
      kimiUsage: async () => {
        throw new Error("scan failed");
      },
    });

    expect(result.stats).toBe(null);
    expect(result.error).toBe("scan failed");
  });
});

describe("buildRangeDays", () => {
  it("fills every local day in the range, including days without records", () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const stats = makeStats([
      {
        date: todayIso,
        byModel: { k3: { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, total: 10 } },
      },
    ]);

    const days = buildRangeDays(stats, 7);

    expect(days).toHaveLength(7);
    expect(days[6]?.date).toBe(todayIso);
    expect(days[6]?.byModel.k3?.total).toBe(10);
    expect(days[0]?.byModel).toEqual({});
    for (let index = 1; index < days.length; index += 1) {
      const previous = new Date(`${days[index - 1]!.date}T00:00:00`).getTime();
      const current = new Date(`${days[index]!.date}T00:00:00`).getTime();
      expect(current - previous).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("buildHeatmap", () => {
  // Wednesday, so the current week has 3 null padding cells after it.
  const today = new Date(2026, 7, 12, 15, 0, 0);

  it("builds 53 week columns ending at today's week, padding future days with null", () => {
    const heatmap = buildHeatmap(makeStats([]), today);

    expect(heatmap.cells).toHaveLength(53 * 7);
    // Today is row 3 (Wed) of the last column; the next three rows are future.
    const todayIndex = 52 * 7 + 3;
    expect(heatmap.cells[todayIndex]?.date).toBe("2026-08-12");
    expect(heatmap.cells[todayIndex + 1]).toBe(null);
    expect(heatmap.cells[53 * 7 - 1]).toBe(null);
    // First cell is the Sunday 52 weeks before today's week.
    expect(heatmap.cells[0]?.date).toBe("2025-08-10");
    expect(heatmap.maxTotal).toBe(0);
  });

  it("maps per-day token totals onto matching cells and tracks the maximum", () => {
    const stats = makeStats([
      {
        date: "2026-08-12",
        byModel: {
          a: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0, total: 4 },
          b: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0, total: 6 },
        },
      },
    ]);

    const heatmap = buildHeatmap(stats, today);
    const cell = heatmap.cells.find((entry) => entry?.date === "2026-08-12");

    expect(cell?.total).toBe(10);
    expect(heatmap.maxTotal).toBe(10);
  });

  it("labels the week column where each month starts", () => {
    const heatmap = buildHeatmap(makeStats([]), today);

    expect(heatmap.monthLabels[0]).toEqual({ week: 0, label: "Aug" });
    const weeks = heatmap.monthLabels.map(({ week }) => week);
    for (let index = 1; index < weeks.length; index += 1) {
      expect(weeks[index]!).toBeGreaterThan(weeks[index - 1]!);
    }
    expect(heatmap.monthLabels.length).toBeGreaterThan(11);
  });
});

describe("heatmapLevel", () => {
  it("buckets totals into empty + quartiles of the maximum", () => {
    expect(heatmapLevel(0, 100)).toBe(0);
    expect(heatmapLevel(10, 100)).toBe(1);
    expect(heatmapLevel(40, 100)).toBe(2);
    expect(heatmapLevel(60, 100)).toBe(3);
    expect(heatmapLevel(90, 100)).toBe(4);
    expect(heatmapLevel(5, 0)).toBe(0);
  });
});

describe("groupProjects", () => {
  function makeProject(name: string, total: number): KimiUsageStats["projects"][number] {
    return {
      workDir: `/tmp/${name}`,
      name,
      totals: { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total },
    };
  }

  it("collapses thread-title temp dirs into one group, sorted by total", () => {
    const groups = groupProjects([
      makeProject("carrent-thread-title-akcTsv", 20),
      makeProject("carrent", 100),
      makeProject("carrent-thread-title-ishILd", 30),
      makeProject("martia", 60),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["carrent", "martia", "Thread titles"]);
    const titles = groups[2]!;
    expect(titles.totals.total).toBe(50);
    expect(titles.totals.input).toBe(50);
    expect(titles.projects?.map((project) => project.name)).toEqual([
      "carrent-thread-title-akcTsv",
      "carrent-thread-title-ishILd",
    ]);
    expect(groups[0]?.projects).toBe(null);
  });

  it("returns plain standalone groups when there are no thread-title dirs", () => {
    const groups = groupProjects([makeProject("carrent", 100)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("carrent");
    expect(groups[0]?.projects).toBe(null);
  });
});

describe("collectModels", () => {
  it("sorts models by descending total and assigns palette colors in that order", () => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const days = buildRangeDays(
      makeStats([
        {
          date: todayIso,
          byModel: {
            small: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0, total: 1 },
            big: { input: 5, output: 5, cacheRead: 90, cacheCreation: 0, total: 100 },
          },
        },
      ]),
      1,
    );

    const models = collectModels(days, ["#first", "#second"]);

    expect(models.map((series) => series.model)).toEqual(["big", "small"]);
    expect(models[0]?.color).toBe("#first");
    expect(models[1]?.color).toBe("#second");
  });
});
