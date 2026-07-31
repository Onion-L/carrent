import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { createZshShellIntegration } from "./shellIntegration";

describe("zsh Shell Integration process", () => {
  it("preserves user configuration, reports trusted prompt state, and keeps native input usable", async () => {
    if (!existsSync("/bin/zsh") || !existsSync("/usr/bin/expect")) return;
    const home = mkdtempSync(join(tmpdir(), "carrent-zsh-home-"));
    writeFileSync(join(home, ".zshrc"), "export CARRENT_ZSH_TEST=loaded\nPS1='test> '\n");
    const integration = createZshShellIntegration({
      baseDirectory: tmpdir(),
      homeDirectory: home,
      token: "process-token",
    });
    const expectScript = String.raw`
set timeout 5
spawn /bin/zsh -l -i
after 300
send -- "g"
after 200
send -- "\025"
send -- "printf '__CARRRENT_MARKER__%s\\n' \"\$CARRENT_ZSH_TEST\"\r"
expect "__CARRRENT_MARKER__loaded"
send -- "exit\r"
expect eof
`;
    const shell = spawn("/usr/bin/expect", ["-c", expectScript], {
      cwd: home,
      env: { ...globalThis.process.env, HOME: home, ZDOTDIR: integration.zdotdir },
    });

    let visible = "";
    const messages: unknown[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("zsh integration timed out")), 5_000);
      const consume = (data: Buffer) => {
        const consumed = integration.consume(data.toString("utf8"));
        visible += consumed.visible;
        messages.push(...consumed.messages);
      };
      shell.stdout.on("data", consume);
      shell.stderr.on("data", consume);
      shell.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    try {
      await completed;
      expect(visible).toContain("__CARRRENT_MARKER__loaded");
      expect(messages.some((message) => (message as { type?: string }).type === "state")).toBe(
        true,
      );
      expect(messages.some((message) => (message as { type?: string }).type === "command")).toBe(
        true,
      );
    } finally {
      try {
        shell.kill();
      } catch {
        // The shell normally exits itself.
      }
      integration.dispose();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
