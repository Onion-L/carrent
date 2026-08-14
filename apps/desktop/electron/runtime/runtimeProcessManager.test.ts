import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { RuntimeProcessManager } from "./runtimeProcessManager";

function createFakeChild(pid = 4242) {
  const child = new EventEmitter() as ChildProcess & { killed: boolean };
  Object.defineProperty(child, "pid", { value: pid });
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.killed = false;
  return child;
}

describe("RuntimeProcessManager", () => {
  it("starts the runtime command unchanged on POSIX platforms", () => {
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const manager = new RuntimeProcessManager({
      platform: "darwin",
      spawnChild: (command, args) => {
        spawnCalls.push({ command, args });
        return createFakeChild();
      },
    });

    const entry = manager.start("kimi");

    expect(entry.pid).toBe(4242);
    expect(spawnCalls).toEqual([{ command: "kimi", args: [] }]);
  });

  it("starts npm .cmd shims through cmd.exe on Windows", () => {
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const manager = new RuntimeProcessManager({
      platform: "win32",
      env: { COMSPEC: "C:\\Windows\\system32\\cmd.exe" },
      spawnChild: (command, args) => {
        spawnCalls.push({ command, args });
        return createFakeChild();
      },
    });

    manager.start("kimi");

    expect(spawnCalls).toEqual([
      {
        command: "C:\\Windows\\system32\\cmd.exe",
        args: ["/d", "/s", "/c", "kimi"],
      },
    ]);
  });

  it("kills the tracked child process on stop", () => {
    const child = createFakeChild();
    const manager = new RuntimeProcessManager({
      platform: "darwin",
      spawnChild: () => child,
    });

    manager.start("kimi");
    expect(manager.stop("kimi")).toBe(true);
    expect(child.killed).toBe(true);
    expect(manager.getEntry("kimi")).toBeUndefined();
    expect(manager.stop("kimi")).toBe(false);
  });
});
