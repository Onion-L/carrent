import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export interface GitBranchWorktree {
  branch: string;
  path: string;
}

export interface GitBranchInfo {
  current: string;
  branches: string[];
  branchWorktrees: GitBranchWorktree[];
}

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown>,
  ) => void;
}

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
