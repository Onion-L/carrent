import type {
  ChatTurnRequest,
  DeleteThreadDataRequest,
  KimiSessionStatus,
} from "../../src/shared/chat";
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

const MAX_DELETE_THREAD_IDS = 10_000;
const MAX_DELETE_ATTACHMENT_KEYS = 10_000;

function readNonEmptyStringArray(
  value: unknown,
  field: string,
  maximumLength: number,
  allowEmpty: boolean,
) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumLength ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`Invalid ${field}.`);
  }
  return value as string[];
}

export function parseDeleteThreadDataRequest(value: unknown): DeleteThreadDataRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid thread data deletion request.");
  }

  const request = value as Record<string, unknown>;
  return {
    threadIds: readNonEmptyStringArray(
      request.threadIds,
      "threadIds",
      MAX_DELETE_THREAD_IDS,
      false,
    ),
    attachmentStorageKeys: readNonEmptyStringArray(
      request.attachmentStorageKeys,
      "attachmentStorageKeys",
      MAX_DELETE_ATTACHMENT_KEYS,
      true,
    ),
  };
}

export function parseChatPermissionResponse(value: unknown): ChatPermissionResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid permission response.");
  }
  const response = value as Record<string, unknown>;
  if (
    typeof response.permissionId !== "string" ||
    !response.permissionId.trim() ||
    typeof response.runId !== "string" ||
    !response.runId.trim() ||
    typeof response.optionId !== "string" ||
    !response.optionId.trim()
  ) {
    throw new Error("Invalid permission response.");
  }
  return {
    permissionId: response.permissionId,
    runId: response.runId,
    optionId: response.optionId,
  };
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

  ipcMainLike.handle("chat:delete-thread-data", async (_event, request) => {
    await services.sessionManager.deleteThreadData(parseDeleteThreadDataRequest(request));
    return undefined;
  });

  ipcMainLike.handle("chat:permission-response", async (_event, response) => {
    services.sessionManager.respondToPermission(parseChatPermissionResponse(response));
    return undefined;
  });

  ipcMainLike.handle("chat:kimi-status", async (_event, request) => {
    const req = request as ChatTurnRequest;
    if (req.runtimeId !== "kimi") {
      return null;
    }

    return services.sessionManager.getStatus(req) as Promise<KimiSessionStatus | null>;
  });
}

function getV1UnavailableRuntimeMessage(runtimeId: RuntimeId) {
  if (runtimeId === "kimi") {
    return null;
  }

  return `${runtimeNameMap[runtimeId]} is unavailable in Carrent V1. Use Kimi Code.`;
}
