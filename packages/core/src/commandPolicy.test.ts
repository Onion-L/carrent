import { describe, expect, it } from "bun:test";

import { classifyCommand } from "./commandPolicy";

const PROJECT = "/work/project";

describe("classifyCommand", () => {
  it("runs provable in-project commands without prompting under writable modes", () => {
    for (const mode of ["workspace-write", "full-access"] as const) {
      expect(classifyCommand("bun test", PROJECT, mode).requiresApproval).toBe(false);
      expect(classifyCommand("git status", PROJECT, mode).requiresApproval).toBe(false);
      expect(classifyCommand("cat /dev/null", PROJECT, mode).requiresApproval).toBe(false);
    }
  });

  it("prompts for every command under read-only", () => {
    expect(classifyCommand("bun test", PROJECT, "read-only").requiresApproval).toBe(true);
    expect(classifyCommand("git status", PROJECT, "read-only").requiresApproval).toBe(true);
  });

  it("prompts for commands it cannot prove safe, even under full-access", () => {
    expect(classifyCommand("echo $FOO", PROJECT, "full-access").requiresApproval).toBe(true);
    expect(classifyCommand("git log --oneline -5 2>/dev/null", PROJECT, "full-access").requiresApproval).toBe(
      true,
    );
    expect(classifyCommand("ls *.ts", PROJECT, "workspace-write").requiresApproval).toBe(true);
  });

  it("prompts for dangerous commands in every mode", () => {
    for (const mode of ["read-only", "workspace-write", "full-access"] as const) {
      expect(classifyCommand("rm -rf build", PROJECT, mode).action).toBe("dangerous");
      expect(classifyCommand("rm -rf build", PROJECT, mode).requiresApproval).toBe(true);
    }
  });

  it("lists rm as dangerous only with recursive or force flags", () => {
    expect(classifyCommand("rm -rf build", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand("rm -f build.log", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand("rm --force build.log", PROJECT, "full-access").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("rm -fr build", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand("rm build.log", PROJECT, "full-access").action).toBe("shell");
  });

  it("runs plain rm inside the project without prompting only under full-access", () => {
    expect(classifyCommand("rm build.log", PROJECT, "full-access").requiresApproval).toBe(false);
    expect(classifyCommand("rm build.log", PROJECT, "workspace-write").requiresApproval).toBe(true);
    expect(classifyCommand("rm build.log", PROJECT, "read-only").requiresApproval).toBe(true);
  });

  it("prompts for rm targeting paths outside the project in every mode", () => {
    expect(classifyCommand("rm /var/log/app.log", PROJECT, "full-access").requiresApproval).toBe(
      true,
    );
    expect(classifyCommand("rm ~/notes.txt", PROJECT, "full-access").requiresApproval).toBe(true);
  });

  it("prompts for network commands in every mode", () => {
    for (const mode of ["read-only", "workspace-write", "full-access"] as const) {
      expect(classifyCommand("curl https://example.com", PROJECT, mode).action).toBe("network");
      expect(classifyCommand("curl https://example.com", PROJECT, mode).requiresApproval).toBe(true);
    }
    expect(classifyCommand("gh pr view", PROJECT, "full-access").action).toBe("network");
    expect(classifyCommand("npx -y skills find frontend", PROJECT, "full-access").action).toBe(
      "network",
    );
    expect(classifyCommand("git push origin main", PROJECT, "full-access").action).toBe("network");
    expect(classifyCommand("bash -c 'curl https://example.com'", PROJECT, "full-access").action).toBe(
      "network",
    );
  });

  it("does not treat network keywords inside plain arguments as network", () => {
    expect(classifyCommand("echo curl", PROJECT, "full-access").action).toBe("shell");
    expect(classifyCommand("grep wget README.md", PROJECT, "full-access").requiresApproval).toBe(
      false,
    );
  });

  it("does not treat danger keywords inside plain arguments as dangerous", () => {
    expect(classifyCommand("echo rm -rf /", PROJECT, "full-access").action).toBe("shell");
    expect(classifyCommand("grep -rn kill src/", PROJECT, "full-access").action).toBe("shell");
    expect(classifyCommand("bun test kill", PROJECT, "full-access").action).toBe("shell");
    expect(classifyCommand("ls truncate.sql", PROJECT, "full-access").action).toBe("shell");
    expect(
      classifyCommand("echo rm -rf build", PROJECT, "full-access").requiresApproval,
    ).toBe(false);
  });

  it("catches danger hidden behind executable-string wrappers", () => {
    expect(classifyCommand("bash -c 'rm -rf build'", PROJECT, "full-access").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("sh -c 'rm -rf build'", PROJECT, "full-access").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("xargs rm -f", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand("sudo rm build", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand("trap 'rm -f build' EXIT", PROJECT, "full-access").action).toBe(
      "dangerous",
    );
  });

  it("catches danger behind wrapper options that take separate values", () => {
    expect(classifyCommand("xargs -n 1 rm -f", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand("env -u FOO rm -f build", PROJECT, "full-access").action).toBe(
      "dangerous",
    );
  });

  it("flags a compound command when any segment is dangerous", () => {
    expect(classifyCommand("echo hi && rm -f build", PROJECT, "full-access").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("ls | rm -f build", PROJECT, "full-access").action).toBe("dangerous");
  });

  it("treats plain rm behind wrappers like a direct plain rm", () => {
    expect(classifyCommand("xargs rm", PROJECT, "full-access").action).toBe("shell");
    expect(classifyCommand("xargs rm", PROJECT, "full-access").requiresApproval).toBe(false);
    expect(classifyCommand("xargs rm", PROJECT, "workspace-write").requiresApproval).toBe(true);
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
      expect(classifyCommand(command, PROJECT, "full-access").action).toBe("dangerous");
    }
  });

  it("fails closed on unparseable commands and wrapper nesting past the depth cap", () => {
    expect(classifyCommand("echo 'unterminated", PROJECT, "full-access").action).toBe("dangerous");
    expect(classifyCommand(`${"env ".repeat(9)}echo hi`, PROJECT, "full-access").action).toBe(
      "dangerous",
    );
  });

  it("prompts for commands referencing paths outside the project in every mode", () => {
    for (const mode of ["read-only", "workspace-write", "full-access"] as const) {
      expect(classifyCommand("cat /private/tmp/data", PROJECT, mode).requiresApproval).toBe(true);
      expect(classifyCommand("cat ../secrets.txt", PROJECT, mode).requiresApproval).toBe(true);
      expect(classifyCommand("cat ~/.ssh/config", PROJECT, mode).requiresApproval).toBe(true);
      expect(classifyCommand('cat "$HOME/.ssh/config"', PROJECT, mode).requiresApproval).toBe(true);
    }
  });

  it("falls back to the loose literal scan for network and paths when unprovable", () => {
    expect(classifyCommand("echo $FOO && curl https://example.com", PROJECT, "full-access").action).toBe(
      "network",
    );
    expect(classifyCommand("cat $SOME_DIR/file", PROJECT, "full-access").outsideProject).toBe(
      false,
    );
    expect(classifyCommand("cat $HOME/file", PROJECT, "full-access").outsideProject).toBe(true);
  });

  it("checks paths attached to flag values, not just bare arguments", () => {
    expect(classifyCommand("gcc --output=/tmp/x main.c", PROJECT, "full-access").requiresApproval).toBe(
      true,
    );
    expect(classifyCommand("gcc -o/tmp/x main.c", PROJECT, "workspace-write").requiresApproval).toBe(
      true,
    );
    expect(classifyCommand('git commit -m "hello world"', PROJECT, "full-access").requiresApproval).toBe(
      false,
    );
  });
});
