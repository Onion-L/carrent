import { describe, expect, it } from "bun:test";
import os from "node:os";

import { ensureCliPaths } from "./processPath";

describe("ensureCliPaths", () => {
  it("prepends well-known CLI install dirs to PATH", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    ensureCliPaths("darwin", env);

    const parts = env.PATH!.split(":");
    expect(parts).toContain(`${os.homedir()}/.local/bin`);
    expect(parts).toContain("/opt/homebrew/bin");
    expect(parts.indexOf(`${os.homedir()}/.local/bin`)).toBeLessThan(parts.indexOf("/usr/bin"));
  });

  it("keeps the existing PATH entries", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/custom/bin" };

    ensureCliPaths("linux", env);

    expect(env.PATH!.endsWith("/custom/bin")).toBe(true);
  });

  it("handles a missing PATH", () => {
    const env: NodeJS.ProcessEnv = {};

    ensureCliPaths("darwin", env);

    expect(env.PATH).toContain(`${os.homedir()}/.local/bin`);
  });

  it("is a no-op on win32", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows" };

    ensureCliPaths("win32", env);

    expect(env.PATH).toBe("C:\\Windows");
  });
});
