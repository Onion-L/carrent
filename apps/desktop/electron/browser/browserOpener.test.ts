import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { installBrowserOpener } from "./browserOpener";

describe("installBrowserOpener", () => {
  it("creates an executable launcher backed by the bundled runtime", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      const path = installBrowserOpener(directory, process.execPath);

      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(readFileSync(path, "utf8")).toContain("ELECTRON_RUN_AS_NODE=1");

      const result = spawnSync(path, [], { encoding: "utf8" });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("generates an xdg-open script and POSIX launcher on Linux", () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-opener-"));
    try {
      const path = installBrowserOpener(directory, "/opt/Carrent/Carrent", "linux");

      expect(path).toBe(join(directory, "carrent-browser-opener"));
      expect(statSync(path).mode & 0o111).not.toBe(0);
      const launcher = readFileSync(path, "utf8");
      expect(launcher).toContain("export ELECTRON_RUN_AS_NODE=1");
      expect(launcher).toContain("exec '/opt/Carrent/Carrent'");

      const script = readFileSync(join(directory, "carrent-browser-opener.cjs"), "utf8");
      expect(script).toContain('spawn("xdg-open"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("generates a quoted cmd.exe start handoff and batch launcher on Windows", () => {
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

      const script = readFileSync(join(directory, "carrent-browser-opener.cjs"), "utf8");
      expect(script).toContain('process.env.COMSPEC || "cmd.exe"');
      expect(script).toContain('"/d", "/s", "/c"');
      expect(script).toContain("'start \"\" \"' + target.toString() + '\"'");
      expect(script).toContain("windowsVerbatimArguments: true");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
