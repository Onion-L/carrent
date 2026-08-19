import type {
  ChatTurnRequest,
  ChatRunEvent,
  Attachment,
  DeleteThreadDataRequest,
  KimiSessionStatus,
  KimiTelemetryStatus,
  RuntimeSessionRecovery,
  ThreadDataDeletionReceipt,
  ThreadDataDeletionOptions,
} from "../../src/shared/chat";
import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import type { ChatQuestionResponse } from "../../src/shared/chatQuestions";
import {
  createKimiAcpProcessTransportFactory,
  executeKimiCompact,
  getKimiSessionCommands,
  KIMI_SUPPORTED_SESSION_COMMANDS,
  KimiRuntimeSessionError,
  startKimiAcpChatRun,
  type KimiAcpTransportFactory,
  type KimiAcpRunHandle,
} from "./kimiAcpChat";
import { getKimiContextUsage } from "./kimiContextUsage";
import { getKimiPlanUsage } from "./kimiPlanUsage";
import { startCarrentBridge, type CarrentBridgeFactory } from "../bridge/carrentBridge";
import { startQuestionMcpServer, type QuestionMcpServerFactory } from "./questionMcpServer";
import type { AttachmentStore } from "../attachments/attachmentStore";
import { buildProviderSessionKey } from "../../src/shared/providerSessions";
import type { RuntimeSessionDetachmentReceipt } from "../workspace/projectDirectory";
import type { ThreadActionRequest, ThreadActionResult } from "../../src/shared/threadActions";
import { createAcpTerminalManager, type AcpTerminalManager } from "./acpTerminalManager";
import { nodePtyAdapter } from "../terminal/nodePtyAdapter";
import type { RuntimeDebugRequest, RuntimeDebugTrace } from "../../src/shared/runtimeDebug";
import { readKimiDebugTrace } from "./kimiDebugTrace";

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
  deleteThreadData: (
    request: DeleteThreadDataRequest,
    options?: ThreadDataDeletionOptions,
  ) => Promise<ThreadDataDeletionReceipt | void>;
  rollbackThreadDataDeletion?: (receipt: ThreadDataDeletionReceipt) => Promise<void>;
  adoptCommittedProviderSessionDeletion?: (removedSessions: Record<string, string>) => void;
  hasLiveRunForThreads?: (threadIds: string[]) => boolean;
  detachRuntimeSessions?: (
    threadIds: string[],
    options?: { deferProviderSessionDeletion?: boolean },
  ) => Promise<RuntimeSessionDetachmentReceipt>;
  restoreRuntimeSessions?: (receipt: RuntimeSessionDetachmentReceipt) => Promise<void>;
  completeRuntimeSessionDetachment?: (receipt: RuntimeSessionDetachmentReceipt) => void;
  resetRuntimeSessions?: () => void;
  respondToPermission: (response: ChatPermissionResponse) => void;
  respondToQuestion: (response: ChatQuestionResponse) => void;
  getStatus: (
    request: ChatTurnRequest,
  ) => Promise<import("../../src/shared/chat").KimiTelemetryStatus | null>;
  inspectStatus?: (
    request: ChatTurnRequest,
  ) => Promise<import("../../src/shared/chat").KimiSessionStatus | null>;
  inspectDebugTrace?: (request: RuntimeDebugRequest) => Promise<RuntimeDebugTrace | null>;
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
  adoptCommittedProviderSessionDeletion?: (removedSessions: Record<string, string>) => void;
  detachThreadsFromCache?: (threadIds: string[]) => Record<string, string>;
  restoreThreadsToCache?: (sessions: Record<string, string>) => void;
};

