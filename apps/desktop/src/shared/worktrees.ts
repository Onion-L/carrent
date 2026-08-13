/**
 * Worktrees Settings Tab: shared contract between the Main-process scan and
 * the Renderer list. The scan is read-only; nothing here is persisted as a
 * setting and no removal operation exists yet.
 */

export type WorktreeKind = "main" | "linked";

/**
 * Why a worktree is not a cleanup candidate. Reported together so a user can
 * resolve every safety condition at once.
 */
export type WorktreeBlockingReason =
  | "main"
  | "dirty"
  | "detached"
  | "locked"
  | "submodules"
  | "carrent-project"
  | "missing"
  | "prunable";

export type WorktreeRecord = {
  /** Normalized full path to the worktree directory. */
  path: string;
  kind: WorktreeKind;
  /** True when this entry is the bare main worktree of a bare repository. */
  bare: boolean;
  /** Branch short name; null when detached or the entry has no HEAD. */
  branch: string | null;
  detached: boolean;
  locked: boolean;
  /** Lock reason from Git; null when locked without a reason or unlocked. */
  lockReason: string | null;
  prunable: boolean;
  /** Prunable reason from Git; null when not prunable. */
  prunableReason: string | null;
  /** The worktree directory does not exist on disk (stale admin record). */
  missing: boolean;
  /** Tracked or untracked changes; false when the directory is missing. */
  dirty: boolean;
  /** Untracked files were part of the dirty state. */
  hasUntracked: boolean;
  /** A `.gitmodules` file with at least one registered submodule. */
  hasSubmodules: boolean;
  /** Carrent Project names whose Working Directories live inside this worktree. */
  projectNames: string[];
  blockingReasons: WorktreeBlockingReason[];
  /** Advisory only in this slice; removal rechecks everything in Main. */
  cleanupCandidate: boolean;
};

export type WorktreeRepositoryEntry = {
  kind: "repository";
  /** Normalized Git common-directory identity shared by the grouped Projects. */
  commonDirectory: string;
  /** Deduplicated Carrent Project names referencing this repository. */
  projects: string[];
  worktrees: WorktreeRecord[];
};

export type WorktreeNotGitEntry = {
  kind: "not-git";
  projectId: string;
  projectName: string;
  workingDirectory: string;
};

export type WorktreeUnavailableEntry = {
  kind: "unavailable";
  projectId: string;
  projectName: string;
  workingDirectory: string;
};

export type WorktreeScanEntry =
  | WorktreeRepositoryEntry
  | WorktreeNotGitEntry
  | WorktreeUnavailableEntry;

export type WorktreeScanResult = {
  entries: WorktreeScanEntry[];
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
};
