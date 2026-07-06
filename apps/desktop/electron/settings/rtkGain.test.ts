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
      runner: async (command, _args, options) => {
        calls.push({ command, path: options.env?.PATH });
        return { stdout: SAMPLE_RTK_GAIN, stderr: "" };
      },
    });

    expect(stats.available).toBe(true);
    expect(calls[0]?.command).toBe("rtk");
    expect(calls[0]?.path).toContain("/opt/homebrew/bin");
  });

  it("falls back to a login shell when direct RTK lookup fails", async () => {
    const calls: string[] = [];
    const stats = await getRtkGainStats({
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
});
