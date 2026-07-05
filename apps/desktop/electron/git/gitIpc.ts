import { execFile } from "node:child_process";

export interface GitBranchInfo {
  current: string;
  branches: string[];
}

interface IpcMainLike {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void;
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
}

async function getBranches(cwd: string): Promise<GitBranchInfo> {
  const branches = await listBranchNames(cwd);
  const current = await getCurrentBranch(cwd);
  return { current, branches };
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

async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  const { branches } = await getBranches(cwd);
  if (!branches.includes(branch)) {
    throw new Error(`Branch "${branch}" does not exist.`);
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
