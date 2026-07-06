import { describe, expect, it } from "bun:test";
import { registerSettingsIpc } from "./settingsIpc";

describe("registerSettingsIpc", () => {
  it("registers settings handlers", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc({
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    });

    expect([...handlers.keys()].sort()).toEqual([
      "settings:check-for-updates",
      "settings:global-agent-instructions:read",
      "settings:global-agent-instructions:write",
      "settings:rtk-gain",
    ]);
  });

  it("rejects non-string global instructions content", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerSettingsIpc({
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    });

    try {
      await handlers.get("settings:global-agent-instructions:write")?.({}, 123);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Global agent instructions content must be a string.");
    }
  });
});
