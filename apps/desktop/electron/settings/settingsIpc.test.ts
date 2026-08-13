import { describe, expect, it } from "bun:test";
import { registerSettingsIpc } from "./settingsIpc";

describe("registerSettingsIpc", () => {
  it("registers settings handlers", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
    );

    expect([...handlers.keys()].sort()).toEqual([
      "settings:app-version",
      "settings:check-for-updates",
      "settings:global-agent-instructions:read",
      "settings:global-agent-instructions:write",
      "settings:global-rtk-instructions:write",
      "settings:kimi-memory",
      "settings:kimi-memory:delete",
      "settings:kimi-usage",
      "settings:rtk-gain",
      "settings:worktrees",
    ]);
  });

  it("scans worktrees from the provided projects", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
    );

    const result = (await handlers.get("settings:worktrees")?.({})) as {
      entries: unknown[];
      scannedAt: string;
    };

    expect(result.entries).toEqual([]);
    expect(typeof result.scannedAt).toBe("string");
  });

  it("rejects non-string kimi memory delete paths", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
    );

    try {
      await handlers.get("settings:kimi-memory:delete")?.({}, 123);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Kimi memory file path must be a string.");
    }
  });

  it("rejects non-string global instructions content", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
    );

    try {
      await handlers.get("settings:global-agent-instructions:write")?.({}, 123);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Global agent instructions content must be a string.");
    }
  });

  it("rejects non-string global RTK instructions content", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
    );

    try {
      await handlers.get("settings:global-rtk-instructions:write")?.({}, 123);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Global RTK instructions content must be a string.");
    }
  });
});
