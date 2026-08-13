import type { AppProjectRecord } from "../../src/shared/workspacePersistence";
import { getKimiUsageStats } from "./kimiUsage";
import { deleteKimiMemoryFile, listKimiMemory } from "./kimiMemory";
import { getRtkGainStats } from "./rtkGain";
import { scanWorktrees } from "./worktrees";
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

export function registerSettingsIpc(
  ipcMainLike: IpcMainLike,
  getAppVersion: () => string,
  getProjects: () => AppProjectRecord[],
): void {
  ipcMainLike.handle("settings:app-version", async () => getAppVersion());

  ipcMainLike.handle("settings:check-for-updates", async () => {
    return { hasUpdate: false };
  });

  ipcMainLike.handle("settings:rtk-gain", async () => getRtkGainStats());

  ipcMainLike.handle("settings:kimi-usage", async () => getKimiUsageStats());
  ipcMainLike.handle("settings:kimi-memory", async () => listKimiMemory());

  ipcMainLike.handle("settings:worktrees", async () => scanWorktrees(getProjects()));

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
