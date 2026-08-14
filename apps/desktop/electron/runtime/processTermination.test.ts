import { describe, expect, it } from "bun:test";

import { killProcessTree } from "./processTermination";

function createChild(pid?: number) {
  const killed: string[] = [];
  return {
    child: {
      pid,
      kill: (signal: NodeJS.Signals | number = "SIGTERM") => {
        killed.push(typeof signal === "number" ? String(signal) : signal);
        return true;
      },
    },
    killed,
  };
}

describe("killProcessTree", () => {
  it("kills the child directly on POSIX platforms", () => {
    const { child, killed } = createChild(42);

    expect(killProcessTree(child, { platform: "darwin" })).toBe(true);
    expect(killed).toEqual(["SIGTERM"]);
  });

  it("runs taskkill against the whole process tree on Windows", () => {
    const { child } = createChild(1337);
    const invocations: string[][] = [];

    killProcessTree(child, {
      platform: "win32",
      runTaskkill: (args) => {
        invocations.push(args);
        return { on: () => {} };
      },
    });

    expect(invocations).toEqual([["/pid", "1337", "/T", "/F"]]);
  });

  it("falls back to a direct kill when taskkill cannot be spawned", async () => {
    const { child, killed } = createChild(1337);
    const errorListeners: Array<(error: Error) => void> = [];

    killProcessTree(child, {
      platform: "win32",
      runTaskkill: () => ({
        on: (_event, listener) => {
          errorListeners.push(listener);
        },
      }),
    });
    expect(killed).toEqual([]);

    errorListeners[0]?.(new Error("spawn taskkill ENOENT"));
    await Promise.resolve();

    expect(killed).toEqual(["SIGTERM"]);
  });

  it("kills directly when the Windows child has no pid yet", () => {
    const { child, killed } = createChild(undefined);

    killProcessTree(child, {
      platform: "win32",
      runTaskkill: () => {
        throw new Error("taskkill must not run without a pid");
      },
    });

    expect(killed).toEqual(["SIGTERM"]);
  });
});
