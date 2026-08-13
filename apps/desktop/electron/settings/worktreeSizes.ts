import { lstat, readdir } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { join } from "node:path";
import type {
  WorktreeSizeEvent,
  WorktreeSizeStartResult,
  WorktreeSizeState,
  WorktreeSizeTarget,
} from "../../src/shared/worktrees";

/**
 * Measures the logical directory size of one worktree directory.
 *
 * - Regular files (tracked, ignored, hidden, nested) contribute their size;
 *   file contents are never read.
 * - The worktree's own Git control entry (the main worktree's `.git`
 *   directory or a linked worktree's `.git` file) is excluded at the root
 *   only. Nested `.git` entries are ordinary content.
 * - Symbolic links are never followed: only the link entry itself counts.
 * - Unreadable subtrees mark the measurement incomplete; an unreadable root
 *   marks it failed.
 */
export async function measureWorktreeDirectorySize(input: {
  path: string;
  signal: AbortSignal;
}): Promise<WorktreeSizeState> {
  let bytes = 0;
  let incomplete = false;

  async function walk(directory: string, isRoot: boolean): Promise<void> {
    if (input.signal.aborted) return;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      if (isRoot) throw new Error("Worktree root is not readable.");
      incomplete = true;
      return;
    }

    for (const entry of entries) {
      if (input.signal.aborted) return;
      if (isRoot && entry.name === ".git") continue;

      const fullPath = join(directory, entry.name);
      let info: Stats;
      try {
        info = await lstat(fullPath);
      } catch {
        incomplete = true;
        continue;
      }

      if (info.isSymbolicLink()) {
        // Count the link entry itself; never follow it.
        bytes += info.size;
      } else if (info.isDirectory()) {
        await walk(fullPath, false);
      } else if (info.isFile()) {
        bytes += info.size;
      }
    }
  }

  try {
    await walk(input.path, true);
  } catch {
    return { bytes: 0, incomplete: false, failed: true };
  }
  return { bytes, incomplete, failed: false };
}

/**
 * Runs cancellable, generation-guarded storage measurement across worktree
 * directories. Every start supersedes the previous run; events carry the
 * generation so a renderer can drop stale results. Worktrees are measured
 * sequentially and each completion is published with overall progress.
 */
export function createWorktreeSizeScanner(options: {
  measure: (input: { path: string; signal: AbortSignal }) => Promise<WorktreeSizeState>;
  publish: (ownerId: number, event: WorktreeSizeEvent) => void;
}) {
  let generation = 0;
  let current: { abort: AbortController } | null = null;

  return {
    start(ownerId: number, targets: WorktreeSizeTarget[]): WorktreeSizeStartResult {
      current?.abort.abort();
      generation += 1;
      const runGeneration = generation;
      const abort = new AbortController();
      current = { abort };

      void (async () => {
        let completed = 0;
        for (const target of targets) {
          if (abort.signal.aborted) return;
          const result = await options.measure({
            path: target.worktreePath,
            signal: abort.signal,
          });
          if (abort.signal.aborted) return;
          completed += 1;
          options.publish(ownerId, {
            generation: runGeneration,
            commonDirectory: target.commonDirectory,
            worktreePath: target.worktreePath,
            result,
            completed,
            total: targets.length,
          });
        }
      })();

      return { generation: runGeneration };
    },

    /** Aborts only when the given generation is the current one. */
    cancel(generationToCancel: number) {
      if (generationToCancel === generation) {
        current?.abort.abort();
      }
    },
  };
}

export type WorktreeSizeScanner = ReturnType<typeof createWorktreeSizeScanner>;
