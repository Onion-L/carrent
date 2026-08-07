import type {
  ChatTurnRequest,
  ChatRunEvent,
  Attachment,
  DeleteThreadDataRequest,
  RuntimeSessionRecovery,
  ThreadDataDeletionReceipt,
} from "../../src/shared/chat";
import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import type { ChatQuestionResponse } from "../../src/shared/chatQuestions";
import {
  createKimiAcpProcessTransportFactory,
  executeKimiCompact,
  getKimiSessionStatus,
  KimiRuntimeSessionError,
  startKimiAcpChatRun,
  type KimiAcpTransportFactory,
  type KimiAcpRunHandle,
} from "./kimiAcpChat";
import { startCarrentBridge, type CarrentBridgeFactory } from "../bridge/carrentBridge";
import { startQuestionMcpServer, type QuestionMcpServerFactory } from "./questionMcpServer";
import type { AttachmentStore } from "../attachments/attachmentStore";
import { buildProviderSessionKey } from "../../src/shared/providerSessions";
import type { RuntimeSessionDetachmentReceipt } from "../workspace/projectDirectory";
import type { ThreadActionRequest, ThreadActionResult } from "../../src/shared/threadActions";

export type SpawnFn = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeout?: number;
    windowsHide?: boolean;
    env?: NodeJS.ProcessEnv;
    stdio?: ["ignore" | "pipe", "pipe", "pipe"];
  },
) => import("node:child_process").ChildProcess;

export interface ChatSessionManager {
  start: (runId: string, request: ChatTurnRequest) => void;
  stop: (runId: string) => void;
  shutdown: () => Promise<void>;
  hasLiveRuns?: () => boolean;
  removeRuntimeSession: (request: RuntimeSessionRecovery) => Promise<void>;
  deleteThreadData: (request: DeleteThreadDataRequest) => Promise<ThreadDataDeletionReceipt | void>;
  rollbackThreadDataDeletion?: (receipt: ThreadDataDeletionReceipt) => Promise<void>;
  hasLiveRunForThreads?: (threadIds: string[]) => boolean;
  detachRuntimeSessions?: (threadIds: string[]) => Promise<RuntimeSessionDetachmentReceipt>;
  restoreRuntimeSessions?: (receipt: RuntimeSessionDetachmentReceipt) => Promise<void>;
  completeRuntimeSessionDetachment?: (receipt: RuntimeSessionDetachmentReceipt) => void;
  resetRuntimeSessions?: () => void;
  respondToPermission: (response: ChatPermissionResponse) => void;
  respondToQuestion: (response: ChatQuestionResponse) => void;
  getStatus: (
    request: ChatTurnRequest,
  ) => Promise<import("../../src/shared/chat").KimiSessionStatus | null>;
  inspectStatus?: (
    request: ChatTurnRequest,
  ) => Promise<import("../../src/shared/chat").KimiSessionStatus | null>;
  executeThreadAction?: (request: ThreadActionRequest) => Promise<ThreadActionResult>;
}

function buildRequestSessionKey(request: ChatTurnRequest) {
  return buildProviderSessionKey(request.runtimeId, request.threadId);
}

export type ProviderSessionStore = {
  get: (key: string) => string | undefined;
  consumeInvalidMappingNotice?: (key: string) => boolean;
  set: (key: string, sessionId: string) => void | Promise<void>;
  delete?: (key: string, sessionId?: string) => void | Promise<void>;
  deleteThreads?: (
    threadIds: string[],
  ) => Record<string, string> | void | Promise<Record<string, string> | void>;
  restoreThreads?: (sessions: Record<string, string>) => void | Promise<void>;
};

