import { describe, expect, it } from "bun:test";
import { getRtkGainStats, parseRtkGain } from "./rtkGain";

const SAMPLE_RTK_GAIN = `
RTK Token Savings (Global Scope)
════════════════════════════════════════════════════════════

Total commands:    2059
Input tokens:      7.6M
Output tokens:     1.1M
Tokens saved:      6.5M (85.1%)
Total exec time:   12m59s (avg 378ms)
Efficiency meter: ████████████████████░░░░ 85.1%
`;

describe("parseRtkGain", () => {
  it("parses RTK gain summary fields", () => {
    const stats = parseRtkGain(SAMPLE_RTK_GAIN);

    expect(stats).toEqual({
      totalCommands: 2059,
      inputTokens: 7_600_000,
      outputTokens: 1_100_000,
      tokensSaved: 6_500_000,
      efficiency: 85.1,
    });
  });

  it("adds common CLI install directories before running RTK", async () => {
    const calls: Array<{ command: string; path?: string }> = [];
    const stats = await getRtkGainStats({
      platform: "darwin",
      runner: async (command, _args, options) => {
        calls.push({ command, path: options.env?.PATH });
        return { stdout: SAMPLE_RTK_GAIN, stderr: "" };
      },
    });

    expect(stats.available).toBe(true);
    expect(calls[0]?.command).toBe("rtk");
    expect(calls[0]?.path).toContain("/opt/homebrew/bin");
  });

  it("keeps the Windows PATH intact and joins it with the platform delimiter", async () => {
    const calls: Array<{ command: string; path?: string }> = [];
    const originalPath = process.env.PATH;
    process.env.PATH = "C:\\Windows;C:\\Program Files\\rtk";
    try {
      await getRtkGainStats({
        platform: "win32",
        runner: async (command, _args, options) => {
          calls.push({ command, path: options.env?.PATH });
          return { stdout: SAMPLE_RTK_GAIN, stderr: "" };
        },
      });
    } finally {
      process.env.PATH = originalPath;
    }

    expect(calls[0]?.path).toBe("C:\\Windows;C:\\Program Files\\rtk");
    expect(calls[0]?.path).not.toContain("/opt/homebrew/bin");
  });

  it("falls back to a login shell when direct RTK lookup fails", async () => {
    const calls: string[] = [];
    const stats = await getRtkGainStats({
      platform: "darwin",
      runner: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "rtk") {
          throw Object.assign(new Error("spawn rtk ENOENT"), { code: "ENOENT" });
        }
        return { stdout: SAMPLE_RTK_GAIN, stderr: "" };
      },
    });

    expect(stats.available).toBe(true);
    expect(calls[0]).toBe("rtk gain");
    expect(calls[1]).toContain("-lc rtk gain");
  });

  it("falls back to a cmd.exe invocation on Windows", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const stats = await getRtkGainStats({
      platform: "win32",
      runner: async (command, args) => {
        calls.push({ command, args });
        if (command === "cmd.exe" && args.at(-1) === "rtk gain") {
          return { stdout: SAMPLE_RTK_GAIN, stderr: "" };
        }
        throw Object.assign(new Error("spawn rtk ENOENT"), { code: "ENOENT" });
      },
    });

    expect(stats.available).toBe(true);
    // The direct attempt routes rtk through cmd.exe for the .cmd shim...
    expect(calls[0]).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", "rtk", "gain"] });
    // ...and the fallback retries through a cmd.exe login-equivalent tail.
    expect(calls[1]).toEqual({ command: "cmd.exe", args: ["/d", "/s", "/c", "rtk gain"] });
  });
});
