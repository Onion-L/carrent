/**
 * Worktrees Settings Tab: shared contract between the Main-process scan and
 * the Renderer list. Scan output is never persisted as a setting. Mutating
 * operations (remove, prune) revalidate everything in Main before touching
 * the filesystem.
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
  | "prunable"
  | "live-run"
  | "terminal-tab";
/**
 * User-presentable labels for every blocking reason. Shared between the
 * Renderer list and Main-process refusal messages so both sides use the
 * same copy.
 */
export const WORKTREE_BLOCKING_REASON_LABELS: Record<WorktreeBlockingReason, string> = {
  main: "Main worktree",
  dirty: "Uncommitted changes",
  detached: "Detached HEAD",
  locked: "Locked by Git",
  submodules: "Contains submodules",
  "carrent-project": "Referenced by a Carrent Project",
  missing: "Directory missing",
  prunable: "Prunable Git record",
  "live-run": "Live Run in repository",
  "terminal-tab": "Running Terminal Tab",
};

/**
 * Carrent-owned activity considered by the worktree scan. Both sources are
 * snapshots of Main Process authority state at scan time; nothing here is
 * persisted.
 */
export type WorktreeActivitySnapshot = {
  /** Project IDs with a live Run (starting, running, or waiting). */
  liveRunProjectIds: string[];
  /** Running Terminal Tabs and the Working Directory each one was started in. */
  runningTerminalTabs: Array<{ projectId: string; workingDirectory: string }>;
};

export const EMPTY_WORKTREE_ACTIVITY: WorktreeActivitySnapshot = {
  liveRunProjectIds: [],
  runningTerminalTabs: [],
};

export type WorktreeRecord = {
  /** Normalized full path to the worktree directory. */
  path: string;
  kind: WorktreeKind;
  /** True when this entry is the bare main worktree of a bare repository. */
  bare: boolean;
  /** Branch short name; null when detached or the entry has no HEAD. */
  branch: string | null;
  /**
   * The branch is a local branch (`refs/heads/*`) that `git branch -d` may
   * consider. False for detached worktrees and non-local branch identities;
   * decided by the porcelain parser, never by the branch name itself.
   */
  branchLocal: boolean;
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
  /**
   * Carrent Project names with a live Run in this repository. Blocks every
   * linked worktree of the repository; empty for the main worktree.
   */
  liveRunProjectNames: string[];
  /**
   * Carrent Project names with a running Terminal Tab in this worktree
   * directory. Empty for the main worktree.
   */
  runningTerminalProjectNames: string[];
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

/**
 * Removes stale Git worktree administration records for one repository.
 * The renderer names the repository by the normalized common-directory
 * identity it received from the scan; Main re-resolves and re-scans so a
 * stale or foreign path can never authorize a prune.
 */
export type WorktreePruneRequest = {
  commonDirectory: string;
};

export type WorktreePruneResult = {
  /** Rescanned repository; stale records no longer appear. */
  repository: WorktreeRepositoryEntry;
  /** ISO timestamp of when the post-prune rescan completed. */
  scannedAt: string;
};
/**
 * Removes one eligible linked worktree. The renderer names the target by the
 * normalized identities it received from the scan; Main re-resolves and
 * re-evaluates every safety condition immediately before mutating so a stale
 * renderer snapshot can never authorize a removal.
 */
export type WorktreeRemoveRequest = {
  /** Repository identity the worktree belongs to. */
  commonDirectory: string;
  /** Normalized full path of the linked worktree to remove. */
  worktreePath: string;
  /**
   * Opt-in local branch deletion after the worktree is removed. Defaults to
   * false (branch preserved); only non-forcing `git branch -d` is used.
   */
  deleteBranch?: boolean;
};

export type WorktreeRemoveResult = {
  /**
   * `removed` — the worktree is gone and the branch state is final.
   * `removed-branch-retained` — the worktree is gone but Git refused to
   * delete the branch; {@link branchRetainedReason} explains why. Carrent
   * never attempts to restore a removed worktree in this case.
   */
  status: "removed" | "removed-branch-retained";
  /** Rescanned repository; the removed worktree no longer appears. */
  repository: WorktreeRepositoryEntry;
  /** ISO timestamp of when the post-removal rescan completed. */
  scannedAt: string;
  /** User-presentable reason Git refused the branch deletion. */
  branchRetainedReason?: string;
};

/**
 * One node of the per-worktree size tree used by the sunburst chart.
 * Directories recurse fully; a file only becomes a node when its size is at
 * least the greater of 64 KiB and 0.5% of the worktree total, so the tree
 * stays bounded for dependency-heavy worktrees. Bytes of pruned small files
 * still count toward every ancestor's `bytes`, so a parent's `bytes` may
 * exceed the sum of its children's.
 */
export type WorktreeSizeNode = {
  /** Entry name within its parent directory. */
  name: string;
  /** Normalized full path. */
  path: string;
  bytes: number;
  kind: "directory" | "file";
  children?: WorktreeSizeNode[];
};

/**
 * Storage measurement for one worktree directory. Bytes are logical
 * directory size (an estimate, not guaranteed filesystem blocks) and stay
 * valid as a lower bound when the traversal was incomplete.
 */
export type WorktreeSizeState = {
  bytes: number;
  /** Some entries were unreadable; the total is a lower bound. */
  incomplete: boolean;
  /** The worktree root could not be traversed at all. */
  failed: boolean;
  /**
   * Directory/file size tree for the sunburst chart; null when the
   * measurement failed or was cancelled before the root was read. Root bytes
   * equal {@link bytes}.
   */
  root: WorktreeSizeNode | null;
};

export type WorktreeSizeTarget = {
  /** Repository identity the worktree belongs to. */
  commonDirectory: string;
  /** Normalized full path of the worktree directory to measure. */
  worktreePath: string;
};

export type WorktreeSizeStartOptions = {
  /** Bypass the scanner's result cache and re-measure every target. */
  force?: boolean;
};

export type WorktreeSizeStartResult = {
  /** Monotonic generation; events carry it so stale results are dropped. */
  generation: number;
};

export type WorktreeSizeEvent = {
  generation: number;
  commonDirectory: string;
  worktreePath: string;
  result: WorktreeSizeState;
  /** Worktrees measured so far in this generation. */
  completed: number;
  /** Worktrees scheduled in this generation. */
  total: number;
};
