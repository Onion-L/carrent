import type {
  AttachmentMetadata,
  ChatTurnRequest,
  DeleteThreadDataRequest,
  KimiSessionStatus,
  RuntimeSessionRecovery,
  ThreadDeletionTransactionRequest,
  ThreadDeletionScope,
} from "../../src/shared/chat";
import {
  normalizeAppStateSnapshot,
  normalizeWorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";
import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import type { ChatQuestionAnswer, ChatQuestionResponse } from "../../src/shared/chatQuestions";
import {
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_ID_CHARS,
  MAX_ATTACHMENT_MIME_TYPE_CHARS,
  MAX_ATTACHMENT_NAME_BYTES,
  MAX_SINGLE_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  assertValidAttachmentStorageKey,
} from "../../src/shared/attachment";
import { runtimeIds, runtimeNameMap, type RuntimeId } from "../../src/shared/runtimes";
import type { ChatSessionManager } from "./chatSessionManager";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export interface ChatIpcServices {
  sessionManager: ChatSessionManager;
  isProjectDirectoryAvailable?: (workingDirectory: string) => Promise<boolean>;
  threadDeletionManager?: {
    deleteThread: (request: ThreadDeletionTransactionRequest) => Promise<void>;
  };
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

export function parseDeleteThreadDataRequest(
  value: unknown,
  allowEmptyThreadIds = false,
): DeleteThreadDataRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid thread data deletion request.");
  }

  const request = value as Record<string, unknown>;
  return {
    threadIds: readNonEmptyStringArray(
      request.threadIds,
      "threadIds",
      MAX_DELETE_THREAD_IDS,
      allowEmptyThreadIds,
    ),
    attachmentStorageKeys: readNonEmptyStringArray(
      request.attachmentStorageKeys,
      "attachmentStorageKeys",
      MAX_DELETE_ATTACHMENT_KEYS,
      true,
    ),
  };
}

export function parseRuntimeSessionRecovery(value: unknown): RuntimeSessionRecovery {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Runtime Session recovery request.");
  }
  const request = value as Record<string, unknown>;
  if (
    !runtimeIds.includes(request.runtimeId as RuntimeId) ||
    typeof request.threadId !== "string" ||
    request.threadId.trim().length === 0
  ) {
    throw new Error("Invalid Runtime Session recovery request.");
  }
  return { runtimeId: request.runtimeId as RuntimeId, threadId: request.threadId };
}

export function parseThreadDeletionTransactionRequest(
  value: unknown,
): ThreadDeletionTransactionRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid thread deletion transaction.");
  }
  const request = value as Record<string, unknown>;
  const beforeAppState = normalizeAppStateSnapshot(request.beforeAppState);
  const afterAppState = normalizeAppStateSnapshot(request.afterAppState);
  const beforeWorkspace = normalizeWorkspaceSnapshot(request.beforeWorkspace);
  const afterWorkspace = normalizeWorkspaceSnapshot(request.afterWorkspace);
  if (!beforeAppState || !afterAppState || !beforeWorkspace || !afterWorkspace) {
    throw new Error("Invalid thread deletion transaction snapshots.");
  }
  let scope: ThreadDeletionScope | undefined;
  if (request.scope !== undefined) {
    if (!request.scope || typeof request.scope !== "object") {
      throw new Error("Invalid thread deletion scope.");
    }
    const candidate = request.scope as Record<string, unknown>;
    if (candidate.kind === "threads") {
      scope = { kind: "threads" };
    } else if (
      candidate.kind === "association" &&
      typeof candidate.workspaceId === "string" &&
      candidate.workspaceId.length > 0 &&
      typeof candidate.projectId === "string" &&
      candidate.projectId.length > 0
    ) {
      scope = {
        kind: "association",
        workspaceId: candidate.workspaceId,
        projectId: candidate.projectId,
      };
    } else if (
      candidate.kind === "workspace" &&
      typeof candidate.workspaceId === "string" &&
      candidate.workspaceId.length > 0
    ) {
      scope = { kind: "workspace", workspaceId: candidate.workspaceId };
    } else {
      throw new Error("Invalid thread deletion scope.");
    }
  }
  return {
    beforeAppState,
    afterAppState,
    beforeWorkspace,
    afterWorkspace,
    threadData: parseDeleteThreadDataRequest(
      request.threadData,
      scope?.kind === "association" || scope?.kind === "workspace",
    ),
    ...(scope ? { scope } : {}),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseChatTurnAttachments(value: unknown): AttachmentMetadata[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENT_COUNT) {
    throw new Error("Invalid attachments.");
  }

  let totalSize = 0;
  const attachments = value.map((entry): AttachmentMetadata => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Invalid attachment metadata.");
    }
    const record = entry as Record<string, unknown>;
    if (record.localPath !== undefined) {
      throw new Error("Invalid attachment metadata.");
    }
    if (record.kind !== "image" && record.kind !== "file") {
      throw new Error("Invalid attachment metadata.");
    }
    if (
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      record.id.length > MAX_ATTACHMENT_ID_CHARS
    ) {
      throw new Error("Invalid attachment metadata.");
    }
    if (
      typeof record.name !== "string" ||
      record.name.trim().length === 0 ||
      new TextEncoder().encode(record.name).length > MAX_ATTACHMENT_NAME_BYTES
    ) {
      throw new Error("Invalid attachment metadata.");
    }
    if (
      typeof record.mimeType !== "string" ||
      record.mimeType.length === 0 ||
      record.mimeType.length > MAX_ATTACHMENT_MIME_TYPE_CHARS
    ) {
      throw new Error("Invalid attachment metadata.");
    }
    if (typeof record.storageKey !== "string") {
      throw new Error("Invalid attachment metadata.");
    }
    assertValidAttachmentStorageKey(record.storageKey);
    if (
      !isFiniteNumber(record.size) ||
      record.size < 0 ||
      record.size > MAX_SINGLE_ATTACHMENT_BYTES
    ) {
      throw new Error("Invalid attachment metadata.");
    }
    totalSize += record.size;
    if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("Invalid attachments.");
    }

    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      mimeType: record.mimeType,
      size: record.size,
      storageKey: record.storageKey,
      ...(isFiniteNumber(record.width) ? { width: record.width } : {}),
      ...(isFiniteNumber(record.height) ? { height: record.height } : {}),
    };
  });

  return attachments;
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