export function createChatSessionManager(options: {
  emit: (event: ChatRunEvent) => void;
  spawn: SpawnFn;
  providerSessions?: ProviderSessionStore;
  kimiAcpTransportFactory?: KimiAcpTransportFactory;
  acpTerminalManagerFactory?: (options: { cwd: string }) => AcpTerminalManager;
  carrentBridgeFactory?: CarrentBridgeFactory;
  questionMcpServerFactory?: QuestionMcpServerFactory;
  attachmentStore?: AttachmentStore;
  threadActionTimeoutMs?: number;
  kimiContextUsage?: typeof getKimiContextUsage;
  kimiPlanUsage?: typeof getKimiPlanUsage;
  kimiDebugTrace?: typeof readKimiDebugTrace;
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
    Promise<import("../../src/shared/chat").KimiTelemetryStatus | null>
  >();
  // Commands harvested from live Runs, keyed by Runtime Session. Lets status
  // requests skip the CLI-spawning handshake for sessions seen this app run.
  const lastKnownCommands = new Map<string, ReadonlySet<string>>();
  // Recently composed statuses, per Thread, so hover churn re-serves the last
  // result instead of rescanning files. Only a short TTL in v1.
  const statusFreshness = new Map<
    string,
    { expiresAt: number; value: import("../../src/shared/chat").KimiTelemetryStatus }
  >();
  // A Run that arrived while a Runtime Session status request was active is
  // deferred until that request settles, instead of failing. One per Thread:
  // the run authority guarantees a single active Run per Thread.
  const deferredRuns = new Map<string, { runId: string; request: ChatTurnRequest }>();
  const stoppedDeferredRuns = new Set<string>();
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
    // A passive Runtime Session status refresh must be transparent to queued
    // work. Defer the Run until the active status request settles rather than
    // emitting a failure the user would have to resend.
    if (activeStatusRequests.has(request.threadId)) {
      deferredRuns.set(request.threadId, { runId, request });
      return;
    }

    beginRun(runId, request);
  }

  function beginRun(runId: string, request: ChatTurnRequest) {
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
            ((bridgeOptions) =>
              startCarrentBridge({
                runId: bridgeOptions.runId,
                projectDir: bridgeOptions.cwd,
              }));
          // The Run-scoped question server is an internal interaction surface:
          // it starts for every Kimi Run regardless of the Local MCP Server
          // preference that gates the Carrent Bridge.
          const questionServerFactory: QuestionMcpServerFactory =
            options.questionMcpServerFactory ??
            ((questionOptions) => startQuestionMcpServer(questionOptions));
          // Set by onCompletedSession so onDone can harvest the Run's
          // advertised commands for the session it persisted.
          let completedSessionId: string | null = null;
          const terminalManager = options.acpTerminalManagerFactory
            ? options.acpTerminalManagerFactory({
                cwd: requestWithAttachments.context.workingDirectory,
              })
            : createAcpTerminalManager({
                pty: nodePtyAdapter,
                cwd: requestWithAttachments.context.workingDirectory,
              });
          let handle: KimiAcpRunHandle;
          try {
            handle = startKimiAcpChatRun({
              runId,
              request: requestWithAttachments,
              cwd: requestWithAttachments.context.workingDirectory,
              emit: options.emit,
              transportFactory,
              bridgeFactory,
              questionServerFactory,
              terminalManager,
              attachmentStoreRoot: options.attachmentStore?.resolveRoot(),
              resumeSessionId,
              onCompletedSession: async (sessionId) => {
                if (deletedThreadIds.has(requestWithAttachments.threadId)) {
                  return;
                }
                await options.providerSessions?.set(requestSessionKey, sessionId);
                if (deletedThreadIds.has(requestWithAttachments.threadId)) {
                  await options.providerSessions?.deleteThreads?.([
                    requestWithAttachments.threadId,
                  ]);
                  return;
                }
                runtimeSessions.set(requestSessionKey, sessionId);
                completedSessionId = sessionId;
              },
              onDone: () => {
                const harvested =
                  completedSessionId === null ? null : handle.getAvailableCommands();
                if (completedSessionId !== null && harvested && harvested.size > 0) {
                  lastKnownCommands.set(completedSessionId, new Set(harvested));
                }
                kimiSessions.delete(runId);
              },
            });
          } catch (error) {
            void terminalManager.close().catch(() => {});
            throw error;
          }
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

  // Called from the `finally` of a Runtime Session status request so a Run that
  // arrived mid-refresh starts once the refresh has settled, after re-checking
  // cancellation, deletion, and project relocation.
  function startDeferredRun(threadId: string) {
    const deferred = deferredRuns.get(threadId);
    if (!deferred) return;
    const { runId, request } = deferred;

    if (stoppedDeferredRuns.has(runId)) {
      stoppedDeferredRuns.delete(runId);
      deferredRuns.delete(threadId);
      options.emit({
        type: "stopped",
        runId,
        requestKey: request.requestKey,
      });
      return;
    }
    if (deletedThreadIds.has(threadId)) {
      deferredRuns.delete(threadId);
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Thread has been deleted.",
      });
      return;
    }
    if (relocatingThreadIds.has(threadId)) {
      deferredRuns.delete(threadId);
      options.emit({
        type: "failed",
        runId,
        requestKey: request.requestKey,
        error: "Project relocation is in progress.",
      });
      return;
    }
    // Another status request began before this one settled; wait again. Every
    // status request's `finally` drains, so the deferral is bounded.
    if (activeStatusRequests.has(threadId)) {
      return;
    }

    deferredRuns.delete(threadId);
    beginRun(runId, request);
  }

  function stop(runId: string) {
    if (pendingKimiRuns.has(runId)) {
      stoppedPendingKimiRuns.add(runId);
      return;
    }

    // A Run deferred behind a status request has not started its transport
    // yet; mark it so the deferred drain emits `stopped` instead of starting
    // it. This mirrors the pending-run stop pattern.
    for (const deferred of deferredRuns.values()) {
      if (deferred.runId === runId) {
        stoppedDeferredRuns.add(runId);
        return;
      }
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
    // Drop any Runs still deferred behind a status request so the deferred
    // drain does not start them after shutdown begins.
    deferredRuns.clear();
    stoppedDeferredRuns.clear();
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

  async function deleteThreadData(
    request: DeleteThreadDataRequest,
    deletionOptions: ThreadDataDeletionOptions = {},
  ) {
    const threadIds = [...new Set(request.threadIds)];
    if (threadIds.length === 0) {
      throw new Error("At least one thread is required for deletion.");
    }
    if (
      !deletionOptions.deferProviderSessionDeletion &&
      options.providerSessions &&
      !options.providerSessions.deleteThreads
    ) {
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
      removedProviderSessions = deletionOptions.deferProviderSessionDeletion
        ? undefined
        : await options.providerSessions?.deleteThreads?.(threadIds);
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

  const adoptCommittedProviderSessionDeletion = options.providerSessions
    ?.adoptCommittedProviderSessionDeletion
    ? (removedSessions: Record<string, string>) => {
        options.providerSessions!.adoptCommittedProviderSessionDeletion!(removedSessions);
      }
    : undefined;

  function hasLiveRunForThreads(threadIds: string[]) {
    const ids = new Set(threadIds);
    return (
      [...pendingKimiRuns.values()].some((threadId) => ids.has(threadId)) ||
      [...kimiSessions.values()].some((session) => ids.has(session.threadId)) ||
      [...deferredRuns.keys()].some((threadId) => ids.has(threadId))
    );
  }

  function hasLiveRuns() {
    return pendingKimiRuns.size > 0 || kimiSessions.size > 0 || deferredRuns.size > 0;
  }

  async function detachRuntimeSessions(
    threadIds: string[],
    detachmentOptions: { deferProviderSessionDeletion?: boolean } = {},
  ): Promise<RuntimeSessionDetachmentReceipt> {
    const uniqueThreadIds = [...new Set(threadIds)];
    if (hasLiveRunForThreads(uniqueThreadIds)) {
      throw new Error("Stop the Project's live Run before relocating its directory.");
    }
    if (
      detachmentOptions.deferProviderSessionDeletion &&
      options.providerSessions &&
      (!options.providerSessions.detachThreadsFromCache ||
        !options.providerSessions.restoreThreadsToCache)
    ) {
      throw new Error("Provider session cache detachment is unavailable.");
    }
    if (
      !detachmentOptions.deferProviderSessionDeletion &&
      options.providerSessions &&
      !options.providerSessions.deleteThreads
    ) {
      throw new Error("Provider session cleanup is unavailable.");
    }
    if (
      !detachmentOptions.deferProviderSessionDeletion &&
      options.providerSessions &&
      !options.providerSessions.restoreThreads
    ) {
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
      const providerSessions = detachmentOptions.deferProviderSessionDeletion
        ? (options.providerSessions?.detachThreadsFromCache?.(uniqueThreadIds) ?? {})
        : ((await options.providerSessions?.deleteThreads?.(uniqueThreadIds)) ?? {});
      return {
        threadIds: uniqueThreadIds,
        providerSessions,
        providerSessionsDetachedFromCache: detachmentOptions.deferProviderSessionDeletion === true,
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
      if (receipt.providerSessionsDetachedFromCache) {
        if (!options.providerSessions?.restoreThreadsToCache) {
          throw new Error("Provider session cache rollback is unavailable.");
        }
        options.providerSessions.restoreThreadsToCache(receipt.providerSessions);
      } else {
        if (!options.providerSessions?.restoreThreads) {
          throw new Error("Provider session rollback is unavailable.");
        }
        await options.providerSessions.restoreThreads(receipt.providerSessions);
      }
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

  const STATUS_FRESHNESS_TTL_MS = 5_000;

  type StatusLoadOptions = {
    allowEmptyContext?: boolean;
    commands?: ReadonlySet<string>;
    useFreshnessCache?: boolean;
  };

  function loadStatus(
    request: ChatTurnRequest,
    sessionId: string,
    loadOptions?: StatusLoadOptions,
  ): Promise<KimiSessionStatus | null>;
  function loadStatus(
    request: ChatTurnRequest,
    sessionId: null,
    loadOptions: StatusLoadOptions,
  ): Promise<KimiTelemetryStatus | null>;
  async function loadStatus(
    request: ChatTurnRequest,
    sessionId: string | null,
    loadOptions: StatusLoadOptions = {},
  ): Promise<KimiTelemetryStatus | null> {
    const useFreshnessCache = loadOptions.useFreshnessCache !== false;
    if (useFreshnessCache) {
      const freshness = statusFreshness.get(request.threadId);
      const matchesSession = sessionId
        ? freshness?.value.sessionId === sessionId
        : freshness?.value.sessionId === undefined;
      if (freshness && freshness.expiresAt > Date.now() && matchesSession) {
        return freshness.value;
      }
    }

    const readContextUsage = options.kimiContextUsage ?? getKimiContextUsage;
    const readPlanUsage = options.kimiPlanUsage ?? getKimiPlanUsage;
    const [contextUsage, planResult] = await Promise.all([
      sessionId ? readContextUsage({ sessionId }) : Promise.resolve(null),
      readPlanUsage(),
    ]);
    if (deletedThreadIds.has(request.threadId)) return null;
    if (!contextUsage && !loadOptions.allowEmptyContext) return null;

    // Prefer commands harvested from live Runs; only sessions never seen this
    // app run pay for the prompt-less CLI handshake.
    let commands =
      loadOptions.commands ?? (sessionId ? lastKnownCommands.get(sessionId) : new Set());
    if (!commands && sessionId) {
      const transportFactory =
        options.kimiAcpTransportFactory ?? createKimiAcpProcessTransportFactory(options.spawn);
      commands =
        (await getKimiSessionCommands({
          sessionId,
          cwd: request.context.workingDirectory,
          transportFactory,
          requestTimeoutMs: 30_000,
        })) ?? undefined;
      if (commands && commands.size > 0) {
        lastKnownCommands.set(sessionId, commands);
      }
    }
    if (deletedThreadIds.has(request.threadId)) return null;

    const resolvedContextUsage = contextUsage ?? { used: 0 };
    const total = resolvedContextUsage.total;
    const status: KimiTelemetryStatus = {
      ...(sessionId ? { sessionId } : {}),
      ...(resolvedContextUsage.model !== undefined ? { model: resolvedContextUsage.model } : {}),
      used: resolvedContextUsage.used,
      ...(total !== undefined && total > 0
        ? { total, percentage: (resolvedContextUsage.used / total) * 100 }
        : {}),
      threadActions: commands?.has("compact") ? ["compact"] : [],
      supportedCommands: KIMI_SUPPORTED_SESSION_COMMANDS.filter((command) =>
        commands?.has(command),
      ),
      ...(planResult.planUsage || planResult.error
        ? {
            ...(planResult.planUsage ? { planUsage: planResult.planUsage } : {}),
            ...(planResult.error ? { planUsageError: planResult.error } : {}),
          }
        : {}),
    };

    if (useFreshnessCache) {
      statusFreshness.set(request.threadId, {
        expiresAt: Date.now() + STATUS_FRESHNESS_TTL_MS,
        value: status,
      });
    }
    return status;
  }

  async function removeRejectedStatusSession(key: string, sessionId: string) {
    runtimeSessions.delete(key);
    await options.providerSessions?.delete?.(key, sessionId);
  }

  async function getStatus(request: ChatTurnRequest) {
    if (
      deletedThreadIds.has(request.threadId) ||
      relocatingThreadIds.has(request.threadId) ||
      activeThreadActions.has(request.threadId) ||
      activeStatusRequests.has(request.threadId)
    ) {
      return null;
    }

    const requestSessionKey = buildRequestSessionKey(request);
    const liveSession = [...kimiSessions.values()].find(
      (session) => session.threadId === request.threadId,
    );
    const sessionId =
      liveSession?.handle.getSessionId() ??
      runtimeSessions.get(requestSessionKey) ??
      options.providerSessions?.get(requestSessionKey);
    const task = sessionId
      ? loadStatus(
          request,
          sessionId,
          liveSession
            ? {
                allowEmptyContext: true,
                commands: liveSession.handle.getAvailableCommands(),
                useFreshnessCache: false,
              }
            : undefined,
        )
      : loadStatus(request, null, { allowEmptyContext: true, commands: new Set() });
    activeStatusRequests.set(request.threadId, task);
    try {
      return await task;
    } catch (error) {
      if (error instanceof KimiRuntimeSessionError && sessionId) {
        await removeRejectedStatusSession(requestSessionKey, sessionId);
      }
      return null;
    } finally {
      if (activeStatusRequests.get(request.threadId) === task) {
        activeStatusRequests.delete(request.threadId);
      }
      startDeferredRun(request.threadId);
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
      startDeferredRun(request.threadId);
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

  async function inspectDebugTrace(
    request: RuntimeDebugRequest,
  ): Promise<RuntimeDebugTrace | null> {
    if (deletedThreadIds.has(request.threadId) || relocatingThreadIds.has(request.threadId)) {
      return null;
    }
    const key = buildProviderSessionKey(request.runtimeId, request.threadId);
    const liveSession = [...kimiSessions.values()].find(
      (session) => session.threadId === request.threadId,
    );
    const sessionId =
      liveSession?.handle.getSessionId() ??
      runtimeSessions.get(key) ??
      options.providerSessions?.get(key);
    if (!sessionId) return null;

    return (options.kimiDebugTrace ?? readKimiDebugTrace)({ sessionId });
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
    adoptCommittedProviderSessionDeletion,
    hasLiveRunForThreads,
    detachRuntimeSessions,
    restoreRuntimeSessions,
    completeRuntimeSessionDetachment,
    resetRuntimeSessions,
    respondToPermission,
    respondToQuestion,
    getStatus,
    inspectStatus,
    inspectDebugTrace,
    executeThreadAction,
  };
}
