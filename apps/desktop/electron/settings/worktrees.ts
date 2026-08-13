import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { AppProjectRecord } from "../../src/shared/workspacePersistence";
import { normalizeProjectWorkingDirectory } from "../../src/shared/workspacePersistence";
import {
  EMPTY_WORKTREE_ACTIVITY,
  type WorktreeActivitySnapshot,
  type WorktreeBlockingReason,
  type WorktreeRecord,
  type WorktreeRepositoryEntry,
  type WorktreeScanEntry,
  type WorktreeScanResult,
} from "../../src/shared/worktrees";

export type ParsedWorktreeEntry = {
  path: string;
  /** Branch short name; null when detached or the entry has no HEAD. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
};

/**
 * Parses `git worktree list --porcelain` (v1) output. Attribute lines belong
 * to the preceding `worktree <path>` line; blank lines separate entries.
 * Paths are taken verbatim, so spaces and unusual characters survive.
 */
export function parseWorktreePorcelain(output: string): ParsedWorktreeEntry[] {
  const entries: ParsedWorktreeEntry[] = [];
  let current: ParsedWorktreeEntry | null = null;

  const flush = () => {
    if (current !== null) entries.push(current);
    current = null;
  };

  for (const line of output.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
        prunableReason: null,
      };
      continue;
    }
    if (current === null) continue;
    if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "locked") {
      current.locked = true;
    } else if (line.startsWith("locked ")) {
      current.locked = true;
      current.lockReason = line.slice("locked ".length);
    } else if (line.startsWith("prunable ")) {
      current.prunable = true;
      current.prunableReason = line.slice("prunable ".length);
    } else if (line.startsWith("branch ")) {
      const refname = line.slice("branch ".length);
      current.branch = refname.startsWith("refs/heads/")
        ? refname.slice("refs/heads/".length)
        : refname;
    }
  }
  flush();
  return entries;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isGitNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Resolves a directory to its Git common directory, or null when the
 * directory is not inside a Git repository. `--git-common-dir` returns a
 * path relative to the working directory for subdirectories, so it is always
 * resolved against the entry point. A missing Git executable propagates as a
 * scan-level error.
 */
async function resolveGitCommonDir(cwd: string): Promise<string | null> {
  let stdout: string;
  try {
    stdout = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
  } catch (error) {
    if (isGitNotFound(error)) throw error;
    return null;
  }
  const trimmed = stdout.trim();
  return trimmed === "" ? null : path.resolve(cwd, trimmed);
}

