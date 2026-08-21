import { describe, expect, it } from "bun:test";
import { isAbsoluteWorktreePath, registerSettingsIpc } from "./settingsIpc";

describe("isAbsoluteWorktreePath", () => {
  it("accepts Unix absolute paths on POSIX platforms", () => {
    expect(isAbsoluteWorktreePath("/repo/worktree", "darwin")).toBe(true);
    expect(isAbsoluteWorktreePath("repo/worktree", "darwin")).toBe(false);
  });

  it("accepts drive-letter and UNC worktree paths on Windows", () => {
    expect(isAbsoluteWorktreePath("D:\\repo\\worktree", "win32")).toBe(true);
    expect(isAbsoluteWorktreePath("\\\\server\\share\\worktree", "win32")).toBe(true);
    expect(isAbsoluteWorktreePath("repo\\worktree", "win32")).toBe(false);
  });
});

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
      "settings:permission-rules:add",
      "settings:permission-rules:list",
      "settings:permission-rules:revoke",
      "settings:rtk-gain",
      "settings:worktrees",
      "settings:worktrees:prune",
      "settings:worktrees:remove",
      "settings:worktrees:sizes:cancel",
      "settings:worktrees:sizes:start",
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

  it("evaluates the authoritative activity snapshot on every scan", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const activityCalls: number[] = [];

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
      () => {
        activityCalls.push(1);
        return { liveRunProjectIds: ["project-1"], runningTerminalTabs: [] };
      },
    );

    const scan = handlers.get("settings:worktrees");
    await scan?.({});
    await scan?.({});

    // The scan re-reads Main Process authority per request instead of caching,
    // so peer windows always observe the same current state.
    expect(activityCalls).toHaveLength(2);
  });

  it("rejects prune requests without a repository common directory", async () => {
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
    const prune = handlers.get("settings:worktrees:prune");
    for (const invalid of [{}, ""]) {
      let thrown: unknown = null;
      try {
        await prune?.({}, invalid);
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error).toBe(true);
      if (thrown instanceof Error) {
        expect(thrown.message).toContain(
          "Worktree pruning requires the repository common directory",
        );
      }
    }
  });
  it("rejects removal requests without a common directory or worktree path", async () => {
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
    const remove = handlers.get("settings:worktrees:remove");
    for (const invalid of [{}, "", { commonDirectory: "/repo" }, { worktreePath: "/wt" }]) {
      let thrown: unknown = null;
      try {
        await remove?.({}, invalid);
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error).toBe(true);
      if (thrown instanceof Error) {
        expect(thrown.message).toContain(
          "Worktree removal requires the repository common directory",
        );
      }
    }
  });

  it("rejects invalid worktree size requests and forwards starts to the scanner", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const starts: unknown[] = [];

    registerSettingsIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      () => "0.0.0-test",
      () => [],
      undefined,
      {
        start: (_ownerId: number, targets: unknown) => {
          starts.push(targets);
          return { generation: 1 };
        },
        cancel: () => {},
      },
    );

    const start = handlers.get("settings:worktrees:sizes:start");
    const cancel = handlers.get("settings:worktrees:sizes:cancel");
    if (!start || !cancel) throw new Error("size handlers not registered");

    for (const invalid of [{}, [], [{ worktreePath: "/x" }], [{ commonDirectory: "/r" }]]) {
      let thrown: unknown = null;
      try {
        await start({ sender: { id: 7 } }, invalid);
      } catch (error) {
        thrown = error;
      }
      expect(thrown instanceof Error).toBe(true);
    }

    const result = await start({ sender: { id: 7 } }, [
      { commonDirectory: "/repo/.git", worktreePath: "/repo/wt" },
    ]);
    expect(result).toEqual({ generation: 1 });
    expect(starts).toEqual([[{ commonDirectory: "/repo/.git", worktreePath: "/repo/wt" }]]);

    await cancel({}, 1);
    await cancel({}, 2);
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
