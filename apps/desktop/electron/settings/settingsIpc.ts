import type { AppProjectRecord } from "../../src/shared/workspacePersistence";
import {
  EMPTY_WORKTREE_ACTIVITY,
  type WorktreeActivitySnapshot,
  type WorktreePruneRequest,
  type WorktreeSizeTarget,
} from "../../src/shared/worktrees";
import { getKimiUsageStats } from "./kimiUsage";
import { deleteKimiMemoryFile, listKimiMemory } from "./kimiMemory";
import { getRtkGainStats } from "./rtkGain";
import { scanWorktrees, pruneWorktreeRecords } from "./worktrees";
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

export function registerSettingsIpc(
  ipcMainLike: IpcMainLike,
  getAppVersion: () => string,
  getProjects: () => AppProjectRecord[],
  getWorktreeActivity?: () => WorktreeActivitySnapshot,
  sizeScanner?: WorktreeSizeScanner,
): void {
  ipcMainLike.handle("settings:app-version", async () => getAppVersion());

  ipcMainLike.handle("settings:check-for-updates", async () => {
    return { hasUpdate: false };
  });

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
    return pruneWorktreeRecords(
      getProjects(),
      candidate.commonDirectory,
      getWorktreeActivity?.() ?? EMPTY_WORKTREE_ACTIVITY,
    );
  });
  ipcMainLike.handle("settings:worktrees:sizes:start", (event, targets) => {
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
        !value.worktreePath.startsWith("/")
      ) {
        throw new Error("Worktree size targets must name an absolute worktree path.");
      }
      sanitized.push({
        commonDirectory: value.commonDirectory,
        worktreePath: value.worktreePath,
      });
    }
    return sizeScanner.start(senderIdOf(event), sanitized);
  });

  ipcMainLike.handle("settings:worktrees:sizes:cancel", async (_event, generation) => {
    if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 1) {
      throw new Error("Worktree size cancellation requires a scan generation.");
    }
    sizeScanner?.cancel(generation);
  });

  ipcMainLike.handle("settings:kimi-usage", async () => getKimiUsageStats());

  ipcMainLike.handle("settings:kimi-memory", async () => listKimiMemory());

  ipcMainLike.handle("settings:kimi-memory:delete", async (_event, filePath) => {
    if (typeof filePath !== "string") {
      throw new Error("Kimi memory file path must be a string.");
    }

    return deleteKimiMemoryFile(filePath);
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
