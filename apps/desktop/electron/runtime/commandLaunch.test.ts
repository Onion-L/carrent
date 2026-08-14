import { describe, expect, it } from "bun:test";

import { resolveCommandLaunch } from "./commandLaunch";

describe("resolveCommandLaunch", () => {
  it("passes commands through unchanged on POSIX platforms", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(resolveCommandLaunch("kimi", ["acp"], { platform })).toEqual({
        command: "kimi",
        args: ["acp"],
      });
    }
  });

  it("routes bare CLI names through cmd.exe on Windows", () => {
    expect(resolveCommandLaunch("kimi", ["acp"], { platform: "win32", env: {} })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "kimi", "acp"],
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
      resolveCommandLaunch("kimi", ["acp"], { platform: "win32", env: { COMSPEC: "" } }),
    ).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "kimi", "acp"],
    });
  });

  it("also routes .cmd and .bat shims through cmd.exe", () => {
    const shim = "C:\\Users\\tester\\AppData\\Roaming\\npm\\kimi.cmd";
    expect(resolveCommandLaunch(shim, ["acp"], { platform: "win32", env: {} })).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", shim, "acp"],
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
    const args = ["acp"];
    resolveCommandLaunch("kimi", args, { platform: "win32", env: {} });
    expect(args).toEqual(["acp"]);
  });
});
