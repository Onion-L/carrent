import { describe, expect, it } from "bun:test";

import {
  createTerminalSessionManager,
  type PtyAdapter,
  type PtyProcess,
} from "./terminalSessionManager";

class FakePty implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  killed = false;
  private dataListeners = new Set<(data: string) => void>();
  private exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

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
    this.resizes.push([columns, rows]);
  }

  kill() {
    this.killed = true;
  }

  emitData(data: string) {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(exitCode = 0) {
    for (const listener of this.exitListeners) listener({ exitCode });
  }
}

function setup(shell = "/bin/zsh") {
  const processes: FakePty[] = [];
  const starts: Parameters<PtyAdapter["spawn"]>[] = [];
  const events: unknown[] = [];
  const manager = createTerminalSessionManager({
    pty: {
      spawn(...args) {
        starts.push(args);
        const process = new FakePty();
        processes.push(process);
        return process;
      },
    },
    emit: (ownerId, event) => events.push({ ownerId, ...event }),
    env: { SHELL: shell, PATH: "/opt/bin", TERM_PROGRAM: "old" },
    fallbackShell: "/bin/zsh",
    isExecutable: (path) => path === "/bin/zsh",
    createId: (() => {
      let next = 0;
      return () => `terminal-${++next}`;
    })(),
  });
  return { manager, processes, starts, events };
}

