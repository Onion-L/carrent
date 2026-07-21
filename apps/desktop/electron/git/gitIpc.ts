import { execFile } from "node:child_process";
import { lstatSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";

export interface GitBranchWorktree {
  branch: string;
  path: string;
}

export interface GitBranchInfo {
  current: string;
  branches: string[];
  branchWorktrees: GitBranchWorktree[];
}

export type GitWorkspaceDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  omitted?: boolean;
};

export type GitWorkspaceDiffResult =
  | {
      state: "ready";
      baseRevision: string;
      capturedAt: string;
      files: GitWorkspaceDiffFile[];
      patch: string;
      truncated: boolean;
    }
  | {
      state: "clean";
      baseRevision: string;
      capturedAt: string;
    }
  | {
      state: "unavailable";
      reason: "not-git" | "no-head";
    };

export type GitWorkspaceSnapshotResult =
  | {
      state: "ready";
      baseRevision: string;
    }
  | {
      state: "unavailable";
      reason: "not-git" | "no-head";
    };

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown>,
  ) => void;
}

const MAX_SUMMARY_FILES = 200;
const MAX_UNTRACKED_PATCHES = 100;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_DIFF_BUFFER_BYTES = 2 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const TRUNCATION_MARKER = "\n\n[diff truncated by Carrent]\n";

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function registerGitIpc(ipcMainLike: IpcMainLike): void {
  ipcMainLike.handle("git:branches", async (_event, projectPath) => {
    const path = readString(projectPath);
    if (!path) {
      throw new Error("Project path is required.");
    }
    return getBranches(path);
  });

  ipcMainLike.handle("git:checkout", async (_event, projectPath, branch) => {
    const path = readString(projectPath);
    const branchName = readString(branch);
    if (!path || !branchName) {
      throw new Error("Project path and branch are required.");
    }
    await checkoutBranch(path, branchName);
    return getBranches(path);
  });

  ipcMainLike.handle("git:createBranch", async (_event, projectPath, branch) => {
    const path = readString(projectPath);
    const branchName = readString(branch)?.trim();
    if (!path || !branchName) {
      throw new Error("Project path and branch are required.");
    }
    await createBranch(path, branchName);
    return getBranches(path);
  });

  ipcMainLike.handle("git:workspace-snapshot", async (_event, projectPath) => {
    const path = readString(projectPath);
    if (!path) {
      throw new Error("Project path is required.");
    }
    return captureWorkspaceSnapshot(path);
  });

  ipcMainLike.handle("git:workspace-diff", async (_event, projectPath, baseRevision) => {
    const path = readString(projectPath);
    if (!path) {
      throw new Error("Project path is required.");
    }
    return getWorkspaceDiff(path, readString(baseRevision));
  });
}

async function getBranches(cwd: string): Promise<GitBranchInfo> {
  const branches = await listBranchNames(cwd);
  const current = await getCurrentBranch(cwd);
  const branchWorktrees = (await listBranchWorktrees(cwd)).filter(
    (worktree) => !isSamePath(worktree.path, cwd),
  );
  return { current, branches, branchWorktrees };
}

function listBranchNames(cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile("git", ["branch", "--format=%(refname:short)"], { cwd }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(
        stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      );
    });
  });
}

function getCurrentBranch(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function listBranchWorktrees(cwd: string): Promise<GitBranchWorktree[]> {
  return new Promise((resolveList, reject) => {
    execFile("git", ["worktree", "list", "--porcelain"], { cwd }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolveList(parseGitWorktreeList(stdout));
    });
  });
}

export function parseGitWorktreeList(output: string): GitBranchWorktree[] {
  const worktrees: GitBranchWorktree[] = [];
  let currentPath: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("branch refs/heads/") && currentPath) {
      worktrees.push({
        path: currentPath,
        branch: line.slice("branch refs/heads/".length),
      });
    }
  }

  return worktrees;
}

function isSamePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  const { branches, branchWorktrees } = await getBranches(cwd);
  if (!branches.includes(branch)) {
    throw new Error(`Branch "${branch}" does not exist.`);
  }

  const occupiedWorktree = branchWorktrees.find((worktree) => worktree.branch === branch);
  if (occupiedWorktree) {
    throw new Error(`Branch "${branch}" is already checked out at ${occupiedWorktree.path}.`);
  }

  return new Promise((resolve, reject) => {
    execFile("git", ["checkout", branch], { cwd }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function createBranch(cwd: string, branch: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("git", ["checkout", "-b", branch], { cwd }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function runGit(
  cwd: string,
  args: string[],
  options: { maxBuffer?: number; timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        env: options.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function runGitDiff(
  cwd: string,
  args: string[],
  options: { maxBuffer?: number; timeout?: number } = {},
): Promise<{ stdout: Buffer; stderr: Buffer; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "buffer", timeout: options.timeout, maxBuffer: options.maxBuffer },
      (error, stdout, stderr) => {
        const code = (error?.code ?? 0) as number;
        if (error && code !== 1) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr, code });
      },
    );
  });
}

function runGitPatch(
  cwd: string,
  args: string[],
): Promise<{ stdout: Buffer; code: number; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "buffer",
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_PATCH_BYTES,
      },
      (error, stdout) => {
        const maxBufferExceeded = error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        const code = typeof error?.code === "number" ? error.code : 0;
        if (error && !maxBufferExceeded && code !== 1) {
          reject(error);
          return;
        }
        resolve({ stdout, code, truncated: maxBufferExceeded });
      },
    );
  });
}

