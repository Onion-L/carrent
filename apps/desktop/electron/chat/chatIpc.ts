import type { ChatTurnRequest } from "../../src/shared/chat";
import type { ChatSessionManager } from "./chatSessionManager";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export interface ChatIpcServices {
  sessionManager: ChatSessionManager;
}

export function registerChatIpc(
  ipcMainLike: IpcMainLike,
  services: ChatIpcServices,
) {
  ipcMainLike.handle("chat:send", async (_event, request) => {
    const req = request as ChatTurnRequest;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    services.sessionManager.start(runId, req);

    return { runId };
  });

  ipcMainLike.handle("chat:stop", async (_event, runId) => {
    services.sessionManager.stop(runId as string);
    return undefined;
  });
}
