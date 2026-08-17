import { describe, expect, it } from "bun:test";

import { registerTerminalIpc } from "./terminalIpc";

describe("registerTerminalIpc", () => {
  it("dispatches typed terminal operations using the sending Renderer owner", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const calls: unknown[] = [];
    const manager = {
      subscribe: (ownerId: number, projectId: string) => {
        calls.push(["subscribe", ownerId, projectId]);
        return { projectId, revision: 0, tabs: [], outputByTerminal: {} };
      },
      unsubscribe: (...args: unknown[]) => void calls.push(["unsubscribe", ...args]),
      list: (ownerId: number, projectId: string) => {
        calls.push(["list", ownerId, projectId]);
        return [];
      },
      create: (input: unknown) => {
        calls.push(["create", input]);
        return {
          id: "terminal-1",
          projectId: "project-1",
          title: "Carrent",
          active: true,
          status: "running" as const,
          enhancedCompletion: true,
        };
      },
      write: (...args: unknown[]) => void calls.push(["write", ...args]),
      resize: (...args: unknown[]) => void calls.push(["resize", ...args]),
      focus: (...args: unknown[]) => void calls.push(["focus", ...args]),
      activate: (...args: unknown[]) => void calls.push(["activate", ...args]),
      close: (...args: unknown[]) => void calls.push(["close", ...args]),
      closeProject: (projectId: string) => void calls.push(["close-project", projectId]),
    };

    registerTerminalIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      manager,
    );
    const event = { sender: { id: 42 } };
    await handlers.get("terminal:subscribe")?.(event, "project-1");
    await handlers.get("terminal:list")?.(event, "project-1");
    await handlers.get("terminal:create")?.(event, {
      projectId: "project-1",
      projectName: "Carrent",
      workingDirectory: "/work/carrent",
      enhancedCompletion: true,
    });
    await handlers.get("terminal:write")?.(event, {
      projectId: "project-1",
      terminalId: "terminal-1",
      data: "ls\r",
    });
    await handlers.get("terminal:resize")?.(event, {
      projectId: "project-1",
      terminalId: "terminal-1",
      columns: 100,
      rows: 30,
      focusVersion: 4,
    });
    await handlers.get("terminal:focus")?.(event, {
      projectId: "project-1",
      terminalId: "terminal-1",
      focused: true,
      columns: 100,
      rows: 30,
      focusVersion: 4,
    });
    await handlers.get("terminal:activate")?.(event, {
      projectId: "project-1",
      terminalId: "terminal-1",
    });
    await handlers.get("terminal:close")?.(event, {
      projectId: "project-1",
      terminalId: "terminal-1",
    });
    await handlers.get("terminal:close-project")?.(event, "project-1");
    await handlers.get("terminal:unsubscribe")?.(event, "project-1");

    expect(calls).toEqual([
      ["subscribe", 42, "project-1"],
      ["list", 42, "project-1"],
      [
        "create",
        {
          ownerId: 42,
          projectId: "project-1",
          projectName: "Carrent",
          workingDirectory: "/work/carrent",
          enhancedCompletion: true,
          ensureFirst: false,
        },
      ],
      ["write", 42, "project-1", "terminal-1", "ls\r"],
      ["resize", 42, "project-1", "terminal-1", 100, 30, 4],
      ["focus", 42, "project-1", "terminal-1", true, 100, 30, 4],
      ["activate", 42, "project-1", "terminal-1"],
      ["close", 42, "project-1", "terminal-1"],
      ["close-project", "project-1"],
      ["unsubscribe", 42, "project-1"],
    ]);
  });

  it("rejects malformed bridge payloads before dispatch", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    registerTerminalIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        subscribe: (_ownerId: number, projectId: string) => ({
          projectId,
          revision: 0,
          tabs: [],
          outputByTerminal: {},
        }),
        unsubscribe: () => {},
        list: () => [],
        create: () => {
          throw new Error("not reached");
        },
        write: () => {},
        resize: () => {},
        focus: () => {},
        activate: () => {},
        close: () => {},
        closeProject: () => {},
      },
    );

    expect(() => handlers.get("terminal:create")?.({ sender: { id: 1 } }, null)).toThrow();
    expect(() =>
      handlers.get("terminal:write")?.(
        { sender: { id: 1 } },
        { projectId: "project-1", terminalId: "terminal-1", data: 12 },
      ),
    ).toThrow();
    expect(() => handlers.get("terminal:list")?.({ sender: {} }, "project-1")).toThrow();
  });

  it("mirrors terminal focus into the focus sink for scoped shortcuts", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const focusCalls: Array<{ contentsId: number; focused: boolean }> = [];
    registerTerminalIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        subscribe: () => ({ projectId: "project-1", revision: 0, tabs: [], outputByTerminal: {} }),
        unsubscribe: () => {},
        list: () => [],
        create: () => ({
          id: "terminal-1",
          projectId: "project-1",
          title: "Carrent",
          active: true,
          status: "running" as const,
          enhancedCompletion: true,
        }),
        write: () => {},
        resize: () => {},
        focus: () => {},
        activate: () => {},
        close: () => {},
        closeProject: () => {},
      },
      {
        setTerminalFocused: (contentsId, focused) => focusCalls.push({ contentsId, focused }),
      },
    );

    await handlers.get("terminal:focus")?.(
      { sender: { id: 42 } },
      {
        projectId: "project-1",
        terminalId: "terminal-1",
        focused: true,
        columns: 100,
        rows: 30,
        focusVersion: 4,
      },
    );
    await handlers.get("terminal:focus")?.(
      { sender: { id: 42 } },
      {
        projectId: "project-1",
        terminalId: "terminal-1",
        focused: false,
        columns: 100,
        rows: 30,
        focusVersion: 5,
      },
    );

    expect(focusCalls).toEqual([
      { contentsId: 42, focused: true },
      { contentsId: 42, focused: false },
    ]);
  });
});
