import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppProjectRecord } from "../../src/shared/workspacePersistence";
import type { WorktreeRecord, WorktreeScanResult } from "../../src/shared/worktrees";
import { parseWorktreePorcelain, pruneWorktreeRecords, scanWorktrees } from "./worktrees";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "carrent-worktrees-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function initRepo(repoDir: string, branch = "main"): void {
  git(root, "init", "-b", branch, repoDir);
  git(repoDir, "config", "user.email", "test@example.com");
  git(repoDir, "config", "user.name", "Test User");
  writeFileSync(join(repoDir, "README.md"), "hello\n");
  git(repoDir, "add", "README.md");
  git(repoDir, "commit", "-m", "init");
}

function project(id: string, name: string, workingDirectory: string): AppProjectRecord {
  return { id, name, workingDirectory };
}

function repositoryEntries(result: WorktreeScanResult) {
  return result.entries.filter((entry) => entry.kind === "repository");
}

function worktreeOf(
  result: WorktreeScanResult,
  predicate: (worktree: WorktreeRecord) => boolean,
): WorktreeRecord {
  const worktree = repositoryEntries(result)
    .flatMap((entry) => entry.worktrees)
    .find(predicate);
  if (!worktree) throw new Error("Worktree not found");
  return worktree;
}

describe("parseWorktreePorcelain", () => {
  it("parses main and linked worktrees with branches", () => {
    const parsed = parseWorktreePorcelain(`worktree /repo
HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
branch refs/heads/main

worktree /repo/linked dir
HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
branch refs/heads/codex/feature one
`);
    expect(parsed).toEqual([
      {
        path: "/repo",
        branch: "main",
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
      {
        path: "/repo/linked dir",
        branch: "codex/feature one",
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
    ]);
  });

  it("parses a detached worktree", () => {
    expect(
      parseWorktreePorcelain(`worktree /repo/detached
HEAD cccccccccccccccccccccccccccccccccccccccc
detached
`),
    ).toEqual([
      {
        path: "/repo/detached",
        branch: null,
        detached: true,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
    ]);
  });

  it("preserves a lock without a reason", () => {
    const [entry] = parseWorktreePorcelain(`worktree /repo/locked
HEAD cccccccccccccccccccccccccccccccccccccccc
branch refs/heads/feat
locked
`);
    expect(entry?.locked).toBe(true);
    expect(entry?.lockReason).toBe(null);
  });

  it("preserves a lock reason with spaces", () => {
    const [entry] = parseWorktreePorcelain(`worktree /repo/locked
HEAD cccccccccccccccccccccccccccccccccccccccc
branch refs/heads/feat
locked do not remove until release
`);
    expect(entry?.locked).toBe(true);
    expect(entry?.lockReason).toBe("do not remove until release");
  });

  it("preserves a prunable reason", () => {
    const [entry] = parseWorktreePorcelain(`worktree /repo/gone
HEAD cccccccccccccccccccccccccccccccccccccccc
branch refs/heads/old
prunable gitdir file points to non-existent location
`);
    expect(entry?.prunable).toBe(true);
    expect(entry?.prunableReason).toBe("gitdir file points to non-existent location");
  });

  it("parses a bare main worktree without HEAD or branch", () => {
    expect(
      parseWorktreePorcelain(`worktree /repo/bare.git
bare
`),
    ).toEqual([
      {
        path: "/repo/bare.git",
        branch: null,
        detached: false,
        bare: true,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      },
    ]);
  });

  it("keeps paths with spaces and unusual characters verbatim", () => {
    const [entry] = parseWorktreePorcelain(`worktree /tmp/rep o/[feat] #7
HEAD cccccccccccccccccccccccccccccccccccccccc
branch refs/heads/feat
`);
    expect(entry?.path).toBe("/tmp/rep o/[feat] #7");
  });

  it("tolerates unknown attributes and a missing trailing blank line", () => {
    const parsed = parseWorktreePorcelain(`worktree /repo
HEAD cccccccccccccccccccccccccccccccccccccccc
branch refs/heads/main
fictional value
worktree /repo/linked
HEAD dddddddddddddddddddddddddddddddddddddddd
detached`);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.detached).toBe(true);
  });
});

describe("scanWorktrees", () => {
  it("returns an empty entry list when there are no projects", async () => {
    const result = await scanWorktrees([]);
    expect(result.entries).toEqual([]);
    expect(typeof result.scannedAt).toBe("string");
  });

  it("groups a repository with only a main worktree and marks it non-removable", async () => {
    const repo = join(root, "repo");
    initRepo(repo);

    const result = await scanWorktrees([project("p1", "carrent", repo)]);
    const [entry] = repositoryEntries(result);

    expect(entry?.kind).toBe("repository");
    expect(entry?.projects).toEqual(["carrent"]);
    expect(entry?.worktrees).toHaveLength(1);
    const worktree = entry?.worktrees[0];
    expect(worktree?.kind).toBe("main");
    expect(worktree?.branch).toBe("main");
    expect(worktree?.detached).toBe(false);
    expect(worktree?.blockingReasons).toEqual(["main"]);
    expect(worktree?.cleanupCandidate).toBe(false);
  });

  it("lists a clean linked worktree as a cleanup candidate", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));

    const result = await scanWorktrees([project("p1", "carrent", repo)]);
    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");

    expect(linked.path).toBe(realpathSync(join(repo, "feat-wt")));
    expect(linked.branch).toBe("feat");
    expect(linked.detached).toBe(false);
    expect(linked.dirty).toBe(false);
    expect(linked.blockingReasons).toEqual([]);
    expect(linked.cleanupCandidate).toBe(true);
  });

  it("reports dirty state from modified and untracked files", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));

    writeFileSync(join(repo, "feat-wt", "README.md"), "changed\n");
    writeFileSync(join(repo, "feat-wt", "new-file.txt"), "untracked\n");

    const result = await scanWorktrees([project("p1", "carrent", repo)]);
    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");

    expect(linked.dirty).toBe(true);
    expect(linked.hasUntracked).toBe(true);
    expect(linked.blockingReasons).toContain("dirty");
    expect(linked.cleanupCandidate).toBe(false);
  });

  it("treats ignored-only files as clean", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
    git(repo, "add", ".gitignore");
    git(repo, "commit", "-m", "ignore node_modules");
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));
    mkdirSync(join(repo, "feat-wt", "node_modules"), { recursive: true });
    writeFileSync(join(repo, "feat-wt", "node_modules", "dep.txt"), "ignored\n");

    const result = await scanWorktrees([project("p1", "carrent", repo)]);
    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");

    expect(linked.dirty).toBe(false);
    expect(linked.cleanupCandidate).toBe(true);
  });

  it("reports detached and locked worktrees with their reasons", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "--detach", join(repo, "detached-wt"));
    git(repo, "worktree", "add", "-b", "feat", join(repo, "locked-wt"));
    git(repo, "worktree", "lock", "--reason", "do not remove", join(repo, "locked-wt"));

    const result = await scanWorktrees([project("p1", "carrent", repo)]);

    const detached = worktreeOf(result, (worktree) => worktree.detached);
    expect(detached.branch).toBe(null);
    expect(detached.blockingReasons).toContain("detached");

    const locked = worktreeOf(result, (worktree) => worktree.locked);
    expect(locked.lockReason).toBe("do not remove");
    expect(locked.blockingReasons).toContain("locked");
  });

  it("reports prunable worktrees whose directory is gone", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "old", join(repo, "gone-wt"));
    rmSync(join(repo, "gone-wt"), { recursive: true, force: true });

    const result = await scanWorktrees([project("p1", "carrent", repo)]);
    const gone = worktreeOf(result, (worktree) => worktree.prunable);

    expect(gone.prunableReason).toBe("gitdir file points to non-existent location");
    expect(gone.missing).toBe(true);
    expect(gone.cleanupCandidate).toBe(false);
  });

  it("reports a bare repository main entry without inventing a branch", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    const bareRepo = join(root, "bare.git");
    git(root, "clone", "--bare", repo, bareRepo);

    const result = await scanWorktrees([project("p1", "carrent", bareRepo)]);
    const [entry] = repositoryEntries(result);

    expect(entry?.projects).toEqual(["carrent"]);
    expect(entry?.worktrees).toHaveLength(1);
    const worktree = entry?.worktrees[0];
    expect(worktree?.kind).toBe("main");
    expect(worktree?.bare).toBe(true);
    expect(worktree?.branch).toBe(null);
    expect(worktree?.detached).toBe(false);
    expect(worktree?.blockingReasons).toEqual(["main"]);
    expect(worktree?.cleanupCandidate).toBe(false);
  });

  it("blocks linked worktrees containing submodules", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    const subRepo = join(root, "sub-repo");
    initRepo(subRepo);
    git(repo, "-c", "protocol.file.allow=always", "submodule", "add", subRepo, "sub");
    git(repo, "add", ".gitmodules", "sub");
    git(repo, "commit", "-m", "add submodule");
    git(repo, "worktree", "add", "-b", "with-sub", join(repo, "sub-wt"));

    const result = await scanWorktrees([project("p1", "carrent", repo)]);
    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");

    expect(linked.hasSubmodules).toBe(true);
    expect(linked.blockingReasons).toContain("submodules");
    expect(linked.cleanupCandidate).toBe(false);
  });

  it("deduplicates projects sharing a common directory and keeps every name", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));

    const result = await scanWorktrees([
      project("p1", "carrent", repo),
      project("p2", "carrent-feature", join(repo, "feat-wt")),
    ]);

    expect(repositoryEntries(result)).toHaveLength(1);
    const [entry] = repositoryEntries(result);
    expect(entry?.projects).toEqual(["carrent", "carrent-feature"]);

    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");
    expect(linked.projectNames).toEqual(["carrent-feature"]);
    expect(linked.blockingReasons).toContain("carrent-project");
    expect(linked.cleanupCandidate).toBe(false);
  });

  it("resolves a project pointing at a repository subdirectory", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    mkdirSync(join(repo, "apps", "desktop"), { recursive: true });

    const result = await scanWorktrees([
      project("p1", "carrent", repo),
      project("p2", "carrent-desktop", join(repo, "apps", "desktop")),
    ]);

    const [entry] = repositoryEntries(result);
    expect(entry?.projects).toEqual(["carrent", "carrent-desktop"]);
    const main = worktreeOf(result, (worktree) => worktree.kind === "main");
    expect(main.projectNames).toEqual(["carrent", "carrent-desktop"]);
  });

  it("keeps non-Git project directories visible", async () => {
    const plain = join(root, "plain dir");
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "notes.txt"), "not a repo\n");

    const result = await scanWorktrees([project("p1", "notes", plain)]);

    expect(result.entries).toEqual([
      { kind: "not-git", projectId: "p1", projectName: "notes", workingDirectory: plain },
    ]);
  });

  it("keeps unavailable project directories visible", async () => {
    const missing = join(root, "does-not-exist");

    const result = await scanWorktrees([project("p1", "gone", missing)]);

    expect(result.entries).toEqual([
      { kind: "unavailable", projectId: "p1", projectName: "gone", workingDirectory: missing },
    ]);
  });

  it("handles paths containing spaces across repositories and worktrees", async () => {
    const repo = join(root, "repo with spaces");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat worktree"));

    const result = await scanWorktrees([
      project("p1", "carrent", repo),
      project("p2", "carrent-feature", join(repo, "feat worktree")),
    ]);

    const [entry] = repositoryEntries(result);
    expect(entry?.worktrees).toHaveLength(2);
    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");
    expect(linked.path).toBe(realpathSync(join(repo, "feat worktree")));
    expect(linked.projectNames).toEqual(["carrent-feature"]);
  });
});

