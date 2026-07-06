import { getRtkGainStats } from "./rtkGain";
import {
  readGlobalAgentInstructions,
  writeGlobalAgentInstructions,
} from "./globalAgentInstructions";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export function registerSettingsIpc(ipcMainLike: IpcMainLike): void {
  ipcMainLike.handle("settings:check-for-updates", async () => {
    return { hasUpdate: false };
  });

  ipcMainLike.handle("settings:rtk-gain", async () => getRtkGainStats());

  ipcMainLike.handle("settings:global-agent-instructions:read", async () =>
    readGlobalAgentInstructions(),
  );

  ipcMainLike.handle("settings:global-agent-instructions:write", async (_event, content) => {
    if (typeof content !== "string") {
      throw new Error("Global agent instructions content must be a string.");
    }

    return writeGlobalAgentInstructions(content);
  });
}
