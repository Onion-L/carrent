import { describe, expect, it } from "bun:test";

import type { KimiUsageStats } from "../../../shared/kimiUsage";
import { buildRangeDays, collectModels, readKimiUsageStats } from "./UsagePanel";

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

describe("collectModels", () => {
  it("sorts models by descending total and assigns palette colors in that order", () => {
    const days = buildRangeDays(
      makeStats([
        {
          date: "2026-08-12",
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
