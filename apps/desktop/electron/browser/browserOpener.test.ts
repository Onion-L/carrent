import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { installBrowserOpener } from "./browserOpener";

interface SpawnInvocation {
  command: string;
  args: string[];
  options: {
    env?: Record<string, string | undefined>;
  };
}

function expectedBrowserTarget(value: string, token = "browser-token") {
  const target = new URL("carrent://browser/open");
  target.searchParams.set("token", token);
  target.searchParams.set("url", new URL(value).toString());
  return target.toString();
}

function executeBrowserOpenerScript(script: string, value: string): SpawnInvocation[] {
  const invocations: SpawnInvocation[] = [];
  runInNewContext(script, {
    URL,
    process: {
      argv: ["Carrent", "carrent-browser-opener.cjs", value],
      env: {
        CARRENT_BROWSER_TOKEN: "browser-token",
        ELECTRON_RUN_AS_NODE: "1",
        SystemRoot: "C:\\Windows",
      },
      exit(code: number) {
        throw new Error(`Browser opener exited unexpectedly with code ${code}.`);
      },
    },
    require(moduleId: string) {
      if (moduleId !== "node:child_process") {
        throw new Error(`Unexpected module: ${moduleId}`);
      }
      return {
        spawn(command: string, args: string[], options: SpawnInvocation["options"]) {
          invocations.push({ command, args, options });
          return { unref() {} };
        },
      };
    },
  });
  return invocations;
}

describe("installBrowserOpener", () => {
  it("creates an executable POSIX launcher backed by the bundled runtime", () => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      const path = installBrowserOpener(directory, process.execPath, "darwin");

      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(readFileSync(path, "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a Linux launcher backed by the bundled runtime", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      const path = installBrowserOpener(directory, "/opt/Carrent/Carrent", "linux");

      expect(path).toBe(join(directory, "carrent-browser-opener"));
      expect(statSync(path).mode & 0o111).not.toBe(0);
      const launcher = readFileSync(path, "utf8");
      expect(launcher).toContain("export ELECTRON_RUN_AS_NODE=1");
      expect(launcher).toContain("exec '/opt/Carrent/Carrent'");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates a Windows launcher backed by the bundled runtime", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      const path = installBrowserOpener(
        directory,
        "C:\\Program Files\\Carrent\\Carrent.exe",
        "win32",
      );

      expect(path).toBe(join(directory, "carrent-browser-opener.cmd"));
      const launcher = readFileSync(path, "utf8");
      expect(launcher).toContain("@echo off");
      expect(launcher).toContain('set "ELECTRON_RUN_AS_NODE=1"');
      expect(launcher).toContain('"C:\\Program Files\\Carrent\\Carrent.exe"');
      expect(launcher).toContain("%*");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("opens encoded URLs on Windows without command-shell re-parsing", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      installBrowserOpener(directory, "C:\\Program Files\\Carrent\\Carrent.exe", "win32");
      const script = readFileSync(join(directory, "carrent-browser-opener.cjs"), "utf8");
      const value = "https://example.com/search?q=a%20b&next=https%3A%2F%2Fother.example";

      const [invocation] = executeBrowserOpenerScript(script, value);

      expect(invocation.command).toBe("C:\\Windows\\explorer.exe");
      expect(invocation.args).toEqual([expectedBrowserTarget(value)]);
      expect(invocation.options.env).toBeDefined();
      expect(invocation.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not pass Electron Node mode to the protocol opener", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      installBrowserOpener(directory, "/opt/Carrent/Carrent", "linux");
      const script = readFileSync(join(directory, "carrent-browser-opener.cjs"), "utf8");

      const [invocation] = executeBrowserOpenerScript(script, "https://example.com/docs");

      expect(invocation.command).toBe("xdg-open");
      expect(invocation.args).toEqual([expectedBrowserTarget("https://example.com/docs")]);
      expect(invocation.options.env).toBeDefined();
      expect(invocation.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(invocation.options.env?.CARRENT_BROWSER_TOKEN).toBe("browser-token");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
