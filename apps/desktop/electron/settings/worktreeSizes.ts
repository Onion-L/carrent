import { lstat, readdir } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { basename, join } from "node:path";
import type {
  WorktreeSizeEvent,
  WorktreeSizeNode,
  WorktreeSizeStartOptions,
  WorktreeSizeStartResult,
  WorktreeSizeState,
  WorktreeSizeTarget,
} from "../../src/shared/worktrees";

/** A file becomes a tree node only at or above this floor… */
const FILE_NODE_MIN_BYTES = 64 * 1024;
/** …or this fraction of the worktree total, whichever is greater. */
const FILE_NODE_MIN_FRACTION = 0.005;

/**
 * Measures the logical directory size of one worktree directory.
 *
 * - Regular files (tracked, ignored, hidden, nested) contribute their size;
 *   file contents are never read.
 * - The worktree's own Git control entry (the main worktree's `.git`
 *   directory or a linked worktree's `.git` file) is excluded at the root
 *   only. Nested `.git` entries are ordinary content.
 * - Symbolic links are never followed: only the link entry itself counts
 *   toward the byte total. Links never become tree nodes.
 * - Unreadable subtrees mark the measurement incomplete; an unreadable root
 *   marks it failed.
 *
 * The walk also builds a bounded size tree for potential drill-down views.
 * Because the file-node threshold depends on the final total, the walk first
 * records every file as a candidate node; a post-pass then prunes file nodes
 * below `max(64 KiB, 0.5% of total)`. Pruning never changes byte counts, so a
 * directory's `bytes` may exceed the sum of its children's.
 */
export async function measureWorktreeDirectorySize(input: {
  path: string;
  signal: AbortSignal;
}): Promise<WorktreeSizeState> {
  let incomplete = false;

  async function walk(
    directory: string,
    name: string,
    isRoot: boolean,
  ): Promise<WorktreeSizeNode> {
    const node: WorktreeSizeNode = { name, path: directory, bytes: 0, kind: "directory" };
    if (input.signal.aborted) return node;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      if (isRoot) throw new Error("Worktree root is not readable.");
      incomplete = true;
      return node;
    }

    const children: WorktreeSizeNode[] = [];
    for (const entry of entries) {
      if (input.signal.aborted) break;
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
        // Count the link entry itself; never follow it, never emit a node.
        node.bytes += info.size;
      } else if (info.isDirectory()) {
        const child = await walk(fullPath, entry.name, false);
        node.bytes += child.bytes;
        children.push(child);
      } else if (info.isFile()) {
        node.bytes += info.size;
        // Candidate only; pruned below the threshold once the total is known.
        children.push({ name: entry.name, path: fullPath, bytes: info.size, kind: "file" });
      }
    }
    if (children.length > 0) node.children = children;
    return node;
  }

  let root: WorktreeSizeNode;
  try {
    root = await walk(input.path, basename(input.path), true);
  } catch {
    return { bytes: 0, incomplete: false, failed: true, root: null };
  }
  const bytes = root.bytes;

  const threshold = Math.max(FILE_NODE_MIN_BYTES, FILE_NODE_MIN_FRACTION * bytes);
  function pruneFileNodes(node: WorktreeSizeNode): void {
    if (node.children === undefined) return;
    const kept = node.children.filter((child) => {
      if (child.kind === "file") return child.bytes >= threshold;
      pruneFileNodes(child);
      return true;
    });
    if (kept.length > 0) {
      node.children = kept;
    } else {
      delete node.children;
    }
  }
  pruneFileNodes(root);

  return { bytes, incomplete, failed: false, root };
}

/**
 * Runs cancellable, generation-guarded storage measurement across worktree
 * directories. Every start supersedes the previous run; events carry the
 * generation so a renderer can drop stale results. Worktrees are measured
 * sequentially and each completion is published with overall progress.
 *
 * Results are cached in memory keyed by `commonDirectory + worktreePath` for
 * {@link SIZE_CACHE_TTL_MS}; cached results republish instantly on the next
 * start, so reopening the Settings page costs nothing. Failed results are
 * never cached, and `force` bypasses the cache for explicit re-measurement.
 */
export const SIZE_CACHE_TTL_MS = 10 * 60 * 1000;

export function createWorktreeSizeScanner(options: {
  measure: (input: { path: string; signal: AbortSignal }) => Promise<WorktreeSizeState>;
  publish: (ownerId: number, event: WorktreeSizeEvent) => void;
  /** Clock injection for tests. */
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { result: WorktreeSizeState; measuredAt: number }>();
  let generation = 0;
  let current: { abort: AbortController } | null = null;

  const cacheKey = (target: WorktreeSizeTarget) =>
    `${target.commonDirectory}\n${target.worktreePath}`;

  return {
    start(
      ownerId: number,
      targets: WorktreeSizeTarget[],
      startOptions?: WorktreeSizeStartOptions,
    ): WorktreeSizeStartResult {
      current?.abort.abort();
      generation += 1;
      const runGeneration = generation;
      const abort = new AbortController();
      current = { abort };

      const force = startOptions?.force === true;
      const cached: Array<{ target: WorktreeSizeTarget; result: WorktreeSizeState }> = [];
      const pending: WorktreeSizeTarget[] = [];
      for (const target of targets) {
        const entry = cache.get(cacheKey(target));
        if (!force && entry !== undefined && now() - entry.measuredAt < SIZE_CACHE_TTL_MS) {
          cached.push({ target, result: entry.result });
        } else {
          pending.push(target);
        }
      }

      void (async () => {
        let completed = 0;
        const total = targets.length;
        for (const hit of cached) {
          if (abort.signal.aborted) return;
          completed += 1;
          options.publish(ownerId, {
            generation: runGeneration,
            commonDirectory: hit.target.commonDirectory,
            worktreePath: hit.target.worktreePath,
            result: hit.result,
            completed,
            total,
          });
        }
        for (const target of pending) {
          if (abort.signal.aborted) return;
          const result = await options.measure({
            path: target.worktreePath,
            signal: abort.signal,
          });
          if (abort.signal.aborted) return;
          if (!result.failed) {
            cache.set(cacheKey(target), { result, measuredAt: now() });
          }
          completed += 1;
          options.publish(ownerId, {
            generation: runGeneration,
            commonDirectory: target.commonDirectory,
            worktreePath: target.worktreePath,
            result,
            completed,
            total,
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
