import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseGitWorktreeList, registerGitIpc } from "./gitIpc";

describe("registerGitIpc", () => {
  it("registers git:branches and git:checkout handlers", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    expect(handlers.has("git:branches")).toBe(true);
    expect(handlers.has("git:checkout")).toBe(true);
  });

  it("rejects git:branches when projectPath is missing", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    const branchesHandler = handlers.get("git:branches")!;
    try {
      await branchesHandler({}, undefined);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Project path is required.");
    }
  });

  it("rejects git:checkout when projectPath or branch is missing", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    const checkoutHandler = handlers.get("git:checkout")!;
    try {
      await checkoutHandler({}, "/path");
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Project path and branch are required.");
    }
  });

  it("rejects checkout for a branch that is already checked out in another worktree", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-ipc-"));
    const repo = join(root, "repo");
    const worktree = join(root, "feature-worktree");

    try {
      git(root, "init", repo);
      git(repo, "config", "user.email", "test@example.com");
      git(repo, "config", "user.name", "Test User");
      writeFileSync(join(repo, "README.md"), "hello\n");
      git(repo, "add", "README.md");
      git(repo, "commit", "-m", "init");
      git(repo, "branch", "feature");
      git(repo, "worktree", "add", worktree, "feature");

      const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
      registerGitIpc({
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
      });

      const checkoutHandler = handlers.get("git:checkout")!;
      try {
        await checkoutHandler({}, repo, "feature");
        expect(false).toBe(true);
      } catch (error) {
        expect((error as Error).message).toBe(
          `Branch "feature" is already checked out at ${realpathSync.native(worktree)}.`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("parseGitWorktreeList", () => {
  it("returns branches checked out by worktrees", () => {
    expect(
      parseGitWorktreeList(`worktree /repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /tmp/feature
HEAD 2222222222222222222222222222222222222222
branch refs/heads/codex/merge-reasoning-block
`),
    ).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/tmp/feature", branch: "codex/merge-reasoning-block" },
    ]);
  });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}