describe("TerminalSessionManager", () => {
  it("starts an interactive login shell in the Project Working Directory", () => {
    const { manager, starts } = setup("/missing/shell");

    const tab = manager.create({
      ownerId: 7,
      projectId: "project-1",
      projectName: "Carrent",
      workingDirectory: "/work/carrent",
      enhancedCompletion: true,
    });

    expect(tab).toEqual({
      id: "terminal-1",
      projectId: "project-1",
      title: "Carrent",
      active: true,
      status: "running",
      enhancedCompletion: true,
    });
    expect(starts).toHaveLength(1);
    expect(starts[0][0]).toBe("/bin/zsh");
    expect(starts[0][1]).toEqual(["-l", "-i"]);
    expect(starts[0][2]).toMatchObject({
      cwd: "/work/carrent",
      cols: 80,
      rows: 24,
      env: { SHELL: "/missing/shell", PATH: "/opt/bin", TERM_PROGRAM: "Carrent" },
    });
  });

  it("groups Tabs by Project and routes input, resize, output, titles, and exit", () => {
    const { manager, processes, events } = setup();
    const first = manager.create({
      ownerId: 7,
      projectId: "project-1",
      projectName: "Carrent",
      workingDirectory: "/work/carrent",
      enhancedCompletion: false,
    });
    const second = manager.create({
      ownerId: 7,
      projectId: "project-1",
      projectName: "Carrent",
      workingDirectory: "/work/carrent",
      enhancedCompletion: false,
    });

    expect(manager.list(7, "project-1").map((tab) => [tab.title, tab.active])).toEqual([
      ["Carrent", false],
      ["Carrent 2", true],
    ]);
    manager.write(7, "project-1", second.id, "pwd\r");
    manager.resize(7, "project-1", second.id, 120, 40);
    expect(processes[1].writes).toEqual(["pwd\r"]);
    expect(processes[1].resizes).toEqual([[120, 40]]);

    processes[1].emitData("hello\u001b]0; remote host \u0007world");
    processes[1].emitExit(3);
    processes[1].emitExit(3);
    expect(events).toContainEqual({
      ownerId: 7,
      type: "output",
      projectId: "project-1",
      terminalId: second.id,
      data: "hello\u001b]0; remote host \u0007world",
    });
    expect(events).toContainEqual({
      ownerId: 7,
      type: "title",
      projectId: "project-1",
      terminalId: second.id,
      title: "remote host",
    });
    expect(events.filter((event) => (event as { type?: string }).type === "exit")).toHaveLength(1);
    expect(manager.list(7, "project-1").find((tab) => tab.id === second.id)?.status).toBe("exited");
    expect(first.id).not.toBe(second.id);
  });

  it("rejects cross-owner, stale, oversized, and invalid resize requests", () => {
    const { manager } = setup();
    const tab = manager.create({
      ownerId: 7,
      projectId: "project-1",
      projectName: "Carrent",
      workingDirectory: "/work/carrent",
      enhancedCompletion: false,
    });

    expect(() => manager.write(8, "project-1", tab.id, "pwd\r")).toThrow();
    expect(() => manager.write(7, "project-1", tab.id, "x".repeat(65_537))).toThrow();
    expect(() => manager.resize(7, "project-1", tab.id, 0, 24)).toThrow();
    expect(() => manager.resize(7, "project-1", "stale", 80, 24)).toThrow();
  });

  it("terminates Project groups and all remaining Tabs on shutdown", () => {
    const { manager, processes } = setup();
    for (const projectId of ["project-1", "project-2"]) {
      manager.create({
        ownerId: 7,
        projectId,
        projectName: projectId,
        workingDirectory: `/work/${projectId}`,
        enhancedCompletion: false,
      });
    }

    manager.closeProject("project-1");
    expect(processes.map((process) => process.killed)).toEqual([true, false]);
    manager.shutdown();
    expect(processes.map((process) => process.killed)).toEqual([true, true]);
  });

  it("emits local completion only from authenticated Shell Integration state", async () => {
    const process = new FakePty();
    const events: unknown[] = [];
    const completionPaths: string[] = [];
    const manager = createTerminalSessionManager({
      pty: { spawn: () => process },
      emit: (_ownerId, event) => events.push(event),
      env: { SHELL: "/bin/zsh", HOME: "/Users/tester", PATH: "/bin" },
      isExecutable: () => true,
      createShellIntegration: () => ({
        zdotdir: "/tmp/carrent-zsh",
        consume: (data: string) => ({
          visible: data === "trusted" ? "" : data,
          messages:
            data === "trusted"
              ? [
                  {
                    type: "state" as const,
                    cursor: 3,
                    cwd: "/work/carrent",
                    commandLine: "git",
                    path: "/custom/bin",
                    aliases: ["gst"],
                    functions: [],
                  },
                ]
              : [],
        }),
        dispose: () => {},
      }),
      history: {
        record: () => {},
        predict: () => ({ suffix: " status" }),
      },
      complete: async (input) => {
        completionPaths.push(input.path);
        return [
          {
            label: "git",
            insertText: "git",
            kind: "executable",
            replacement: { start: 0, end: 3 },
          },
        ];
      },
    });
    const tab = manager.create({
      ownerId: 7,
      projectId: "project-1",
      projectName: "Carrent",
      workingDirectory: "/work/carrent",
      enhancedCompletion: true,
    });

    process.emitData("ordinary output");
    process.emitData("trusted");
    await Promise.resolve();

    expect(events).toContainEqual({
      type: "output",
      projectId: "project-1",
      terminalId: tab.id,
      data: "ordinary output",
    });
    expect(events).toContainEqual({
      type: "completion",
      projectId: "project-1",
      terminalId: tab.id,
      commandLine: "git",
      cursor: 3,
      predictionSuffix: " status",
      candidates: [
        {
          label: "git",
          insertText: "git",
          kind: "executable",
          replacement: { start: 0, end: 3 },
        },
      ],
    });
    expect(completionPaths).toEqual(["/custom/bin"]);
  });

  it("keeps active selection aligned and parses OSC titles split across output chunks", () => {
    const { manager, processes, events } = setup();
    const tabs = [1, 2, 3].map(() =>
      manager.create({
        ownerId: 7,
        projectId: "project-1",
        projectName: "Carrent",
        workingDirectory: "/work/carrent",
        enhancedCompletion: false,
      }),
    );

    manager.activate(7, "project-1", tabs[1].id);
    processes[1].emitData("\u001b]2;remote");
    processes[1].emitData(" host\u001b\\");
    manager.close(7, "project-1", tabs[1].id);

    expect(manager.list(7, "project-1").map((tab) => [tab.id, tab.active])).toEqual([
      [tabs[0].id, false],
      [tabs[2].id, true],
    ]);
    expect(events).toContainEqual({
      ownerId: 7,
      type: "title",
      projectId: "project-1",
      terminalId: tabs[1].id,
      title: "remote host",
    });
  });
});