export function parseChatQuestionResponse(value: unknown): ChatQuestionResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid question response.");
  }
  const response = value as Record<string, unknown>;
  if (
    typeof response.questionId !== "string" ||
    !response.questionId.trim() ||
    typeof response.runId !== "string" ||
    !response.runId.trim()
  ) {
    throw new Error("Invalid question response.");
  }
  if (response.action === "skip") {
    return {
      questionId: response.questionId,
      runId: response.runId,
      action: "skip",
    };
  }
  if (response.action !== "submit" || !Array.isArray(response.answers)) {
    throw new Error("Invalid question response.");
  }

  const answers = response.answers.map((entry): ChatQuestionAnswer => {
    const answer = (entry ?? null) as Record<string, unknown> | null;
    if (
      !answer ||
      typeof answer !== "object" ||
      !Number.isInteger(answer.questionIndex) ||
      (answer.questionIndex as number) < 0 ||
      !Array.isArray(answer.optionIds) ||
      answer.optionIds.length === 0 ||
      answer.optionIds.some((optionId) => typeof optionId !== "string" || !optionId.trim()) ||
      (answer.customText !== undefined &&
        (typeof answer.customText !== "string" || !answer.customText.trim()))
    ) {
      throw new Error("Invalid question response.");
    }
    return {
      questionIndex: answer.questionIndex as number,
      optionIds: answer.optionIds as string[],
      ...(typeof answer.customText === "string" ? { customText: answer.customText } : {}),
    };
  });

  if (answers.length === 0) {
    throw new Error("Invalid question response.");
  }

  return {
    questionId: response.questionId,
    runId: response.runId,
    action: "submit",
    answers,
  };
}

export function registerChatIpc(ipcMainLike: IpcMainLike, services: ChatIpcServices) {
  ipcMainLike.handle("chat:send", async (_event, request) => {
    const req = request as ChatTurnRequest;
    const unavailableMessage = getV1UnavailableRuntimeMessage(req.runtimeId);
    if (unavailableMessage) {
      throw new Error(unavailableMessage);
    }
    if (
      req.workspace.kind === "project" &&
      services.isProjectDirectoryAvailable &&
      !(await services.isProjectDirectoryAvailable(req.workspace.projectPath))
    ) {
      throw new Error("Project Working Directory is unavailable.");
    }

    const sanitizedRequest: ChatTurnRequest = {
      ...req,
      attachments: parseChatTurnAttachments(
        (request as { attachments?: unknown } | null)?.attachments,
      ),
    };

    if (
      req.runId !== undefined &&
      (typeof req.runId !== "string" || !req.runId || req.runId.trim() !== req.runId)
    ) {
      throw new Error("Invalid run ID.");
    }
    const runId = req.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    services.sessionManager.start(runId, sanitizedRequest);

    return { runId };
  });

  ipcMainLike.handle("chat:stop", async (_event, runId) => {
    services.sessionManager.stop(runId as string);
    return undefined;
  });

  ipcMainLike.handle("chat:remove-runtime-session", async (_event, request) => {
    await services.sessionManager.removeRuntimeSession(parseRuntimeSessionRecovery(request));
    return undefined;
  });

  ipcMainLike.handle("chat:delete-thread-data", async (_event, request) => {
    await services.sessionManager.deleteThreadData(parseDeleteThreadDataRequest(request));
    return undefined;
  });

  ipcMainLike.handle("chat:delete-thread-transaction", async (_event, request) => {
    if (!services.threadDeletionManager) {
      throw new Error("Thread deletion transaction is unavailable.");
    }
    await services.threadDeletionManager.deleteThread(
      parseThreadDeletionTransactionRequest(request),
    );
    return undefined;
  });

  ipcMainLike.handle("chat:permission-response", async (_event, response) => {
    services.sessionManager.respondToPermission(parseChatPermissionResponse(response));
    return undefined;
  });

  ipcMainLike.handle("chat:question-response", async (_event, response) => {
    services.sessionManager.respondToQuestion(parseChatQuestionResponse(response));
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
