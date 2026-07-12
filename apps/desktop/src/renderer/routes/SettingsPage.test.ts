import { describe, expect, it } from "bun:test";
import {
  canCheckKimiConnection,
  formatGlobalAgentInstructionsSize,
  getGlobalAgentInstructionsByteLength,
  readGlobalAgentInstructions,
  readRtkGainStats,
  writeGlobalAgentInstructions,
  writeGlobalRtkInstructions,
} from "./SettingsPage";

describe("canCheckKimiConnection", () => {
  it("requires the detected Kimi command and configured runtime", () => {
    expect(
      canCheckKimiConnection({
        id: "kimi",
        availability: "detected",
        configuration: "configured",
      }),
    ).toBe(true);
    expect(
      canCheckKimiConnection({
        id: "kimi",
        availability: "unavailable",
        configuration: "unknown",
      }),
    ).toBe(false);
    expect(
      canCheckKimiConnection({
        id: "kimi",
        availability: "detected",
        configuration: "missing",
      }),
    ).toBe(false);
  });
});

describe("readRtkGainStats", () => {
  it("returns a restart hint when the current preload does not expose RTK stats", async () => {
    const stats = await readRtkGainStats({});

    expect(stats.available).toBe(false);
    expect(stats.error).toContain("Restart Carrent");
  });

  it("returns RTK stats from the preload API when available", async () => {
    const stats = await readRtkGainStats({
      rtkGain: async () => ({
        available: true,
        totalCommands: 12,
        inputTokens: 1000,
        outputTokens: 200,
        tokensSaved: 800,
        efficiency: 80,
        lastCheckedAt: "2026-07-05T00:00:00.000Z",
      }),
    });

    expect(stats.available).toBe(true);
    expect(stats.tokensSaved).toBe(800);
  });
});

describe("global agent instructions helpers", () => {
  it("measures utf-8 byte length", () => {
    expect(getGlobalAgentInstructionsByteLength("abc")).toBe(3);
    expect(getGlobalAgentInstructionsByteLength("你好")).toBe(6);
  });

  it("formats byte counts", () => {
    expect(formatGlobalAgentInstructionsSize(512)).toBe("512B");
    expect(formatGlobalAgentInstructionsSize(1536)).toBe("1.5KB");
  });

  it("returns a restart hint when preload does not expose global instructions", async () => {
    await readGlobalAgentInstructions({})
      .then(() => {
        throw new Error("Expected read to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });

    await writeGlobalAgentInstructions({}, "")
      .then(() => {
        throw new Error("Expected write to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });

    await writeGlobalRtkInstructions({}, "")
      .then(() => {
        throw new Error("Expected write to fail.");
      })
      .catch((error) => {
        expect((error as Error).message).toContain("Restart Carrent");
      });
  });

  it("forwards reads and writes to the preload API", async () => {
    const snapshot = {
      path: "/Users/test/.agents/AGENTS.md",
      content: "- concise\n",
      exists: true,
      maxBytes: 262144,
    };
    const writes: string[] = [];

    expect(
      await readGlobalAgentInstructions({
        readGlobalAgentInstructions: async () => snapshot,
      }),
    ).toEqual(snapshot);

    expect(
      await writeGlobalAgentInstructions(
        {
          writeGlobalAgentInstructions: async (content) => {
            writes.push(content);
            return { ...snapshot, content };
          },
        },
        "- simple\n",
      ),
    ).toEqual({ ...snapshot, content: "- simple\n" });
    expect(writes).toEqual(["- simple\n"]);
  });

  it("forwards RTK writes to the preload API", async () => {
    const writes: string[] = [];

    expect(
      await writeGlobalRtkInstructions(
        {
          writeGlobalRtkInstructions: async (content) => {
            writes.push(content);
            return { path: "/Users/test/.agents/RTK.md", content };
          },
        },
        "# RTK\n",
      ),
    ).toEqual({ path: "/Users/test/.agents/RTK.md", content: "# RTK\n" });
    expect(writes).toEqual(["# RTK\n"]);
  });
});
