import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseGitWorktreeList,
  registerGitIpc,
  type GitWorkspaceDiffResult,
} from "./gitIpc";

describe("registerGitIpc", () => {
  it("registers git handlers", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    expect(handlers.has("git:branches")).toBe(true);
    expect(handlers.has("git:checkout")).toBe(true);
    expect(handlers.has("git:createBranch")).toBe(true);
    expect(handlers.has("git:workspace-diff")).toBe(true);
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

  it("rejects git:createBranch when projectPath or branch is missing", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    const createBranchHandler = handlers.get("git:createBranch")!;
    try {
      await createBranchHandler({}, "/path", " ");
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Project path and branch are required.");
    }
  });

  it("rejects git:workspace-diff when projectPath is missing", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();

    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });

    const diffHandler = handlers.get("git:workspace-diff")!;
    try {
      await diffHandler({}, undefined);
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toBe("Project path is required.");
    }
  });

  it("creates and checks out a branch", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-ipc-"));
    const repo = join(root, "repo");

    try {
      git(root, "init", repo);
      git(repo, "config", "user.email", "test@example.com");
      git(repo, "config", "user.name", "Test User");
      writeFileSync(join(repo, "README.md"), "hello\n");
      git(repo, "add", "README.md");
      git(repo, "commit", "-m", "init");
      git(repo, "branch", "-M", "main");

      const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
      registerGitIpc({
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
      });

      const createBranchHandler = handlers.get("git:createBranch")!;
      const info = await createBranchHandler({}, repo, "carrent/new-branch");

      expect(info).toEqual({
        current: "carrent/new-branch",
        branches: ["carrent/new-branch", "main"],
        branchWorktrees: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
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

describe("git:workspace-diff", () => {
  function getHandlers() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    registerGitIpc({
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });
    return handlers;
  }

  async function workspaceDiff(repo: string): Promise<GitWorkspaceDiffResult> {
    const handlers = getHandlers();
    return (await handlers.get("git:workspace-diff")!({}, repo)) as GitWorkspaceDiffResult;
  }

  function initRepo(root: string, repo: string): void {
    git(root, "init", repo);
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test User");
    writeFileSync(join(repo, "README.md"), "hello\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-m", "init");
    git(repo, "branch", "-M", "main");
  }

  it("returns clean for a clean repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      const result = await workspaceDiff(repo);

      expect(result.state).toBe("clean");
      if (result.state === "clean") {
        expect(result.baseRevision.length).toBe(40);
        expect(typeof result.capturedAt).toBe("string");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("captures staged and unstaged tracked changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      writeFileSync(join(repo, "README.md"), "hello\nworld\n");
      git(repo, "add", "README.md");
      writeFileSync(join(repo, "README.md"), "hello\nworld\n!\n");

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files).toHaveLength(1);
        expect(result.files[0]).toMatchObject({
          path: "README.md",
          additions: 2,
          deletions: 0,
          binary: false,
          untracked: false,
        });
        expect(result.patch).toContain("+world");
        expect(result.patch).toContain("+!");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes non-ignored untracked text files in summary and patch", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      writeFileSync(join(repo, "new.txt"), "line one\nline two\n");

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files).toHaveLength(1);
        expect(result.files[0]).toMatchObject({
          path: "new.txt",
          additions: 2,
          deletions: 0,
          binary: false,
          untracked: true,
        });
        expect(result.patch).toContain("+line one");
        expect(result.patch).toContain("+line two");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes ignored files", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-m", "ignore");
      writeFileSync(join(repo, "ignored.txt"), "ignored content\n");

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("clean");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("represents binary files without NaN", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      writeFileSync(join(repo, ".gitattributes"), "*.png binary\n");
      git(repo, "add", ".gitattributes");
      git(repo, "commit", "-m", "attributes");
      writeFileSync(join(repo, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      git(repo, "add", "image.png");
      git(repo, "commit", "-m", "add binary");
      writeFileSync(join(repo, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files).toHaveLength(1);
        expect(result.files[0]).toMatchObject({
          path: "image.png",
          additions: 0,
          deletions: 0,
          binary: true,
          untracked: false,
        });
        expect(Number.isNaN(result.files[0].additions)).toBe(false);
        expect(Number.isNaN(result.files[0].deletions)).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles filenames containing spaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      writeFileSync(join(repo, "file with spaces.txt"), "content\n");

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files).toHaveLength(1);
        expect(result.files[0].path).toBe("file with spaces.txt");
        expect(result.patch).toContain("file with spaces.txt");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns unavailable/not-git for a non-Git directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const notRepo = join(root, "not-repo");

    try {
      mkdirSync(notRepo, { recursive: true });
      const result = await workspaceDiff(notRepo);

      expect(result).toEqual({ state: "unavailable", reason: "not-git" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns unavailable/no-head for a repository without a commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      git(root, "init", repo);
      writeFileSync(join(repo, "orphan.txt"), "orphan\n");

      const result = await workspaceDiff(repo);

      expect(result).toEqual({ state: "unavailable", reason: "no-head" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets truncated when file and patch limits are exceeded without modifying the index", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      for (let i = 0; i < 210; i++) {
        writeFileSync(join(repo, `file-${i}.txt`), `content ${i}\n`);
      }

      const statusBefore = execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: repo,
        encoding: "utf8",
      });

      const result = await workspaceDiff(repo);

      const statusAfter = execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files.length <= 200).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.patch).toContain("[diff truncated by Carrent]");
        expect(Buffer.byteLength(result.patch, "utf8") <= 256 * 1024).toBe(true);
      }
      expect(statusAfter).toBe(statusBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a bounded truncated snapshot for a large tracked diff", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      const largeText = Array.from({ length: 40_000 }, (_, index) => `changed line ${index}`).join(
        "\n",
      );
      writeFileSync(join(repo, "README.md"), `${largeText}\n`);

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.truncated).toBe(true);
        expect(result.patch).toContain("[diff truncated by Carrent]");
        expect(Buffer.byteLength(result.patch, "utf8") <= 256 * 1024).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits an oversized untracked file without reading it into the patch", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      writeFileSync(join(repo, "large.txt"), Buffer.alloc(256 * 1024 + 1, 0x61));

      const result = await workspaceDiff(repo);

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files).toEqual([
          {
            path: "large.txt",
            additions: 0,
            deletions: 0,
            binary: false,
            untracked: true,
            omitted: true,
          },
        ]);
        expect(result.patch).toBe("\n\n[diff truncated by Carrent]\n");
        expect(result.truncated).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("caps tracked file summaries without modifying the index", async () => {
    const root = mkdtempSync(join(tmpdir(), "carrent-git-diff-"));
    const repo = join(root, "repo");

    try {
      initRepo(root, repo);
      for (let i = 0; i < 205; i++) {
        writeFileSync(join(repo, `tracked-${i}.txt`), "before\n");
      }
      git(repo, "add", ".");
      git(repo, "commit", "-m", "add tracked files");
      for (let i = 0; i < 205; i++) {
        writeFileSync(join(repo, `tracked-${i}.txt`), "after\n");
      }

      const statusBefore = execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: repo,
        encoding: "utf8",
      });
      const result = await workspaceDiff(repo);
      const statusAfter = execFileSync("git", ["status", "--porcelain=v1"], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(result.state).toBe("ready");
      if (result.state === "ready") {
        expect(result.files).toHaveLength(200);
        expect(result.truncated).toBe(true);
      }
      expect(statusAfter).toBe(statusBefore);
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