export function createChatSessionManager(options: {
  emit: (event: ChatRunEvent) => void;
  spawn: SpawnFn;
  providerSessions?: ProviderSessionStore;
  kimiAcpTransportFactory?: KimiAcpTransportFactory;
  carrentBridgeFactory?: CarrentBridgeFactory;
  questionMcpServerFactory?: QuestionMcpServerFactory;
  attachmentStore?: AttachmentStore;
  threadActionTimeoutMs?: number;
}): ChatSessionManager {
  const kimiSessions = new Map<string, { handle: KimiAcpRunHandle; threadId: string }>();
  const pendingKimiRuns = new Map<string, string>();
  const pendingKimiRunTasks = new Map<string, Promise<void>>();
  const stoppedPendingKimiRuns = new Set<string>();
  const runtimeSessions = new Map<string, string>();
  const activeThreadActions = new Map<string, AbortController>();
  const activeThreadActionTasks = new Set<Promise<unknown>>();
  const activeStatusRequests = new Map<
    string,
    Promise<import("../../src/shared/chat").KimiSessionStatus | null>
  >();
  const deletedThreadIds = new Set<string>();
  const relocatingThreadIds = new Set<string>();

  function resolveAttachmentPaths(request: ChatTurnRequest): ChatTurnRequest {
    if (!request.attachments || request.attachments.length === 0 || !options.attachmentStore) {
      return request;
    }

    if (!options.attachmentStore.resolveVerifiedPath) {
      throw new Error("Attachment integrity verification is unavailable.");
    }
    const attachments: Attachment[] = request.attachments.map((attachment) => ({
      ...attachment,
      localPath: options.attachmentStore!.resolveVerifiedPath!(attachment),
    }));

    return { ...request, attachments };
  }

  function getResumeSessionId(runId: string, request: ChatTurnRequest, key: string) {
    const inMemorySessionId = runtimeSessions.get(key);
    if (inMemorySessionId) {
      return inMemorySessionId;
    }

    const persistedSessionId = options.providerSessions?.get(key);
    if (options.providerSessions?.consumeInvalidMappingNotice?.(key)) {
      options.emit({
        type: "notice",
        runId,
        requestKey: request.requestKey,
        message: "Invalid Runtime Session mapping was removed. A new session was started.",
      });
    }
    return persistedSessionId ?? null;
  }

  function start(runId: string, request: ChatTurnRequest) {
    if (deletedThreadIds.has(request.threadId)) {
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Thread has been deleted.",
      });
      return;
    }
    if (relocatingThreadIds.has(request.threadId)) {
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Project relocation is in progress.",
      });
      return;
    }
    if (activeStatusRequests.has(request.threadId)) {
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Session status is loading.",
      });
      return;
    }

    if (!request.context.workingDirectory) {
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Project path is missing. Select a project to chat.",
      });
      return;
    }

    let requestWithAttachments: ChatTurnRequest;
    try {
      requestWithAttachments = resolveAttachmentPaths(request);
    } catch (error) {
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: error instanceof Error ? error.message : "Attachment file is unavailable.",
      });
      return;
    }

    {
      const requestSessionKey = buildRequestSessionKey(requestWithAttachments);
      pendingKimiRuns.set(runId, requestWithAttachments.threadId);

      const pendingKimiRunTask = (async () => {
        try {
          let resumeSessionId: string | null = getResumeSessionId(
            runId,
            requestWithAttachments,
            requestSessionKey,
          );

          if (requestWithAttachments.historyMode === "replace") {
            const oldSessionId = resumeSessionId;
            runtimeSessions.delete(requestSessionKey);
            await options.providerSessions?.delete?.(requestSessionKey, oldSessionId ?? undefined);
            resumeSessionId = null;
          }

          if (stoppedPendingKimiRuns.has(runId)) {
            options.emit({
              type: "stopped",
              runId,
              requestKey: requestWithAttachments.requestKey,
            });
            return;
          }

          const transportFactory =
            options.kimiAcpTransportFactory ?? createKimiAcpProcessTransportFactory(options.spawn);
          const bridgeFactory =
            options.carrentBridgeFactory ??
            ((bridgeOptions) => startCarrentBridge({ runId: bridgeOptions.runId }));
          // The Run-scoped question server is an internal interaction surface:
          // it starts for every Kimi Run regardless of the Local MCP Server
          // preference that gates the Carrent Bridge.
          const questionServerFactory: QuestionMcpServerFactory =
            options.questionMcpServerFactory ??
            ((questionOptions) => startQuestionMcpServer(questionOptions));
          const handle = startKimiAcpChatRun({
            runId,
            request: requestWithAttachments,
            cwd: requestWithAttachments.context.workingDirectory,
            emit: options.emit,
            transportFactory,
            bridgeFactory,
            questionServerFactory,
            attachmentStoreRoot: options.attachmentStore?.resolveRoot(),
            resumeSessionId,
            onCompletedSession: async (sessionId) => {
              if (deletedThreadIds.has(requestWithAttachments.threadId)) {
                return;
              }
              await options.providerSessions?.set(requestSessionKey, sessionId);
              if (deletedThreadIds.has(requestWithAttachments.threadId)) {
                await options.providerSessions?.deleteThreads?.([requestWithAttachments.threadId]);
                return;
              }
              runtimeSessions.set(requestSessionKey, sessionId);
            },
            onDone: () => {
              kimiSessions.delete(runId);
            },
          });
          kimiSessions.set(runId, { handle, threadId: requestWithAttachments.threadId });
        } catch (error) {
          if (stoppedPendingKimiRuns.has(runId)) {
            options.emit({
              type: "stopped",
              runId,
              requestKey: requestWithAttachments.requestKey,
            });
          } else {
            options.emit({
              type: "failed",
              runId,
              requestKey: requestWithAttachments.requestKey,
              error: error instanceof Error ? error.message : "Failed to start Kimi ACP.",
            });
          }
        } finally {
          pendingKimiRuns.delete(runId);
          stoppedPendingKimiRuns.delete(runId);
        }
      })();
      pendingKimiRunTasks.set(runId, pendingKimiRunTask);
      void pendingKimiRunTask.finally(() => pendingKimiRunTasks.delete(runId));
      return;
    }
  }

  function stop(runId: string) {
    if (pendingKimiRuns.has(runId)) {
      stoppedPendingKimiRuns.add(runId);
      return;
    }

    const kimiSession = kimiSessions.get(runId);
    if (kimiSession) {
      kimiSession.handle.stop();
      kimiSessions.delete(runId);
    }
  }

  // App shutdown ends every live run immediately so Run-scoped question
  // servers flush their pending MCP calls and close before the process exits.
  async function shutdown() {
    activeThreadActions.forEach((controller) => controller.abort());
    if (activeThreadActionTasks.size > 0) {
      await Promise.allSettled(activeThreadActionTasks);
    }
    for (const runId of pendingKimiRuns.keys()) {
      stoppedPendingKimiRuns.add(runId);
    }
    await Promise.all(pendingKimiRunTasks.values());

    const terminations: Promise<void>[] = [];
    for (const [, kimiSession] of kimiSessions) {
      terminations.push(kimiSession.handle.shutdown());
    }
    await Promise.all(terminations);
    kimiSessions.clear();
  }

  async function executeThreadAction(request: ThreadActionRequest): Promise<ThreadActionResult> {
    if (request.action !== "compact") {
      throw new Error("Compact is not supported by the selected Runtime.");
    }
    if (!request.workingDirectory) {
      throw new Error("Project Working Directory is unavailable.");
    }
    if (deletedThreadIds.has(request.threadId)) {
      throw new Error("Thread has been deleted.");
    }
    if (hasLiveRunForThreads([request.threadId])) {
      throw new Error("Compact is unavailable while the Thread has a live Run.");
    }
    if (activeThreadActions.has(request.threadId)) {
      throw new Error("This Thread is already compacting.");
    }
    if (activeStatusRequests.has(request.threadId)) {
      throw new Error("Session status is loading.");
    }

    const key = buildProviderSessionKey(request.runtimeId, request.threadId);
    const sessionId = runtimeSessions.get(key) ?? options.providerSessions?.get(key);
    if (!sessionId) {
      throw new Error("Compact requires an existing Runtime Session.");
    }

    const controller = new AbortController();
    let actionTask: ReturnType<typeof executeKimiCompact> | null = null;
    activeThreadActions.set(request.threadId, controller);
    try {
      actionTask = executeKimiCompact({
        sessionId,
        cwd: request.workingDirectory,
        transportFactory:
          options.kimiAcpTransportFactory ?? createKimiAcpProcessTransportFactory(options.spawn),
        timeoutMs: options.threadActionTimeoutMs,
        signal: controller.signal,
      });
      activeThreadActionTasks.add(actionTask);
      const result = await actionTask;
      return { ...request, completedAt: result.completedAt };
    } catch (error) {
      if (error instanceof KimiRuntimeSessionError) {
        runtimeSessions.delete(key);
        await options.providerSessions?.delete?.(key, sessionId);
      }
      throw error;
    } finally {
      activeThreadActions.delete(request.threadId);
      if (actionTask) activeThreadActionTasks.delete(actionTask);
    }
  }

  async function deleteThreadData(request: DeleteThreadDataRequest) {
    const threadIds = [...new Set(request.threadIds)];
    if (threadIds.length === 0) {
      throw new Error("At least one thread is required for deletion.");
    }
    if (options.providerSessions && !options.providerSessions.deleteThreads) {
      throw new Error("Provider session cleanup is unavailable.");
    }
    if (request.attachmentStorageKeys.length > 0 && !options.attachmentStore) {
      throw new Error("Attachment store is unavailable.");
    }
    if (
      request.attachmentStorageKeys.length > 0 &&
      options.providerSessions &&
      !options.providerSessions.restoreThreads
    ) {
      throw new Error("Provider session rollback is unavailable.");
    }
    request.attachmentStorageKeys.forEach((storageKey) =>
      options.attachmentStore?.resolvePath(storageKey),
    );

    const threadIdSet = new Set(threadIds);
    const detachedRuntimeSessions = new Map<string, string>();
    threadIds.forEach((threadId) => deletedThreadIds.add(threadId));

    for (const [runId, threadId] of pendingKimiRuns) {
      if (threadIdSet.has(threadId)) {
        stop(runId);
      }
    }
    for (const [runId, session] of kimiSessions) {
      if (threadIdSet.has(session.threadId)) {
        stop(runId);
      }
    }

    for (const key of runtimeSessions.keys()) {
      if (threadIds.some((threadId) => key.endsWith(`:${threadId}`))) {
        detachedRuntimeSessions.set(key, runtimeSessions.get(key)!);
        runtimeSessions.delete(key);
      }
    }

    let removedProviderSessions: Record<string, string> | void = undefined;
    try {
      removedProviderSessions = await options.providerSessions?.deleteThreads?.(threadIds);
      if (request.attachmentStorageKeys.length > 0) {
        await options.attachmentStore!.deleteAttachments(request.attachmentStorageKeys);
      }
    } catch (error) {
      detachedRuntimeSessions.forEach((sessionId, key) => runtimeSessions.set(key, sessionId));
      threadIds.forEach((threadId) => deletedThreadIds.delete(threadId));
      if (removedProviderSessions && Object.keys(removedProviderSessions).length > 0) {
        let rollbackError: unknown;
        let restored = false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await options.providerSessions?.restoreThreads?.(removedProviderSessions);
            restored = true;
            break;
          } catch (caught) {
            rollbackError = caught;
          }
        }
        if (!restored) {
          throw new AggregateError(
            [error, rollbackError],
            "Thread data deletion failed and provider sessions could not be restored.",
          );
        }
      }
      throw error;
    }

    return {
      threadIds,
      removedProviderSessions: removedProviderSessions ?? {},
      detachedRuntimeSessions: Object.fromEntries(detachedRuntimeSessions),
    } satisfies ThreadDataDeletionReceipt;
  }

  async function rollbackThreadDataDeletion(receipt: ThreadDataDeletionReceipt) {
    Object.entries(receipt.detachedRuntimeSessions).forEach(([key, sessionId]) => {
      runtimeSessions.set(key, sessionId);
    });
    receipt.threadIds.forEach((threadId) => deletedThreadIds.delete(threadId));
    const removedSessions = receipt.removedProviderSessions;
    if (Object.keys(removedSessions).length > 0) {
      if (!options.providerSessions?.restoreThreads) {
        throw new Error("Provider session rollback is unavailable.");
      }
      let rollbackError: unknown;
      let restored = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await options.providerSessions.restoreThreads(removedSessions);
          restored = true;
          break;
        } catch (error) {
          rollbackError = error;
        }
      }
      if (!restored) throw rollbackError;
    }
  }

  function hasLiveRunForThreads(threadIds: string[]) {
    const ids = new Set(threadIds);
    return (
      [...pendingKimiRuns.values()].some((threadId) => ids.has(threadId)) ||
      [...kimiSessions.values()].some((session) => ids.has(session.threadId))
    );
  }

  function hasLiveRuns() {
    return pendingKimiRuns.size > 0 || kimiSessions.size > 0;
  }

  async function detachRuntimeSessions(
    threadIds: string[],
  ): Promise<RuntimeSessionDetachmentReceipt> {
    const uniqueThreadIds = [...new Set(threadIds)];
    if (hasLiveRunForThreads(uniqueThreadIds)) {
      throw new Error("Stop the Project's live Run before relocating its directory.");
    }
    if (options.providerSessions && !options.providerSessions.deleteThreads) {
      throw new Error("Provider session cleanup is unavailable.");
    }
    if (options.providerSessions && !options.providerSessions.restoreThreads) {
      throw new Error("Provider session rollback is unavailable.");
    }

    uniqueThreadIds.forEach((threadId) => relocatingThreadIds.add(threadId));
    const runtimeSessionEntries = Object.fromEntries(
      [...runtimeSessions].filter(([key]) =>
        uniqueThreadIds.some((threadId) => key.endsWith(`:${threadId}`)),
      ),
    );
    Object.keys(runtimeSessionEntries).forEach((key) => runtimeSessions.delete(key));

    try {
      const providerSessions =
        (await options.providerSessions?.deleteThreads?.(uniqueThreadIds)) ?? {};
      return {
        threadIds: uniqueThreadIds,
        providerSessions,
        runtimeSessions: runtimeSessionEntries,
      };
    } catch (error) {
      Object.entries(runtimeSessionEntries).forEach(([key, sessionId]) => {
        runtimeSessions.set(key, sessionId);
      });
      uniqueThreadIds.forEach((threadId) => relocatingThreadIds.delete(threadId));
      throw error;
    }
  }

  async function restoreRuntimeSessions(receipt: RuntimeSessionDetachmentReceipt) {
    if (Object.keys(receipt.providerSessions).length > 0) {
      if (!options.providerSessions?.restoreThreads) {
        throw new Error("Provider session rollback is unavailable.");
      }
      await options.providerSessions.restoreThreads(receipt.providerSessions);
    }
    Object.entries(receipt.runtimeSessions).forEach(([key, sessionId]) => {
      runtimeSessions.set(key, sessionId);
    });
    receipt.threadIds.forEach((threadId) => relocatingThreadIds.delete(threadId));
  }

  function completeRuntimeSessionDetachment(receipt: RuntimeSessionDetachmentReceipt) {
    receipt.threadIds.forEach((threadId) => relocatingThreadIds.delete(threadId));
  }

  function respondToPermission(response: ChatPermissionResponse) {
    const kimiSession = kimiSessions.get(response.runId);
    if (kimiSession) {
      kimiSession.handle.respondToPermission(response);
      return;
    }

    options.emit({
      type: "permission-failed",
      runId: response.runId,
      permissionId: response.permissionId,
      error: "Permission request not found. The run may have already ended.",
    });
  }

  function respondToQuestion(response: ChatQuestionResponse) {
    const kimiSession = kimiSessions.get(response.runId);
    if (kimiSession) {
      kimiSession.handle.respondToQuestion(response);
      return;
    }

    options.emit({
      type: "question-failed",
      runId: response.runId,
      questionId: response.questionId,
      error: "Question request not found. The run may have already ended.",
    });
  }

  async function loadStatus(request: ChatTurnRequest, sessionId: string) {
    const transportFactory =
      options.kimiAcpTransportFactory ?? createKimiAcpProcessTransportFactory(options.spawn);
    const status = await getKimiSessionStatus({
      sessionId,
      cwd: request.context.workingDirectory,
      transportFactory,
      requestTimeoutMs: 30_000,
    });
    if (!status || deletedThreadIds.has(request.threadId)) return null;
    return { ...status, sessionId };
  }

  async function removeRejectedStatusSession(key: string, sessionId: string) {
    runtimeSessions.delete(key);
    await options.providerSessions?.delete?.(key, sessionId);
  }

  async function getStatus(request: ChatTurnRequest) {
    if (
      deletedThreadIds.has(request.threadId) ||
      relocatingThreadIds.has(request.threadId) ||
      hasLiveRunForThreads([request.threadId]) ||
      activeThreadActions.has(request.threadId) ||
      activeStatusRequests.has(request.threadId)
    ) {
      return null;
    }

    const requestSessionKey = buildRequestSessionKey(request);
    const sessionId =
      runtimeSessions.get(requestSessionKey) ?? options.providerSessions?.get(requestSessionKey);
    if (!sessionId) {
      return null;
    }

    const task = loadStatus(request, sessionId);
    activeStatusRequests.set(request.threadId, task);
    try {
      return await task;
    } catch (error) {
      if (error instanceof KimiRuntimeSessionError) {
        await removeRejectedStatusSession(requestSessionKey, sessionId);
      }
      return null;
    } finally {
      if (activeStatusRequests.get(request.threadId) === task) {
        activeStatusRequests.delete(request.threadId);
      }
    }
  }

  async function inspectStatus(request: ChatTurnRequest) {
    if (deletedThreadIds.has(request.threadId) || relocatingThreadIds.has(request.threadId)) {
      return null;
    }
    if (hasLiveRunForThreads([request.threadId])) {
      throw new Error("Session status is unavailable while the Thread has a live Run.");
    }
    if (activeThreadActions.has(request.threadId)) {
      throw new Error("Session status is unavailable while Compact is running.");
    }
    if (activeStatusRequests.has(request.threadId)) {
      throw new Error("Session status is already loading.");
    }

    const requestSessionKey = buildRequestSessionKey(request);
    const sessionId =
      runtimeSessions.get(requestSessionKey) ?? options.providerSessions?.get(requestSessionKey);
    if (!sessionId) return null;

    const task = loadStatus(request, sessionId);
    activeStatusRequests.set(request.threadId, task);
    try {
      return await task;
    } catch (error) {
      if (error instanceof KimiRuntimeSessionError) {
        await removeRejectedStatusSession(requestSessionKey, sessionId);
      }
      throw error;
    } finally {
      if (activeStatusRequests.get(request.threadId) === task) {
        activeStatusRequests.delete(request.threadId);
      }
    }
  }

  async function removeRuntimeSession(request: RuntimeSessionRecovery) {
    if (options.providerSessions && !options.providerSessions.delete) {
      throw new Error("Runtime Session cleanup is unavailable.");
    }
    const key = buildProviderSessionKey(request.runtimeId, request.threadId);
    const inMemorySessionId = runtimeSessions.get(key);
    const sessionId = inMemorySessionId ?? options.providerSessions?.get(key);
    runtimeSessions.delete(key);
    try {
      await options.providerSessions?.delete?.(key, sessionId);
    } catch (error) {
      if (inMemorySessionId) {
        runtimeSessions.set(key, inMemorySessionId);
      }
      throw error;
    }
  }

  function resetRuntimeSessions() {
    runtimeSessions.clear();
  }

  return {
    start,
    stop,
    shutdown,
    hasLiveRuns,
    removeRuntimeSession,
    deleteThreadData,
    rollbackThreadDataDeletion,
    hasLiveRunForThreads,
    detachRuntimeSessions,
    restoreRuntimeSessions,
    completeRuntimeSessionDetachment,
    resetRuntimeSessions,
    respondToPermission,
    respondToQuestion,
    getStatus,
    inspectStatus,
    executeThreadAction,
  };
}
