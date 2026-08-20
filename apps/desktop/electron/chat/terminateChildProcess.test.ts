import { describe, expect, it } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { terminateChildProcess } from "./terminateChildProcess";

type FakeChildProcess = ChildProcess & {
  signals: NodeJS.Signals[];
};

function createChild(onKill?: (signal: NodeJS.Signals, child: FakeChildProcess) => void) {
  const child = new EventEmitter() as FakeChildProcess;
  Object.defineProperties(child, {
    pid: { value: 4242, writable: true },
    exitCode: { value: null, writable: true },
    signalCode: { value: null, writable: true },
  });
  child.signals = [];
  child.kill = (signal: NodeJS.Signals | number = "SIGTERM") => {
    const normalizedSignal = typeof signal === "number" ? "SIGTERM" : signal;
    child.signals.push(normalizedSignal);
    onKill?.(normalizedSignal, child);
    return true;
  };
  return child;
}

describe("terminateChildProcess", () => {
  it("waits for the child to close after SIGTERM", async () => {
    const child = createChild();
    let finished = false;

    const termination = terminateChildProcess(child, 20, { platform: "darwin" }).then(() => {
      finished = true;
    });

    expect(child.signals).toEqual(["SIGTERM"]);
    expect(finished).toBe(false);

    child.emit("close", null, "SIGTERM");
    await termination;
    expect(finished).toBe(true);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const child = createChild((signal, currentChild) => {
      if (signal === "SIGKILL") {
        setTimeout(() => currentChild.emit("close", null, "SIGKILL"), 0);
      }
    });

    await terminateChildProcess(child, 1, { platform: "darwin" });

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("rejects when the child reports an error before closing", async () => {
    const child = createChild();
    const childError = new Error("kill failed");
    const termination = terminateChildProcess(child, 20, { platform: "darwin" });

    child.emit("error", childError);

    const rejection = await termination.then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).toBe(childError);
  });

  it("terminates the process tree immediately on Windows", async () => {
    const child = createChild();
    const taskkillInvocations: string[][] = [];
    let finished = false;
    const termination = terminateChildProcess(child, 20, {
      platform: "win32",
      runTaskkill: (args) => {
        taskkillInvocations.push(args);
        return { on: () => {} };
      },
    }).then(() => {
      finished = true;
    });

    expect(child.pid).toBe(4242);
    expect(taskkillInvocations).toEqual([["/pid", "4242", "/T", "/F"]]);
    expect(child.signals).toEqual([]);
    expect(finished).toBe(false);

    child.emit("close", null, null);
    await termination;
    expect(finished).toBe(true);
  });

  it("rejects when the Windows process tree survives taskkill", async () => {
    const child = createChild();

    const rejection = await terminateChildProcess(child, 5, {
      platform: "win32",
      runTaskkill: () => ({ on: () => {} }),
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(rejection instanceof Error).toBe(true);
    expect((rejection as Error).message).toBe("Agent process did not exit after taskkill.");
  });
});
