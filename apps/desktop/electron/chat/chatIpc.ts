import type {
  AttachmentMetadata,
  ChatTurnRequest,
  DeleteThreadDataRequest,
  KimiSessionStatus,
  RuntimeSessionRecovery,
  ThreadDeletionTransactionRequest,
  ThreadDeletionScope,
} from "../../src/shared/chat";
import { normalizeAppStateSnapshot } from "../../src/shared/workspacePersistence";
import {
  MAX_LOCAL_PATH_CONTEXTS,
  normalizeLocalPathContexts,
  type LocalPathContextItem,
} from "../../src/shared/localPathContext";
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
  isValidAttachmentSha256,
} from "../../src/shared/attachment";
import { runtimeIds, type RuntimeId } from "../../src/shared/runtimes";
import type { ChatSessionManager } from "./chatSessionManager";
import type { ThreadActionRequest } from "../../src/shared/threadActions";
import type { ChatRunAuthority } from "./chatRunAuthority";
import type { ThreadTitleCoordinator } from "./threadTitleCoordinator";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export interface ChatIpcServices {
  sessionManager: ChatSessionManager;
  runAuthority: ChatRunAuthority;
  isProjectDirectoryAvailable?: (workingDirectory: string) => Promise<boolean>;
  threadDeletionManager?: {
    deleteThread: (request: ThreadDeletionTransactionRequest) => Promise<void>;
  };
  threadTitleCoordinator?: Pick<ThreadTitleCoordinator, "enqueue">;
}

function senderIdOf(event: unknown): number {
  const id = (event as { sender?: { id?: unknown } } | null)?.sender?.id;
  if (typeof id !== "number") throw new Error("Unknown Run subscriber.");
  return id;
}

function assertSupportedRuntime(request: ChatTurnRequest) {
  if (!runtimeIds.includes(request.runtimeId as RuntimeId)) {
    throw new Error("Invalid runtime.");
  }
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

export function parseThreadActionRequest(value: unknown): ThreadActionRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Thread Action request.");
  }
  const request = value as Record<string, unknown>;
  if (
    request.action !== "compact" ||
    !runtimeIds.includes(request.runtimeId as RuntimeId) ||
    typeof request.threadId !== "string" ||
    request.threadId.trim().length === 0 ||
    typeof request.workingDirectory !== "string" ||
    request.workingDirectory.trim().length === 0
  ) {
    throw new Error("Invalid Thread Action request.");
  }
  return {
    action: "compact",
    runtimeId: request.runtimeId as RuntimeId,
    threadId: request.threadId,
    workingDirectory: request.workingDirectory,
  };
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
  if (!beforeAppState || !afterAppState) {
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
    if (record.sha256 !== undefined && !isValidAttachmentSha256(record.sha256)) {
      throw new Error("Invalid attachment metadata.");
    }
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
      ...(typeof record.sha256 === "string" ? { sha256: record.sha256 } : {}),
      ...(isFiniteNumber(record.width) ? { width: record.width } : {}),
      ...(isFiniteNumber(record.height) ? { height: record.height } : {}),
    };
  });

  return attachments;
}

// Sanitizes the optional Local Path Context on a chat turn request. Lenient by
// design at this boundary: absent resolves to undefined (the field is omitted),
// and malformed entries are dropped rather than rejecting the whole request, so
// the Runtime never receives authorization for an untrusted path. The staging
// cap is enforced here (mirroring attachment validation) so a request cannot
// stage more references than the composer allows. This is the trust boundary
// where Runtime authorization begins — downstream code trusts that every item
// here is a normalized, classified descriptor.
export function parseChatTurnLocalPathContexts(
  value: unknown,
): LocalPathContextItem[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LOCAL_PATH_CONTEXTS) {
    throw new Error("Invalid Local Path Context.");
  }
  const items = normalizeLocalPathContexts(value);
  return items.length > 0 ? items : undefined;
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
  ipcMainLike.handle("chat:subscribe", (event) =>
    services.runAuthority.subscribe(senderIdOf(event)),
  );
  ipcMainLike.handle("chat:unsubscribe", (event) => {
    services.runAuthority.unsubscribe(senderIdOf(event));
  });

  ipcMainLike.handle("chat:send", async (_event, request) => {
    const req = request as ChatTurnRequest;
    assertSupportedRuntime(req);
    if (
      services.isProjectDirectoryAvailable &&
      !(await services.isProjectDirectoryAvailable(req.context.workingDirectory))
    ) {
      throw new Error("Project Working Directory is unavailable.");
    }

    const sanitizedRequest: ChatTurnRequest = {
      ...req,
      attachments: parseChatTurnAttachments(
        (request as { attachments?: unknown } | null)?.attachments,
      ),
      localPathContexts: parseChatTurnLocalPathContexts(
        (request as { localPathContexts?: unknown } | null)?.localPathContexts,
      ),
    };

    if (
      req.runId !== undefined &&
      (typeof req.runId !== "string" || !req.runId || req.runId.trim() !== req.runId)
    ) {
      throw new Error("Invalid run ID.");
    }
    const runId = req.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const acceptedRequest = { ...sanitizedRequest, runId };
    const result = services.runAuthority.send(acceptedRequest);
    // Automatic titles need an accepted first Run *and* a draft promotion this
    // process committed. The coordinator holds the title source it recorded at
    // promotion time and ignores a Run it has no promotion for, so a Renderer
    // cannot request generation for a Thread that was never promoted.
    if (result.accepted) {
      services.threadTitleCoordinator?.enqueue({
        threadId: acceptedRequest.threadId,
        runId,
      });
    }
    return result;
  });

  ipcMainLike.handle("chat:stop", async (_event, runId) => {
    return services.runAuthority.stop(runId as string);
  });

  ipcMainLike.handle("chat:thread-action", async (_event, request) => {
    if (!services.sessionManager.executeThreadAction) {
      throw new Error("Thread Actions are unavailable. Restart Carrent and try again.");
    }
    return services.sessionManager.executeThreadAction(parseThreadActionRequest(request));
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
    const parsed = parseChatPermissionResponse(response);
    return services.runAuthority.respondToPermission(parsed);
  });

  ipcMainLike.handle("chat:question-response", async (_event, response) => {
    const parsed = parseChatQuestionResponse(response);
    return services.runAuthority.respondToQuestion(parsed);
  });

  ipcMainLike.handle("chat:kimi-status", async (_event, request) => {
    const req = request as ChatTurnRequest;
    assertSupportedRuntime(req);
    return services.sessionManager.getStatus(req) as Promise<KimiSessionStatus | null>;
  });

  ipcMainLike.handle("chat:session-status", async (_event, request) => {
    const req = request as ChatTurnRequest;
    assertSupportedRuntime(req);
    if (!services.sessionManager.inspectStatus) {
      return null;
    }

    return services.sessionManager.inspectStatus(req) as Promise<KimiSessionStatus | null>;
  });
}