// Hashes the current worktree (tracked changes + non-ignored untracked
// files) into a tree object, using a throwaway index so the user's real
// index, refs, and worktree are never touched.
async function snapshotWorktreeTree(repoRoot: string, pathspec: string): Promise<string> {
  const indexPath = join(
    tmpdir(),
    `carrent-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };

  try {
    await runGit(repoRoot, ["read-tree", "HEAD"], { env, timeout: GIT_TIMEOUT_MS });
    await runGit(repoRoot, ["add", "-A", "--", pathspec], { env, timeout: GIT_TIMEOUT_MS });
    const { stdout } = await runGit(repoRoot, ["write-tree"], {
      env,
      timeout: GIT_TIMEOUT_MS,
    });
    return stdout.toString("utf8").trim();
  } finally {
    rmSync(indexPath, { force: true });
    rmSync(`${indexPath}.lock`, { force: true });
  }
}

// Captures the current worktree as a dangling commit. A later diff against
// the returned revision shows only what changed after this snapshot.
async function captureWorkspaceSnapshot(projectPath: string): Promise<GitWorkspaceSnapshotResult> {
  const repoRoot = await resolveRepoRoot(projectPath);
  if (!repoRoot) {
    return { state: "unavailable", reason: "not-git" };
  }

  const head = await resolveHead(repoRoot);
  if (!head) {
    return { state: "unavailable", reason: "no-head" };
  }

  const pathspec = getRepoRelativePathspec(repoRoot, projectPath);
  const tree = await snapshotWorktreeTree(repoRoot, pathspec);
  const { stdout: commitOut } = await runGit(
    repoRoot,
    // Explicit ident: commit-tree fails on machines without a configured
    // user.name/user.email, which would silently disable per-run diffs.
    [
      "-c",
      "user.name=Carrent",
      "-c",
      "user.email=carrent@localhost",
      "commit-tree",
      tree,
      "-p",
      head,
      "-m",
      "Carrent workspace baseline",
    ],
    { timeout: GIT_TIMEOUT_MS },
  );
  return { state: "ready", baseRevision: commitOut.toString("utf8").trim() };
}

// Diffs the baseline snapshot against a fresh worktree snapshot. Comparing
// two trees (instead of a commit against the live worktree) is the only way
// untracked files participate: `git diff <commit>` treats every
// untracked-but-snapshotted file as deleted.
async function getWorkspaceDiffSinceSnapshot(
  repoRoot: string,
  pathspec: string,
  base: string,
  capturedAt: string,
): Promise<GitWorkspaceDiffResult> {
  const nowTree = await snapshotWorktreeTree(repoRoot, pathspec);

  const [summary, patchResult, headTreeResult] = await Promise.all([
    runGitDiff(
      repoRoot,
      [
        "diff",
        "--numstat",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        base,
        nowTree,
        "--",
        pathspec,
      ],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_DIFF_BUFFER_BYTES },
    ),
    runGitPatch(repoRoot, [
      "diff",
      "--no-color",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      base,
      nowTree,
      "--",
      pathspec,
    ]),
    runGit(repoRoot, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", pathspec], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_DIFF_BUFFER_BYTES,
    }),
  ]);

  const headPaths = new Set(parseNullSeparatedPaths(headTreeResult.stdout));
  const allFiles = parseNumstatZ(summary.stdout);

  if (allFiles.length === 0) {
    return { state: "clean", baseRevision: base, capturedAt };
  }

  const files: GitWorkspaceDiffFile[] = allFiles.slice(0, MAX_SUMMARY_FILES).map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    untracked: !headPaths.has(file.path),
  }));
  files.sort((a, b) => a.path.localeCompare(b.path));

  const truncated = allFiles.length > MAX_SUMMARY_FILES || patchResult.truncated;
  return {
    state: "ready",
    baseRevision: base,
    capturedAt,
    files,
    patch: formatBoundedPatch(patchResult.stdout, truncated),
    truncated,
  };
}

async function getWorkspaceDiff(
  projectPath: string,
  baseRevision?: string | null,
): Promise<GitWorkspaceDiffResult> {
  const repoRoot = await resolveRepoRoot(projectPath);
  if (!repoRoot) {
    return { state: "unavailable", reason: "not-git" };
  }

  const head = await resolveHead(repoRoot);
  if (!head) {
    return { state: "unavailable", reason: "no-head" };
  }

  const pathspec = getRepoRelativePathspec(repoRoot, projectPath);
  const capturedAt = new Date().toISOString();

  if (baseRevision) {
    // The renderer passes a commit-tree sha; reject anything else so a
    // crafted value can't inject git options ahead of `--`.
    if (!/^[0-9a-f]{40}$/i.test(baseRevision)) {
      throw new Error("Invalid base revision.");
    }
    return getWorkspaceDiffSinceSnapshot(repoRoot, pathspec, baseRevision, capturedAt);
  }

  const [trackedSummary, trackedPatchResult, untrackedResult] = await Promise.all([
    runGitDiff(
      repoRoot,
      [
        "diff",
        "--numstat",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        "HEAD",
        "--",
        pathspec,
      ],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_DIFF_BUFFER_BYTES },
    ),
    runGitPatch(
      repoRoot,
      [
        "diff",
        "--no-color",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=3",
        "HEAD",
        "--",
        pathspec,
      ],
    ),
    runGit(
      repoRoot,
      ["ls-files", "--others", "--exclude-standard", "-z", "--", pathspec],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_DIFF_BUFFER_BYTES },
    ),
  ]);

  const trackedFiles = parseNumstatZ(trackedSummary.stdout);
  const untrackedPaths = parseNullSeparatedPaths(untrackedResult.stdout);

  const files: GitWorkspaceDiffFile[] = trackedFiles.slice(0, MAX_SUMMARY_FILES).map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    untracked: false,
  }));

  let untrackedPatchBuffer = Buffer.alloc(0);
  let untrackedCount = 0;
  let truncated = trackedFiles.length > MAX_SUMMARY_FILES || trackedPatchResult.truncated;
  let patchFull = trackedPatchResult.truncated || trackedPatchResult.stdout.length >= MAX_PATCH_BYTES;

  for (const untrackedPath of untrackedPaths) {
    if (files.length >= MAX_SUMMARY_FILES) {
      truncated = true;
      break;
    }

    if (patchFull) {
      files.push({
        path: untrackedPath,
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      });
      truncated = true;
      continue;
    }

    const stat = safeLstat(resolve(repoRoot, untrackedPath));
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      files.push({
        path: untrackedPath,
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      });
      truncated = true;
      continue;
    }

    if (stat.size > MAX_PATCH_BYTES) {
      files.push({
        path: untrackedPath,
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      });
      truncated = true;
      continue;
    }

    if (untrackedCount >= MAX_UNTRACKED_PATCHES) {
      files.push({
        path: untrackedPath,
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      });
      truncated = true;
      continue;
    }

    try {
      const [patchResult, numstatResult] = await Promise.all([
        runGitPatch(
          repoRoot,
          [
            "diff",
            "--no-index",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=3",
            "--",
            "/dev/null",
            untrackedPath,
          ],
        ),
        runGitDiff(
          repoRoot,
          [
            "diff",
            "--no-index",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--numstat",
            "-z",
            "--",
            "/dev/null",
            untrackedPath,
          ],
          { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_DIFF_BUFFER_BYTES },
        ),
      ]);

      if (patchResult.code !== 1 && !patchResult.truncated) {
        files.push({
          path: untrackedPath,
          additions: 0,
          deletions: 0,
          binary: false,
          untracked: true,
          omitted: true,
        });
        truncated = true;
        continue;
      }

      const numstat = parseNumstatZ(numstatResult.stdout)[0];
      const fileEntry: GitWorkspaceDiffFile = {
        path: untrackedPath,
        additions: numstat?.additions ?? 0,
        deletions: numstat?.deletions ?? 0,
        binary: numstat?.binary ?? false,
        untracked: true,
      };

      if (patchResult.truncated) {
        fileEntry.omitted = true;
        files.push(fileEntry);
        truncated = true;
        continue;
      }

      files.push(fileEntry);
      untrackedCount++;

      const patchBytes = patchResult.stdout;
      if (untrackedPatchBuffer.length + patchBytes.length > MAX_PATCH_BYTES) {
        const remaining = MAX_PATCH_BYTES - untrackedPatchBuffer.length;
        if (remaining > 0) {
          untrackedPatchBuffer = Buffer.concat([untrackedPatchBuffer, patchBytes.subarray(0, remaining)]);
        }
        patchFull = true;
        truncated = true;
        continue;
      }

      untrackedPatchBuffer = Buffer.concat([untrackedPatchBuffer, patchBytes]);
    } catch {
      files.push({
        path: untrackedPath,
        additions: 0,
        deletions: 0,
        binary: false,
        untracked: true,
        omitted: true,
      });
      truncated = true;
    }
  }

  const combinedPatch = Buffer.concat([trackedPatchResult.stdout, untrackedPatchBuffer]);
  if (combinedPatch.length > MAX_PATCH_BYTES) {
    truncated = true;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  if (files.length === 0) {
    return { state: "clean", baseRevision: head, capturedAt };
  }

  const patchText = formatBoundedPatch(combinedPatch, truncated);

  return {
    state: "ready",
    baseRevision: head,
    capturedAt,
    files,
    patch: patchText,
    truncated,
  };
}

function formatBoundedPatch(patch: Buffer, truncated: boolean): string {
  if (!truncated && patch.length <= MAX_PATCH_BYTES) {
    return patch.toString("utf8");
  }

  const marker = Buffer.from(TRUNCATION_MARKER, "utf8");
  // Leave room for one UTF-8 replacement character if the byte slice ends
  // inside a multibyte code point.
  const contentLimit = Math.max(0, MAX_PATCH_BYTES - marker.length - 3);
  return Buffer.concat([patch.subarray(0, contentLimit), marker]).toString("utf8");
}

async function resolveRepoRoot(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(
      projectPath,
      ["rev-parse", "--show-toplevel"],
      { timeout: GIT_TIMEOUT_MS },
    );
    return stdout.toString("utf8").trim();
  } catch {
    return null;
  }
}

async function resolveHead(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(
      repoRoot,
      ["rev-parse", "--verify", "HEAD"],
      { timeout: GIT_TIMEOUT_MS },
    );
    return stdout.toString("utf8").trim();
  } catch {
    return null;
  }
}

function getRepoRelativePathspec(repoRoot: string, projectPath: string): string {
  const resolvedRoot = normalizePath(repoRoot);
  const resolvedProject = normalizePath(projectPath);
  if (resolvedProject === resolvedRoot) {
    return ".";
  }
  const relativePath = relative(resolvedRoot, resolvedProject);
  return relativePath || ".";
}

function parseNumstatZ(buffer: Buffer): Array<{
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}> {
  const text = buffer.toString("utf8");
  const entries: Array<{ path: string; additions: number; deletions: number; binary: boolean }> = [];
  const records = text.split("\0");

  for (const record of records) {
    if (!record) {
      continue;
    }
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) {
      continue;
    }
    const additions = record.slice(0, firstTab);
    const deletions = record.slice(firstTab + 1, secondTab);
    const filePath = record.slice(secondTab + 1);
    if (additions === "-" && deletions === "-") {
      entries.push({ path: filePath, additions: 0, deletions: 0, binary: true });
    } else {
      const a = parseInt(additions, 10);
      const d = parseInt(deletions, 10);
      entries.push({
        path: filePath,
        additions: Number.isNaN(a) ? 0 : a,
        deletions: Number.isNaN(d) ? 0 : d,
        binary: false,
      });
    }
  }

  return entries;
}

function parseNullSeparatedPaths(buffer: Buffer): string[] {
  const text = buffer.toString("utf8");
  return text.split("\0").filter((entry) => entry.length > 0);
}

function safeLstat(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
