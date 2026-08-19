import { describe, expect, it } from "bun:test";

import type { PtyAdapter, PtyProcess } from "../terminal/terminalSessionManager";
import { createAcpTerminalManager } from "./acpTerminalManager";

class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ columns: number; rows: number }> = [];
  killed = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data: string) {
    this.writes.push(data);
  }

  resize(columns: number, rows: number) {
    this.resizes.push({ columns, rows });
  }

  kill() {
    this.killed = true;
  }

  emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data));
  }

  emitExit(exitCode: number, signal?: number) {
    this.exitListeners.forEach((listener) => listener({ exitCode, signal }));
  }
}

function createHarness() {
  const spawns: Array<{
    file: string;
    args: string[];
    options: Parameters<PtyAdapter["spawn"]>[2];
    process: FakePtyProcess;
  }> = [];
  const pty: PtyAdapter = {
    spawn(file, args, options) {
      const process = new FakePtyProcess();
      spawns.push({ file, args, options, process });
      return process;
    },
  };
  let nextId = 0;
  const manager = createAcpTerminalManager({
    pty,
    cwd: "/workspace",
    env: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
    createId: () => `acp-terminal-${++nextId}`,
  });
  return { manager, spawns };
}

describe("createAcpTerminalManager", () => {
  it("runs current Kimi command and args with the requested environment", async () => {
    const { manager, spawns } = createHarness();

    const created = await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "pwd"],
      cwd: "/workspace/subdir",
      env: [
        { name: "TERM", value: "dumb" },
        { name: "NO_COLOR", value: "1" },
      ],
      outputByteLimit: 1024,
    });

    expect(created).toEqual({ terminalId: "acp-terminal-1" });
    expect(spawns[0]).toMatchObject({
      file: "/bin/bash",
      args: ["-c", "pwd"],
      options: {
        cwd: "/workspace/subdir",
        cols: 80,
        rows: 24,
        name: "dumb",
        env: { PATH: "/usr/bin", SHELL: "/bin/zsh", TERM: "dumb", NO_COLOR: "1" },
      },
    });

    spawns[0]!.process.emitData("/workspace/subdir\r\n");
    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "/workspace/subdir\r\n",
      truncated: false,
    });

    const waiting = manager.waitForExit({ sessionId: "session-1", ...created });
    spawns[0]!.process.emitExit(0);
    expect(await waiting).toEqual({ exitCode: 0 });
    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "/workspace/subdir\r\n",
      truncated: false,
      exitStatus: { exitCode: 0 },
    });
  });

  it("runs legacy Kimi command strings through the user's shell", async () => {
    const { manager, spawns } = createHarness();

    await manager.create({ sessionId: "session-1", command: "ls -la" });

    expect(spawns[0]).toMatchObject({
      file: "/bin/zsh",
      args: ["-lc", "ls -la"],
      options: { cwd: "/workspace" },
    });
  });

  it("truncates retained output from the beginning on a UTF-8 boundary", async () => {
    const { manager, spawns } = createHarness();
    const created = await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "printf output"],
      outputByteLimit: 5,
    });

    spawns[0]!.process.emitData("ab😀cd");

    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "cd",
      truncated: true,
    });
  });

  it("kills without releasing and releases terminal resources separately", async () => {
    const { manager, spawns } = createHarness();
    const created = await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "sleep 60"],
    });

    expect(await manager.kill({ sessionId: "session-1", ...created })).toEqual({});
    expect(spawns[0]!.process.killed).toBe(true);
    expect(await manager.output({ sessionId: "session-1", ...created })).toEqual({
      output: "",
      truncated: false,
    });

    expect(await manager.release({ sessionId: "session-1", ...created })).toEqual({});
    let rejection: unknown;
    try {
      await manager.output({ sessionId: "session-1", ...created });
    } catch (error) {
      rejection = error;
    }
    expect(rejection instanceof Error).toBe(true);
    expect((rejection as Error).message).toContain("ACP terminal is unavailable");
  });

  it("kills and releases every live terminal when the Run closes", async () => {
    const { manager, spawns } = createHarness();
    await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "sleep 60"],
    });
    await manager.create({
      sessionId: "session-1",
      command: "/bin/bash",
      args: ["-c", "sleep 60"],
    });

    await manager.close();

    expect(spawns.map(({ process }) => process.killed)).toEqual([true, true]);
  });
});
