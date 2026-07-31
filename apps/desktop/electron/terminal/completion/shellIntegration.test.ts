import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createZshShellIntegration } from "./shellIntegration";

describe("createZshShellIntegration", () => {
  it("writes temporary startup files that preserve user configuration", () => {
    const base = mkdtempSync(join(tmpdir(), "carrent-zsh-test-"));
    const integration = createZshShellIntegration({
      baseDirectory: base,
      homeDirectory: "/Users/tester",
      originalZdotdir: "/Users/tester/.config/zsh",
      token: "trusted-token",
    });
    const zshrc = readFileSync(join(integration.zdotdir, ".zshrc"), "utf8");
    expect(zshrc).toContain('source "/Users/tester/.config/zsh/.zshrc"');
    expect(zshrc).toContain("add-zle-hook-widget line-pre-redraw");
    expect(zshrc).toContain("add-zsh-hook preexec");
    integration.dispose();
    expect(() => readFileSync(join(integration.zdotdir, ".zshrc"), "utf8")).toThrow();
    rmSync(base, { recursive: true, force: true });
  });

  it("accepts authenticated bounded state across chunks and strips it from visible output", () => {
    const base = mkdtempSync(join(tmpdir(), "carrent-zsh-test-"));
    const integration = createZshShellIntegration({
      baseDirectory: base,
      homeDirectory: "/Users/tester",
      token: "trusted-token",
    });
    const state = `\u001b]633;Carrent;trusted-token;state;3;${Buffer.from("/work/carrent").toString("base64")};${Buffer.from("git").toString("base64")};${Buffer.from("/custom/bin:/usr/bin").toString("base64")};gst;mkcd\u0007`;

    expect(integration.consume(`before${state.slice(0, 25)}`)).toEqual({
      visible: "before",
      messages: [],
    });
    expect(integration.consume(`${state.slice(25)}after`)).toEqual({
      visible: "after",
      messages: [
        {
          type: "state",
          cursor: 3,
          cwd: "/work/carrent",
          commandLine: "git",
          path: "/custom/bin:/usr/bin",
          aliases: ["gst"],
          functions: ["mkcd"],
        },
      ],
    });
    integration.dispose();
    rmSync(base, { recursive: true, force: true });
  });

  it("leaves spoofed or malformed control output visible and reports executed commands", () => {
    const base = mkdtempSync(join(tmpdir(), "carrent-zsh-test-"));
    const integration = createZshShellIntegration({
      baseDirectory: base,
      homeDirectory: "/Users/tester",
      token: "trusted-token",
    });
    const spoof = "\u001b]633;Carrent;wrong;state;0;Lw==;;;\u0007";
    const command = `\u001b]633;Carrent;trusted-token;command;${Buffer.from("pnpm test").toString("base64")}\u0007`;
    expect(integration.consume(`${spoof}${command}`)).toEqual({
      visible: spoof,
      messages: [{ type: "command", command: "pnpm test" }],
    });
    integration.dispose();
    rmSync(base, { recursive: true, force: true });
  });
});
