import type { ChatTurnRequest } from "../../src/shared/chat";
import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import { runtimeNameMap, type RuntimeId } from "../../src/shared/runtimes";
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

export function registerChatIpc(ipcMainLike: IpcMainLike, services: ChatIpcServices) {
  ipcMainLike.handle("chat:send", async (_event, request) => {
    const req = request as ChatTurnRequest;
    const unavailableMessage = getV1UnavailableRuntimeMessage(req.runtimeId);
    if (unavailableMessage) {
      throw new Error(unavailableMessage);
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    services.sessionManager.start(runId, req);

    return { runId };
  });

  ipcMainLike.handle("chat:stop", async (_event, runId) => {
    services.sessionManager.stop(runId as string);
    return undefined;
  });

  ipcMainLike.handle("chat:permission-response", async (_event, response) => {
    services.sessionManager.respondToPermission(response as ChatPermissionResponse);
    return undefined;
  });
}

function getV1UnavailableRuntimeMessage(runtimeId: RuntimeId) {
  if (runtimeId === "kimi") {
    return null;
  }

  return `${runtimeNameMap[runtimeId]} is unavailable in Carrent V1. Use Kimi Code.`;
}