describe("scanWorktrees with Carrent activity", () => {
  it("blocks every linked worktree when any Project in the repository has a live Run", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));
    git(repo, "worktree", "add", "-b", "docs", join(repo, "docs-wt"));

    const result = await scanWorktrees(
      [
        project("p1", "carrent", repo),
        project("p2", "carrent-feature", join(repo, "feat-wt")),
      ],
      { liveRunProjectIds: ["p2"], runningTerminalTabs: [] },
    );

    const [entry] = repositoryEntries(result);
    expect(entry?.worktrees).toHaveLength(3);
    for (const worktree of entry?.worktrees ?? []) {
      if (worktree.kind !== "linked") continue;
      expect(worktree.liveRunProjectNames).toEqual(["carrent-feature"]);
      expect(worktree.blockingReasons).toContain("live-run");
      expect(worktree.cleanupCandidate).toBe(false);
    }
  });

  it("does not add activity reasons to the main worktree", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));

    const result = await scanWorktrees(
      [project("p1", "carrent", repo)],
      {
        liveRunProjectIds: ["p1"],
        runningTerminalTabs: [{ projectId: "p1", workingDirectory: repo }],
      },
    );

    const main = worktreeOf(result, (worktree) => worktree.kind === "main");
    expect(main.blockingReasons).toEqual(["main"]);
    expect(main.liveRunProjectNames).toEqual([]);
    expect(main.runningTerminalProjectNames).toEqual([]);
  });

  it("a live Run blocks only worktrees of its own repository", async () => {
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    initRepo(repoA);
    initRepo(repoB);
    git(repoA, "worktree", "add", "-b", "feat", join(repoA, "feat-wt"));
    git(repoB, "worktree", "add", "-b", "docs", join(repoB, "docs-wt"));

    const result = await scanWorktrees(
      [project("p1", "carrent", repoA), project("p2", "carrent-docs", repoB)],
      { liveRunProjectIds: ["p1"], runningTerminalTabs: [] },
    );

    const docsLinked = worktreeOf(result, (worktree) => worktree.path.endsWith("docs-wt"));
    expect(docsLinked.cleanupCandidate).toBe(true);
  });

  it("a running Terminal Tab blocks the linked worktree containing its Working Directory", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));
    git(repo, "worktree", "add", "-b", "docs", join(repo, "docs-wt"));

    const result = await scanWorktrees(
      [project("p1", "carrent", repo)],
      {
        liveRunProjectIds: [],
        runningTerminalTabs: [{ projectId: "p1", workingDirectory: join(repo, "feat-wt") }],
      },
    );

    const feat = worktreeOf(result, (worktree) => worktree.path.endsWith("feat-wt"));
    const docs = worktreeOf(result, (worktree) => worktree.path.endsWith("docs-wt"));
    expect(feat.runningTerminalProjectNames).toEqual(["carrent"]);
    expect(feat.blockingReasons).toContain("terminal-tab");
    expect(feat.cleanupCandidate).toBe(false);
    expect(docs.runningTerminalProjectNames).toEqual([]);
    expect(docs.blockingReasons).toEqual([]);
    expect(docs.cleanupCandidate).toBe(true);
  });

  it("a Terminal Tab in a subdirectory of a linked worktree still blocks that worktree", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));
    mkdirSync(join(repo, "feat-wt", "sub"), { recursive: true });

    const result = await scanWorktrees(
      [project("p1", "carrent", repo)],
      {
        liveRunProjectIds: [],
        runningTerminalTabs: [{ projectId: "p1", workingDirectory: join(repo, "feat-wt", "sub") }],
      },
    );

    const feat = worktreeOf(result, (worktree) => worktree.kind === "linked");
    expect(feat.blockingReasons).toContain("terminal-tab");
  });

  it("a Terminal Tab in the main worktree blocks no linked worktree", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));

    const result = await scanWorktrees(
      [project("p1", "carrent", repo)],
      {
        liveRunProjectIds: [],
        runningTerminalTabs: [{ projectId: "p1", workingDirectory: repo }],
      },
    );

    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");
    expect(linked.blockingReasons).toEqual([]);
    expect(linked.cleanupCandidate).toBe(true);
  });

  it("combines Git, Project, live Run, and Terminal Tab blockers together", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "feat", join(repo, "feat-wt"));
    writeFileSync(join(repo, "feat-wt", "README.md"), "changed\n");

    const result = await scanWorktrees(
      [
        project("p1", "carrent", repo),
        project("p2", "carrent-feature", join(repo, "feat-wt")),
      ],
      {
        liveRunProjectIds: ["p1"],
        runningTerminalTabs: [{ projectId: "p2", workingDirectory: join(repo, "feat-wt") }],
      },
    );

    const linked = worktreeOf(result, (worktree) => worktree.kind === "linked");
    expect(linked.blockingReasons).toEqual(["dirty", "carrent-project", "live-run", "terminal-tab"]);
    expect(linked.liveRunProjectNames).toEqual(["carrent"]);
    expect(linked.runningTerminalProjectNames).toEqual(["carrent-feature"]);
    expect(linked.cleanupCandidate).toBe(false);
  });
});

