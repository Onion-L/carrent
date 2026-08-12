import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getKimiUsageStats, resetKimiUsageCache } from "./kimiUsage";

let homeDir: string;

function recordLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "usage.record",
    model: "kimi-code/k3",
    usage: { inputOther: 100, output: 10, inputCacheRead: 50, inputCacheCreation: 5 },
    usageScope: "turn",
    time: 1786519619762,
    ...overrides,
  });
}

async function writeWireFile(sessionId: string, lines: string[], agent = "main"): Promise<string> {
  const dir = path.join(
    homeDir,
    ".kimi-code",
    "sessions",
    "wd_test_0001",
    sessionId,
    "agents",
    agent,
  );
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "wire.jsonl");
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function writeSessionIndex(entries: Array<{ sessionId: string; workDir: string }>) {
  const kimiDir = path.join(homeDir, ".kimi-code");
  await fs.mkdir(kimiDir, { recursive: true });
  const lines = entries.map((entry) =>
    JSON.stringify({
      sessionId: entry.sessionId,
      sessionDir: path.join(kimiDir, "sessions", "wd_test_0001", entry.sessionId),
      workDir: entry.workDir,
    }),
  );
  await fs.writeFile(path.join(kimiDir, "session_index.jsonl"), `${lines.join("\n")}\n`, "utf8");
}

function localDay(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

beforeEach(async () => {
  resetKimiUsageCache();
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-usage-test-"));
});

afterEach(async () => {
  await fs.rm(homeDir, { recursive: true, force: true });
});

describe("getKimiUsageStats", () => {
  it("returns empty stats when kimi-code has never been installed", async () => {
    const stats = await getKimiUsageStats({ homeDir });

    expect(stats.days).toEqual([]);
    expect(stats.models).toEqual({});
    expect(stats.projects).toEqual([]);
    expect(stats.sessionCount).toBe(0);
    expect(stats.firstActivityAt).toBe(null);
    expect(stats.lastActivityAt).toBe(null);
  });

  it("counts only turn-scoped records", async () => {
    await writeWireFile("session_a", [
      recordLine(),
      recordLine({ usageScope: "session" }),
      recordLine({ type: "message", usageScope: "turn" }),
      '{"type":"usage.record","usageScope":"turn","time":"not-a-number"}',
    ]);

    const stats = await getKimiUsageStats({ homeDir });

    expect(stats.models.k3?.total).toBe(165);
    expect(stats.sessionCount).toBe(1);
  });

  it("normalizes the kimi-code/ model prefix", async () => {
    await writeWireFile("session_a", [
      recordLine({ model: "kimi-code/k3" }),
      recordLine({ model: "k3" }),
      recordLine({ model: "kimi-code/kimi-for-coding-highspeed" }),
    ]);

    const stats = await getKimiUsageStats({ homeDir });

    expect(Object.keys(stats.models).sort()).toEqual(["k3", "kimi-for-coding-highspeed"]);
    expect(stats.models.k3?.total).toBe(330);
  });

  it("aggregates records into local day buckets", async () => {
    const dayOne = 1786519619762;
    const dayTwo = dayOne + 24 * 60 * 60 * 1000;
    await writeWireFile("session_a", [
      recordLine({ time: dayOne }),
      recordLine({
        time: dayOne + 1000,
        usage: { inputOther: 1, output: 2, inputCacheRead: 3, inputCacheCreation: 4 },
      }),
      recordLine({ time: dayTwo, model: "other" }),
    ]);

    const stats = await getKimiUsageStats({ homeDir });

    expect(stats.days.map((day) => day.date)).toEqual([localDay(dayOne), localDay(dayTwo)]);
    const first = stats.days[0];
    expect(first?.byModel.k3).toEqual({
      input: 101,
      output: 12,
      cacheRead: 53,
      cacheCreation: 9,
      total: 175,
    });
    expect(stats.firstActivityAt).toBe(dayOne);
    expect(stats.lastActivityAt).toBe(dayTwo);
  });

  it("associates sessions with projects via session_index.jsonl", async () => {
    await writeWireFile("session_a", [recordLine(), recordLine()]);
    await writeWireFile("session_b", [recordLine()]);
    await writeWireFile("session_unknown", [recordLine()]);
    await writeSessionIndex([
      { sessionId: "session_a", workDir: "/Users/test/workbench/carrent" },
      { sessionId: "session_b", workDir: "/Users/test/workbench/landing" },
    ]);

    const stats = await getKimiUsageStats({ homeDir });

    expect(stats.projects).toEqual([
      {
        workDir: "/Users/test/workbench/carrent",
        name: "carrent",
        totals: { input: 200, output: 20, cacheRead: 100, cacheCreation: 10, total: 330 },
      },
      {
        workDir: "/Users/test/workbench/landing",
        name: "landing",
        totals: { input: 100, output: 10, cacheRead: 50, cacheCreation: 5, total: 165 },
      },
    ]);
    expect(stats.sessionCount).toBe(3);
  });

  it("serves unchanged files from cache and rescans modified ones", async () => {
    const scanned: string[] = [];
    const filePath = await writeWireFile("session_a", [recordLine()]);

    const first = await getKimiUsageStats({ homeDir, onFileScanned: (file) => scanned.push(file) });
    expect(first.models.k3?.total).toBe(165);
    expect(scanned).toEqual([filePath]);

    scanned.length = 0;
    await getKimiUsageStats({ homeDir, onFileScanned: (file) => scanned.push(file) });
    expect(scanned).toEqual([]);

    await fs.appendFile(filePath, `${recordLine()}\n`, "utf8");
    const third = await getKimiUsageStats({
      homeDir,
      onFileScanned: (file) => scanned.push(file),
    });
    expect(scanned).toEqual([filePath]);
    expect(third.models.k3?.total).toBe(330);
  });
});
