import { describe, expect, it } from "bun:test";

import { resolveCommandLaunch } from "./commandLaunch";

describe("resolveCommandLaunch", () => {
  it("passes commands through unchanged on POSIX platforms", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(resolveCommandLaunch("tool", ["--check"], { platform })).toEqual({
        command: "tool",
        args: ["--check"],
      });
    }
  });

  it("routes bare CLI names through cmd.exe on Windows", () => {
    expect(resolveCommandLaunch("tool", ["--check"], { platform: "win32", env: {} })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "tool", "--check"],
    });
  });

  it("prefers COMSPEC when it points at the system cmd.exe", () => {
    expect(
      resolveCommandLaunch("rtk", ["gain"], {
        platform: "win32",
        env: { COMSPEC: "C:\\Windows\\system32\\cmd.exe" },
      }),
    ).toEqual({
      command: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", "rtk", "gain"],
    });
  });

  it("ignores an empty COMSPEC value", () => {
    expect(
      resolveCommandLaunch("tool", ["--check"], { platform: "win32", env: { COMSPEC: "" } }),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "tool", "--check"],
    });
  });

  it("also routes .cmd and .bat shims through cmd.exe", () => {
    const shim = "C:\\Users\\tester\\AppData\\Roaming\\npm\\tool.cmd";
    expect(resolveCommandLaunch(shim, ["--check"], { platform: "win32", env: {} })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", shim, "--check"],
    });
    const batch = "C:\\tools\\rtk.bat";
    expect(resolveCommandLaunch(batch, [], { platform: "win32", env: {} })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", batch],
    });
  });

  it("launches native executables directly on Windows", () => {
    const userInstall = "C:\\Users\\tester\\AppData\\Local\\Programs\\Cursor\\Cursor.exe";
    expect(resolveCommandLaunch(userInstall, ["D:\\work"], { platform: "win32", env: {} })).toEqual(
      { command: userInstall, args: ["D:\\work"] },
    );
    expect(resolveCommandLaunch("git.exe", ["status"], { platform: "win32", env: {} })).toEqual({
      command: "git.exe",
      args: ["status"],
    });
  });

  it("does not mutate the incoming args", () => {
    const args = ["--check"];
    resolveCommandLaunch("tool", args, { platform: "win32", env: {} });
    expect(args).toEqual(["--check"]);
  });
});