describe("pruneWorktreeRecords", () => {
  function commonDirectoryOf(result: WorktreeScanResult, predicate: (entry: { projects: string[] }) => boolean): string {
    const entry = repositoryEntries(result).find(
      (candidate) => predicate({ projects: candidate.projects }),
    );
    if (!entry) throw new Error("Repository not found");
    return entry.commonDirectory;
  }

  it("removes only stale records of the named repository and rescans it", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "live", join(repo, "live-wt"));
    git(repo, "worktree", "add", "-b", "old", join(repo, "gone-wt"));
    rmSync(join(repo, "gone-wt"), { recursive: true, force: true });

    const before = await scanWorktrees([project("p1", "carrent", repo)]);
    const stale = worktreeOf(before, (worktree) => worktree.prunable);
    expect(stale.prunableReason).toBe("gitdir file points to non-existent location");

    const result = await pruneWorktreeRecords(
      [project("p1", "carrent", repo)],
      commonDirectoryOf(before, (entry) => entry.projects.includes("carrent")),
    );

    const remaining = result.repository.worktrees;
    expect(remaining.some((worktree) => worktree.prunable)).toBe(false);
    expect(remaining.map((worktree) => worktree.path)).toEqual([
      realpathSync(repo),
      realpathSync(join(repo, "live-wt")),
    ]);
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain("gone-wt");
    expect(typeof result.scannedAt).toBe("string");
  });

  it("never removes an existing worktree directory or its registration", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "live", join(repo, "live-wt"));
    writeFileSync(join(repo, "live-wt", "keep.txt"), "keep\n");
    git(repo, "worktree", "add", "-b", "old", join(repo, "gone-wt"));
    rmSync(join(repo, "gone-wt"), { recursive: true, force: true });

    const before = await scanWorktrees([project("p1", "carrent", repo)]);
    await pruneWorktreeRecords(
      [project("p1", "carrent", repo)],
      commonDirectoryOf(before, () => true),
    );

    expect(execFileSync("test", ["-f", join(repo, "live-wt", "keep.txt")], { encoding: "utf8" }));
    expect(git(repo, "worktree", "list", "--porcelain")).toContain("live-wt");
  });

  it("keeps locked stale records according to Git behavior", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "kept", join(repo, "locked-wt"));
    git(repo, "worktree", "lock", "--reason", "keep record", join(repo, "locked-wt"));
    rmSync(join(repo, "locked-wt"), { recursive: true, force: true });
    git(repo, "worktree", "add", "-b", "old", join(repo, "gone-wt"));
    rmSync(join(repo, "gone-wt"), { recursive: true, force: true });

    const before = await scanWorktrees([project("p1", "carrent", repo)]);
    // Git does not flag a locked record as prunable even when its directory
    // is gone, so the preview already excludes it.
    const locked = worktreeOf(before, (worktree) => worktree.locked);
    expect(locked.prunable).toBe(false);

    const result = await pruneWorktreeRecords(
      [project("p1", "carrent", repo)],
      commonDirectoryOf(before, () => true),
    );

    const lockedAfter = result.repository.worktrees.find(
      (worktree) => worktree.path.endsWith("locked-wt"),
    );
    expect(lockedAfter).toMatchObject({ locked: true, lockReason: "keep record", missing: true });
    expect(git(repo, "worktree", "list", "--porcelain")).toContain("locked-wt");
    expect(git(repo, "worktree", "list", "--porcelain")).not.toContain("gone-wt");
  });

  it("prunes one repository without touching another repository's stale records", async () => {
    const repoA = join(root, "repo-a");
    const repoB = join(root, "repo-b");
    initRepo(repoA);
    initRepo(repoB);
    git(repoA, "worktree", "add", "-b", "old-a", join(repoA, "gone-a"));
    git(repoB, "worktree", "add", "-b", "old-b", join(repoB, "gone-b"));
    rmSync(join(repoA, "gone-a"), { recursive: true, force: true });
    rmSync(join(repoB, "gone-b"), { recursive: true, force: true });

    const before = await scanWorktrees([
      project("p1", "carrent-a", repoA),
      project("p2", "carrent-b", repoB),
    ]);
    await pruneWorktreeRecords(
      [project("p1", "carrent-a", repoA), project("p2", "carrent-b", repoB)],
      commonDirectoryOf(before, (entry) => entry.projects.includes("carrent-a")),
    );

    expect(git(repoA, "worktree", "list", "--porcelain")).not.toContain("gone-a");
    expect(git(repoB, "worktree", "list", "--porcelain")).toContain("gone-b");
  });

  it("rejects a common directory outside the current scan without touching repositories", async () => {
    const repo = join(root, "repo");
    initRepo(repo);
    git(repo, "worktree", "add", "-b", "old", join(repo, "gone-wt"));
    rmSync(join(repo, "gone-wt"), { recursive: true, force: true });

    const projects = [project("p1", "carrent", repo)];
    let thrown: unknown = null;
    try {
      await pruneWorktreeRecords(projects, join(root, "no-such-repo"));
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Error).toBe(true);
    if (thrown instanceof Error) {
      expect(thrown.message).toContain("not part of the current Worktrees scan");
    }

    expect(git(repo, "worktree", "list", "--porcelain")).toContain("gone-wt");
    const after = await scanWorktrees(projects);
    expect(worktreeOf(after, (worktree) => worktree.prunable)).toBeDefined();
  });
});

