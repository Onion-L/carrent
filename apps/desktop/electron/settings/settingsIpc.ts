import path from "node:path";

import type { AppProjectRecord } from "../../src/shared/workspacePersistence";
import {
  EMPTY_WORKTREE_ACTIVITY,
  type WorktreeActivitySnapshot,
  type WorktreePruneRequest,
  type WorktreeRemoveRequest,
  type WorktreeSizeTarget,
} from "../../src/shared/worktrees";
import { checkForUpdates } from "./checkForUpdates";
import { getRtkGainStats } from "./rtkGain";
import { pruneWorktreeRecords, removeWorktree, scanWorktrees } from "./worktrees";
import type { WorktreeSizeScanner } from "./worktreeSizes";

import {
  readGlobalAgentInstructions,
  writeGlobalAgentInstructions,
  writeGlobalRtkInstructions,
} from "./globalAgentInstructions";
interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

function senderIdOf(event: unknown): number {
  if (typeof event !== "object" || event === null || !("sender" in event)) {
    throw new Error("Unknown settings sender.");
  }
  const sender = event.sender;
  if (typeof sender !== "object" || sender === null || !("id" in sender)) {
    throw new Error("Unknown settings sender.");
  }
  const id = sender.id;
  if (typeof id !== "number") throw new Error("Unknown settings sender.");
  return id;
}

/** Absolute in the host platform's grammar: "/work/x" and "D:\work\x" both pass on Windows. */
export function isAbsoluteWorktreePath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.isAbsolute(value);
}
/**
 * Worktree mutations (remove, prune) run one at a time across every Carrent
 * Window so a stale snapshot from one Renderer can never interleave with a
 * mutation another Renderer started. Each operation still revalidates the
 * authoritative state when its turn arrives.
 */
let worktreeMutationQueue: Promise<unknown> = Promise.resolve();

function runSerializedMutation<T>(work: () => Promise<T>): Promise<T> {
  const run = worktreeMutationQueue.then(work);
  worktreeMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function registerSettingsIpc(
  ipcMainLike: IpcMainLike,
  getAppVersion: () => string,
  getProjects: () => AppProjectRecord[],
  getWorktreeActivity?: () => WorktreeActivitySnapshot,
  sizeScanner?: WorktreeSizeScanner,
): void {
  ipcMainLike.handle("settings:app-version", async () => getAppVersion());

  ipcMainLike.handle("settings:check-for-updates", async () => checkForUpdates(getAppVersion()));

  ipcMainLike.handle("settings:rtk-gain", async () => getRtkGainStats());
  ipcMainLike.handle("settings:worktrees", async () =>
    scanWorktrees(getProjects(), getWorktreeActivity?.() ?? EMPTY_WORKTREE_ACTIVITY),
  );
  ipcMainLike.handle("settings:worktrees:prune", async (_event, request) => {
    const candidate = request as Partial<WorktreePruneRequest> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.commonDirectory !== "string" ||
      candidate.commonDirectory === ""
    ) {
      throw new Error("Worktree pruning requires the repository common directory.");
    }
    const commonDirectory = candidate.commonDirectory;
    return runSerializedMutation(() =>
      pruneWorktreeRecords(
        getProjects(),
        commonDirectory,
        getWorktreeActivity?.() ?? EMPTY_WORKTREE_ACTIVITY,
      ),
    );
  });
  ipcMainLike.handle("settings:worktrees:remove", async (_event, request) => {
    const candidate = request as Partial<WorktreeRemoveRequest> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.commonDirectory !== "string" ||
      candidate.commonDirectory === "" ||
      typeof candidate.worktreePath !== "string" ||
      candidate.worktreePath === ""
    ) {
      throw new Error(
        "Worktree removal requires the repository common directory and the worktree path.",
      );
    }
    const commonDirectory = candidate.commonDirectory;
    const worktreePath = candidate.worktreePath;
    const deleteBranch = candidate.deleteBranch === true;
    return runSerializedMutation(() =>
      removeWorktree(
        getProjects(),
        { commonDirectory, worktreePath, deleteBranch },
        getWorktreeActivity?.() ?? EMPTY_WORKTREE_ACTIVITY,
      ),
    );
  });
  ipcMainLike.handle("settings:worktrees:sizes:start", (event, targets, options) => {
    if (sizeScanner === undefined) {
      throw new Error("Worktree size measurement is not available in this window.");
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new Error("Worktree size measurement requires at least one target.");
    }
    const sanitized: WorktreeSizeTarget[] = [];
    for (const value of targets) {
      if (typeof value !== "object" || value === null) {
        throw new Error("Worktree size targets must name an absolute worktree path.");
      }
      if (
        !("commonDirectory" in value) ||
        typeof value.commonDirectory !== "string" ||
        value.commonDirectory === "" ||
        !("worktreePath" in value) ||
        typeof value.worktreePath !== "string" ||
        !isAbsoluteWorktreePath(value.worktreePath)
      ) {
        throw new Error("Worktree size targets must name an absolute worktree path.");
      }
      sanitized.push({
        commonDirectory: value.commonDirectory,
        worktreePath: value.worktreePath,
      });
    }
    const force =
      typeof options === "object" && options !== null && "force" in options
        ? options.force === true
        : false;
    return sizeScanner.start(senderIdOf(event), sanitized, { force });
  });

  ipcMainLike.handle("settings:worktrees:sizes:cancel", async (_event, generation) => {
    if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 1) {
      throw new Error("Worktree size cancellation requires a scan generation.");
    }
    sizeScanner?.cancel(generation);
  });

  ipcMainLike.handle("settings:global-agent-instructions:read", async () =>
    readGlobalAgentInstructions(),
  );

  ipcMainLike.handle("settings:global-agent-instructions:write", async (_event, content) => {
    if (typeof content !== "string") {
      throw new Error("Global agent instructions content must be a string.");
    }

    return writeGlobalAgentInstructions(content);
  });

  ipcMainLike.handle("settings:global-rtk-instructions:write", async (_event, content) => {
    if (typeof content !== "string") {
      throw new Error("Global RTK instructions content must be a string.");
    }

    return writeGlobalRtkInstructions(content);
  });
}