/** Canonical identity for deduplication and containment checks. */
function resolveIdentity(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

function isSameOrAncestor(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

async function detectSubmodules(worktreePath: string): Promise<boolean> {
  const gitmodulesExists = await stat(path.join(worktreePath, ".gitmodules"))
    .then((entry) => entry.isFile())
    .catch(() => false);
  if (!gitmodulesExists) return false;
  // When Git cannot tell, assume submodules exist: over-blocking is the safe
  // direction for cleanup eligibility.
  const statusOutput = await runGit(worktreePath, ["submodule", "status"]).catch(() => null);
  return statusOutput === null || statusOutput.trim() !== "";
}

async function buildWorktreeRecord(
  entry: ParsedWorktreeEntry,
  isMain: boolean,
  projects: AppProjectRecord[],
  liveRunProjectNames: string[],
  runningTerminalTabs: WorktreeActivitySnapshot["runningTerminalTabs"],
  projectNameById: Map<string, string>,
): Promise<WorktreeRecord> {
  const worktreePath = normalizeProjectWorkingDirectory(entry.path);
  const pathIdentity = resolveIdentity(worktreePath);
  const kind = isMain ? "main" : "linked";

  const directoryStat = await stat(worktreePath).catch(() => null);
  const missing = !entry.bare && (directoryStat === null || !directoryStat.isDirectory());

  const projectNames = dedupe(
    projects
      .filter((project) =>
        isSameOrAncestor(
          pathIdentity,
          resolveIdentity(normalizeProjectWorkingDirectory(project.workingDirectory)),
        ),
      )
      .map((project) => project.name),
  );

  let dirty = false;
  let hasUntracked = false;
  if (!entry.bare && !missing && !entry.prunable) {
    const statusOutput = await runGit(worktreePath, ["status", "--porcelain=v1"]);
    hasUntracked = statusOutput.startsWith("??") || statusOutput.includes("\n??");
    dirty = statusOutput.trim() !== "";
  }

  const hasSubmodules =
    !entry.bare && !missing && !entry.prunable ? await detectSubmodules(worktreePath) : false;

  // A running Terminal Tab blocks the linked worktree whose directory contains
  // the tab's Working Directory. Main worktrees are already non-removable and
  // do not collect these reasons.
  const runningTerminalProjectNames =
    kind === "linked"
      ? dedupe(
          runningTerminalTabs
            .filter((tab) =>
              isSameOrAncestor(
                pathIdentity,
                resolveIdentity(normalizeProjectWorkingDirectory(tab.workingDirectory)),
              ),
            )
            .map((tab) => projectNameById.get(tab.projectId) ?? tab.projectId),
        )
      : [];

  const blockingReasons: WorktreeBlockingReason[] = [];
  if (isMain) {
    // The main worktree is never removable; its states are still reported.
    blockingReasons.push("main");
  } else {
    if (dirty) blockingReasons.push("dirty");
    if (entry.detached) blockingReasons.push("detached");
    if (entry.locked) blockingReasons.push("locked");
    if (hasSubmodules) blockingReasons.push("submodules");
    if (projectNames.length > 0) blockingReasons.push("carrent-project");
    if (missing) blockingReasons.push("missing");
    if (entry.prunable) blockingReasons.push("prunable");
    if (liveRunProjectNames.length > 0) blockingReasons.push("live-run");
    if (runningTerminalProjectNames.length > 0) blockingReasons.push("terminal-tab");
  }

  const cleanupCandidate = kind === "linked" && blockingReasons.length === 0;

  return {
    path: worktreePath,
    kind,
    bare: entry.bare,
    branch: entry.branch,
    detached: entry.detached,
    locked: entry.locked,
    lockReason: entry.lockReason,
    prunable: entry.prunable,
    prunableReason: entry.prunableReason,
    missing,
    dirty,
    hasUntracked,
    hasSubmodules,
    projectNames,
    liveRunProjectNames: kind === "linked" ? liveRunProjectNames : [],
    runningTerminalProjectNames,
    blockingReasons,
    cleanupCandidate,
  };
}

async function scanRepositoryWorktrees(
  projects: AppProjectRecord[],
  liveRunProjectNames: string[],
  runningTerminalTabs: WorktreeActivitySnapshot["runningTerminalTabs"],
  projectNameById: Map<string, string>,
): Promise<WorktreeRecord[]> {
  const firstWorkingDirectory = normalizeProjectWorkingDirectory(
    projects[0]?.workingDirectory ?? "",
  );
  const porcelain = await runGit(firstWorkingDirectory, ["worktree", "list", "--porcelain"]);
  const parsed = parseWorktreePorcelain(porcelain);
  const records: WorktreeRecord[] = [];
  for (const [index, entry] of parsed.entries()) {
    records.push(
      await buildWorktreeRecord(
        entry,
        index === 0,
        projects,
        liveRunProjectNames,
        runningTerminalTabs,
        projectNameById,
      ),
    );
  }
  return records;
}

/**
 * Scans every Project Working Directory for Git worktree state. Discovery is
 * limited to the given Project records; no parent-directory or disk crawling
 * happens. Unexpected Git failures throw so the Settings Tab can present a
 * single retryable error state instead of fabricating per-project labels.
 */
export async function scanWorktrees(
  projects: AppProjectRecord[],
  activity: WorktreeActivitySnapshot = EMPTY_WORKTREE_ACTIVITY,
): Promise<WorktreeScanResult> {
  const entries: WorktreeScanEntry[] = [];
  const groups = new Map<
    string,
    { projects: AppProjectRecord[]; entry: WorktreeRepositoryEntry }
  >();

  for (const project of projects) {
    const workingDirectory = normalizeProjectWorkingDirectory(project.workingDirectory);
    if (!workingDirectory) continue;

    const directoryStat = await stat(workingDirectory).catch(() => null);
    if (directoryStat === null || !directoryStat.isDirectory()) {
      entries.push({
        kind: "unavailable",
        projectId: project.id,
        projectName: project.name,
        workingDirectory,
      });
      continue;
    }

    const commonDirectory = await resolveGitCommonDir(workingDirectory);
    if (commonDirectory === null) {
      entries.push({
        kind: "not-git",
        projectId: project.id,
        projectName: project.name,
        workingDirectory,
      });
      continue;
    }

    const identity = resolveIdentity(commonDirectory);
    let group = groups.get(identity);
    if (group === undefined) {
      group = {
        projects: [],
        entry: {
          kind: "repository",
          commonDirectory: identity,
          projects: [],
          worktrees: [],
        },
      };
      groups.set(identity, group);
      entries.push(group.entry);
    }
    group.projects.push(project);
  }

  const liveRunProjectIds = new Set(activity.liveRunProjectIds);
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  for (const group of groups.values()) {
    group.entry.projects = dedupe(group.projects.map((project) => project.name));
    const liveRunProjectNames = dedupe(
      group.projects
        .filter((project) => liveRunProjectIds.has(project.id))
        .map((project) => project.name),
    );
    group.entry.worktrees = await scanRepositoryWorktrees(
      group.projects,
      liveRunProjectNames,
      activity.runningTerminalTabs,
      projectNameById,
    );
  }

  return { entries, scannedAt: new Date().toISOString() };
}
