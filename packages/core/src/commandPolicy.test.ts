import { describe, expect, it } from "bun:test";

import { classifyCommand } from "./commandPolicy";

describe("classifyCommand", () => {
  it("allows ordinary project commands only in Full Project mode", () => {
    expect(classifyCommand("bun test", "/work/project", "full-project").requiresApproval).toBe(
      false,
    );
    expect(classifyCommand("bun test", "/work/project", "auto-edit").requiresApproval).toBe(true);
  });

  it("allows commands that discard output to /dev/null in Full Project mode", () => {
    expect(
      classifyCommand("git log --oneline -5 2>/dev/null", "/work/project", "full-project")
        .requiresApproval,
    ).toBe(false);
  });

  it("always requests approval for network and dangerous commands", () => {
    expect(
      classifyCommand("curl https://example.com", "/work/project", "full-project").action,
    ).toBe("network");
    expect(classifyCommand("rm -rf build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("rm build.log", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("gh pr view", "/work/project", "full-project").action).toBe("network");
    const askNpx = classifyCommand("npx -y skills find frontend", "/work/project", "ask");
    expect(askNpx.action).toBe("network");
    expect(askNpx.requiresApproval).toBe(true);
    const fullProjectNpx = classifyCommand(
      "npx -y skills find frontend",
      "/work/project",
      "full-project",
    );
    expect(fullProjectNpx.action).toBe("network");
    expect(fullProjectNpx.requiresApproval).toBe(true);
  });

  it("requests approval for absolute paths outside the project", () => {
    expect(
      classifyCommand("cat /private/tmp/data", "/work/project", "full-project").requiresApproval,
    ).toBe(true);
    expect(
      classifyCommand("cat ../secrets.txt", "/work/project", "full-project").requiresApproval,
    ).toBe(true);
    expect(
      classifyCommand("cat ~/.ssh/config", "/work/project", "full-project").requiresApproval,
    ).toBe(true);
    expect(
      classifyCommand('cat "$HOME/.ssh/config"', "/work/project", "full-project").requiresApproval,
    ).toBe(true);
  });

  it("does not treat danger keywords inside plain arguments as dangerous", () => {
    expect(classifyCommand("echo rm -rf /", "/work/project", "full-project").action).toBe("shell");
    expect(classifyCommand("grep -rn kill src/", "/work/project", "full-project").action).toBe(
      "shell",
    );
    expect(classifyCommand("bun test kill", "/work/project", "full-project").action).toBe("shell");
    expect(classifyCommand("ls truncate.sql", "/work/project", "full-project").action).toBe(
      "shell",
    );
  });

  it("catches danger hidden behind executable-string wrappers", () => {
    expect(classifyCommand("bash -c 'rm -rf build'", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("sh -c 'rm -rf build'", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("xargs rm", "/work/project", "full-project").action).toBe("dangerous");
    expect(classifyCommand("sudo rm build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("env rm build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("nohup rm build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("trap 'rm -f build' EXIT", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
  });

  it("catches danger behind wrapper options that take separate values", () => {
    expect(classifyCommand("xargs -n 1 rm", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("env -u FOO rm build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
  });

  it("flags a compound command when any segment is dangerous", () => {
    expect(classifyCommand("echo hi && rm build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("ls | rm build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
  });

  it("flags every entry of the built-in danger list", () => {
    const cases = [
      "rmdir build",
      "unlink build.log",
      "shred secrets.txt",
      "truncate -s 0 app.log",
      "dd if=/dev/zero of=/dev/disk0",
      "mkfs /dev/disk0",
      "shutdown -h now",
      "reboot",
      "diskutil eraseDisk /dev/disk0",
      "find . -name '*.log' -delete",
      "git reset --hard HEAD~1",
      "git clean -fd",
      "git checkout -- src/app.ts",
      "git restore -- .",
      "git branch -D feature",
      "git push origin main --force",
      "git push --force-with-lease",
      "chmod -R 777 .",
      "chown -R root .",
      "kill 1234",
      "killall node",
      "pkill -f vite",
    ];
    for (const command of cases) {
      expect(classifyCommand(command, "/work/project", "full-project").action).toBe("dangerous");
    }
  });

  it("fails closed on unparseable commands and wrapper nesting past the depth cap", () => {
    expect(classifyCommand("echo 'unterminated", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(
      classifyCommand(`${"env ".repeat(9)}echo hi`, "/work/project", "full-project").action,
    ).toBe("dangerous");
  });

  it("keeps commands with unprovable expansions prompting outside Full Project", () => {
    expect(classifyCommand("rm $TARGET", "/work/project", "auto-edit").requiresApproval).toBe(true);
    expect(classifyCommand("rm $TARGET", "/work/project", "ask").requiresApproval).toBe(true);
  });
});
