import { describe, expect, it } from "bun:test";
import {
  formatGlobalAgentInstructionsSize,
  getKimiInstallCommand,
  getKimiSetupAction,
  getKimiSetupSteps,
  getGlobalAgentInstructionsByteLength,
  readGlobalAgentInstructions,
  readRtkGainStats,
  shouldShowKimiSetup,
  writeGlobalAgentInstructions,
} from "./SettingsPage";

describe("Kimi setup helpers", () => {
  it("shows setup only when Kimi is unavailable or unconfigured", () => {
    expect(
      shouldShowKimiSetup({
        id: "kimi",
        availability: "unavailable",
        configuration: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldShowKimiSetup({
        id: "kimi",
        availability: "detected",
        configuration: "missing",
      }),
    ).toBe(true);
    expect(
      shouldShowKimiSetup({
        id: "kimi",
        availability: "detected",
        configuration: "configured",
      }),
    ).toBe(false);
    expect(
      shouldShowKimiSetup({
        id: "codex",
        availability: "unavailable",
        configuration: "unknown",
      }),
    ).toBe(false);
  });

  it("marks CLI and auth steps from runtime state", () => {
    expect(
      getKimiSetupSteps({
        availability: "unavailable",
        configuration: "unknown",
      }).map((step) => step.done),
    ).toEqual([false, false, false]);

    expect(
      getKimiSetupSteps({
        availability: "detected",
        configuration: "missing",
      }).map((step) => step.done),
    ).toEqual([true, true, false]);
  });

  it("uses the install command until the Kimi CLI is detected", () => {
    const action = getKimiSetupAction(
      {
        availability: "unavailable",
        configuration: "unknown",
      },
      "darwin",
    );

    expect(action).toMatchObject({
      command: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    });
    expect(action.description).toContain("sign in");
    expect(action.copiedMessage).toContain("sign-in command");
  });

  it("uses the sign-in command after the Kimi CLI is detected", () => {
    const action = getKimiSetupAction(
      {
        availability: "detected",
        configuration: "missing",
      },
      "darwin",
    );

    expect(action).toMatchObject({
      command: "kimi",
    });
    expect(action.description).toContain("finish sign-in");
  });

  it("selects the install command for the current platform", () => {
    expect(getKimiInstallCommand("darwin")).toBe(
      "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    );
    expect(getKimiInstallCommand("linux")).toBe(
      "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
    );
    expect(getKimiInstallCommand("win32")).toBe(
      "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
    );
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
});
