import { describe, expect, it } from "bun:test";

import { registerEditorsIpc } from "./editorIpc";

type Handler = (
  event: unknown,
  editorId?: unknown,
  dirPath?: unknown,
) => Promise<unknown> | unknown;

function createIpcHarness(deps: Parameters<typeof registerEditorsIpc>[1] = {}) {
  const handlers = new Map<string, Handler>();
  registerEditorsIpc(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener as Handler);
      },
    },
    deps,
  );

  return {
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for ${channel}`);
      }
      return handler({}, ...args);
    },
  };
}

const cursorInstalled = {
  platform: "darwin" as const,
  homedir: () => "/Users/tester",
  pathExists: async (targetPath: string) => targetPath === "/Applications/Cursor.app",
};

const darwin = {
  platform: "darwin" as const,
  homedir: () => "/Users/tester",
};

async function captureErrorMessage(action: () => unknown): Promise<string> {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the action to throw.");
}

describe("editors:list", () => {
  it("returns the installed editors", async () => {
    const ipc = createIpcHarness(cursorInstalled);

    const result = await ipc.invoke("editors:list");

    expect(result).toEqual([{ id: "cursor", name: "Cursor", appPath: "/Applications/Cursor.app" }]);
  });
});

describe("editors:open", () => {
  it("opens the directory with the resolved app path and returns an empty string", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const ipc = createIpcHarness({
      ...cursorInstalled,
      run: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, exitCode: 0, stdout: "", stderr: "" };
      },
    });

    const result = await ipc.invoke("editors:open", "cursor", "/tmp/project");

    expect(result).toBe("");
    expect(calls).toEqual([
      { command: "open", args: ["-a", "/Applications/Cursor.app", "/tmp/project"] },
    ]);
  });

  it("launches the detected executable directly on Windows", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const executable = "C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe";
    const ipc = createIpcHarness({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
      pathExists: async (targetPath) => targetPath === executable,
      run: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, exitCode: 0, stdout: "", stderr: "" };
      },
    });

    const result = await ipc.invoke("editors:open", "cursor", "D:\\work\\project");

    expect(result).toBe("");
    expect(calls).toEqual([{ command: executable, args: ["D:\\work\\project"] }]);
  });

  it("launches the detected executable directly on Linux", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const ipc = createIpcHarness({
      platform: "linux",
      homedir: () => "/home/tester",
      pathExists: async (targetPath) => targetPath === "/usr/bin/code",
      run: async (command, args) => {
        calls.push({ command, args });
        return { ok: true, exitCode: 0, stdout: "", stderr: "" };
      },
    });

    const result = await ipc.invoke("editors:open", "vscode", "/home/tester/project");

    expect(result).toBe("");
    expect(calls).toEqual([{ command: "/usr/bin/code", args: ["/home/tester/project"] }]);
  });

  it("returns an error message when the editor is not installed", async () => {
    const ipc = createIpcHarness({
      ...darwin,
      pathExists: async () => false,
      run: async () => {
        throw new Error("run should not be called");
      },
    });

    const result = await ipc.invoke("editors:open", "cursor", "/tmp/project");

    expect(result).toBe("Cursor is not installed.");
  });

  it("returns the open command stderr when opening fails", async () => {
    const ipc = createIpcHarness({
      ...cursorInstalled,
      run: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "Unable to find application named '/Applications/Cursor.app'\n",
      }),
    });

    const result = await ipc.invoke("editors:open", "cursor", "/tmp/project");

    expect(result).toBe(
      "Failed to open Cursor: Unable to find application named '/Applications/Cursor.app'",
    );
  });

  it("returns a generic error message when opening fails without output", async () => {
    const ipc = createIpcHarness({
      ...cursorInstalled,
      run: async () => ({ ok: false, exitCode: 1, stdout: "", stderr: "" }),
    });

    const result = await ipc.invoke("editors:open", "cursor", "/tmp/project");

    expect(result).toBe("Failed to open Cursor.");
  });

  it("rejects an unknown editor id", async () => {
    const ipc = createIpcHarness(cursorInstalled);

    const message = await captureErrorMessage(() =>
      ipc.invoke("editors:open", "emacs", "/tmp/project"),
    );

    expect(message).toBe("Unknown editor: emacs");
  });

  it("rejects a missing directory path", async () => {
    const ipc = createIpcHarness(cursorInstalled);

    for (const dirPath of ["", 42]) {
      const message = await captureErrorMessage(() =>
        ipc.invoke("editors:open", "cursor", dirPath),
      );
      expect(message).toBe("Invalid directory path.");
    }
  });

  it("rejects a missing editor id", async () => {
    const ipc = createIpcHarness(cursorInstalled);

    const message = await captureErrorMessage(() =>
      ipc.invoke("editors:open", undefined, "/tmp/project"),
    );

    expect(message).toBe("Editor id is required.");
  });
});
